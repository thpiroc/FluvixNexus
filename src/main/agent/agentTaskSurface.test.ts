import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'

/**
 * FN Agent の作業の入口（Security Core v1 の STEP9）。
 *
 * - Renderer が送れるのは「始めて・止めて・上限だが続けて / やめて・今の状態」の意思表示だけ
 * - Action・Tool・承認・Security の判断を渡す欄は、契約にも Preload にも無い
 * - Agent Loop は Security Core の入口だけを使い、fs・child_process に直接触れない
 * - Scripted Provider は開発ビルドだけ
 */

const SRC = join(__dirname, '..', '..')
const AGENT = join(__dirname)

/** 説明文を落として、コードだけを読む。 */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function fieldsOf(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line) => line.match(/^\s*readonly ([A-Za-z]\w*)/)?.[1] ?? [])
    .sort()
}

describe('IPC の契約', () => {
  it('agent-task の要求は4本、知らせは1本だけ', () => {
    expect(
      Object.values(IPC_CHANNELS)
        .filter((channel) => channel.startsWith('agent-task:'))
        .sort()
    ).toEqual([
      'agent-task:continue',
      'agent-task:get-state',
      'agent-task:start',
      'agent-task:stop'
    ])
    expect(
      Object.values(IPC_EVENT_CHANNELS).filter((channel) => channel.startsWith('agent-task:'))
    ).toEqual(['agent-task:state-changed'])
  })

  it('Renderer が送れる欄は、指示と続けるかの返事だけ', () => {
    const contract = join(SRC, 'shared', 'ipc', 'contracts', 'agentTask.ts')

    expect(fieldsOf(contract)).toEqual(['decision', 'prompt'])
    expect(codeOf(readFileSync(contract, 'utf8'))).not.toMatch(
      /\baction\b|\btool|approv|security|policy|permission|skipSecurity|bypass|force|trustRenderer/i
    )
  })

  it('Renderer へ配る状態に、Tool の詳細・中身・出力・絶対パスの欄は無い', () => {
    const shared = join(SRC, 'shared', 'agent', 'agentTask.ts')

    // AgentTaskState の欄（行頭の readonly だけを数える。開始の結果の小さな union は含まない）。
    expect(fieldsOf(shared)).toEqual([
      'agentEnabled',
      'endReason',
      'finalAnswer',
      'loopLimit',
      'loopsUsed',
      'phase',
      'providerAvailable',
      'status',
      'subject'
    ])
    expect(codeOf(readFileSync(shared, 'utf8'))).not.toMatch(
      /content|stdout|stderr|output|absolutePath|realPath|payload|fingerprint|args\b/i
    )
  })
})

describe('Preload', () => {
  it('agentTask は4つの意思表示と購読だけ', () => {
    const preload = codeOf(readFileSync(join(SRC, 'preload', 'api', 'agentTask.ts'), 'utf8'))

    expect(preload.match(/invokeIpc\(/g)).toHaveLength(4)
    expect(preload.match(/subscribeIpcEvent\(/g)).toHaveLength(1)
    expect(preload).not.toMatch(/approval|APPROVAL|ipcRenderer\.send/)
  })

  it('Preload にも Renderer にも、Agent Loop・Tool・Gate を直接呼ぶ名前は無い', () => {
    for (const directory of [join(SRC, 'preload'), join(SRC, 'renderer', 'src')]) {
      for (const name of readdirSync(directory, { recursive: true, encoding: 'utf8' }).filter(
        (file) => /\.tsx?$/.test(file)
      )) {
        expect(readFileSync(join(directory, name), 'utf8')).not.toMatch(
          /createAgentLoop|runAgentTool|readAgentWorkspaceFile|searchAgentWorkspace|listAgentWorkspaceDirectory|createScriptedProvider|cancelPendingApprovals/
        )
      }
    }
  })
})

describe('Main の handler', () => {
  it('経路だけを持ち、Security Core の Gate を直接呼ばない', () => {
    const handler = codeOf(
      readFileSync(join(SRC, 'main', 'ipc', 'handlers', 'agentTask.ts'), 'utf8')
    )

    expect(handler).toContain('handleIpc')
    expect(handler).not.toContain('ipcMain')
    expect(handler).not.toMatch(
      /security|writeAgentWorkspaceFile|runAgentTerminalCommand|sendThroughExternalGate|consumeApproval|requestApproval/
    )
  })
})

describe('Agent Loop', () => {
  const sources = readdirSync(AGENT).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts')
  )

  it('fs・child_process・Electron に直接触れない（current だけが Main の道具をつなぐ）', () => {
    for (const name of sources) {
      const code = codeOf(readFileSync(join(AGENT, name), 'utf8'))

      expect(code).not.toMatch(
        /from 'fs|from 'child_process|from 'node:fs|from 'node:child_process/
      )

      if (name !== 'currentAgentLoop.ts') {
        expect(code).not.toMatch(/from 'electron'|from '\.\.\/app\//)
      }
    }
  })

  it('Security Core を迂回する名前（skip / bypass / force / trust / unsafe）を export していない', () => {
    for (const name of sources) {
      const exported = readFileSync(join(AGENT, name), 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('export'))

      expect(
        exported.filter((line) => /bypass|skip|force|trust|unsafe|approve/i.test(line))
      ).toEqual([])
    }
  })

  it('Tool は Security Core の入口にだけつながっている', () => {
    const current = codeOf(readFileSync(join(AGENT, 'currentAgentLoop.ts'), 'utf8'))

    for (const entry of [
      'describeAgentWorkspaceStatus',
      'listAgentWorkspaceDirectory',
      'readAgentWorkspaceFile',
      'searchAgentWorkspace',
      'writeAgentWorkspaceFile',
      'runAgentTerminalCommand',
      'sendThroughExternalGate',
      'isSideEffectInProgress',
      'cancelPendingApprovals',
      'isFnAgentEnabled'
    ]) {
      expect(current).toContain(entry)
    }

    // 人の保存・人間用 Terminal・ファイルの直接の読み書きは使わない。
    expect(current).not.toMatch(/writeWorkspaceFile|readWorkspaceFile|terminalSessions|files\//)
  })

  it('Scripted Provider は開発ビルドだけで作られる', () => {
    const current = codeOf(readFileSync(join(AGENT, 'currentAgentLoop.ts'), 'utf8'))

    expect(current).toMatch(/isDevelopment \? createScriptedProvider\(\) : null/)
    expect(current).toMatch(/isProviderAvailable: \(\) => isDevelopment/)
  })

  it('状態をディスクへ書かない（作業は復元しない）', () => {
    for (const name of sources) {
      // `toolbox.writeFile` は File Write Gate（承認を通る）で、ディスクへの直接の書き込みではない。
      expect(codeOf(readFileSync(join(AGENT, name), 'utf8'))).not.toMatch(
        /jsonStore|(?<!toolbox\.)writeFile\(|getPath\(|localStorage|store\//
      )
    }
  })
})

describe('Renderer の Agent パネル', () => {
  const directory = join(SRC, 'renderer', 'src', 'agentTask')

  it('最終回答は文字として描く（HTML として解釈しない）', () => {
    for (const name of readdirSync(directory).filter(
      (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file)
    )) {
      const code = codeOf(readFileSync(join(directory, name), 'utf8'))

      expect(code).not.toMatch(/dangerouslySetInnerHTML|innerHTML|contentEditable/)
      expect(code).not.toMatch(/fluvix\.(files|terminal|approval)\./)
      expect(code).not.toMatch(/approved\s*:\s*true/)
    }
  })
})
