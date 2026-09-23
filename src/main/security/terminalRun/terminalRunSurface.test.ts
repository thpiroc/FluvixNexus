import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'
import * as auditModule from './terminalRunAudit'
import * as commandModule from './terminalCommand'
import * as executableModule from './terminalExecutable'
import * as gateModule from './terminalRunGate'
import * as ioModule from './terminalRunIo'
import * as launchModule from './terminalLaunch'
import * as outputModule from './terminalOutput'

/**
 * Terminal Command Runner を迂回できないこと（Security Core v1 の STEP8）。
 *
 * STEP1〜STEP7 の surface test と同じく、公開する名前を**一覧で固定**する。
 * 名前を足すときはこのテストも書き換えることになり、「それは承認を飛ばせる口・
 * シェルを通せる口ではないか」を見直す機会が必ず生まれる。
 */

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getVersion: () => '0.0.0',
    getPath: () => ''
  },
  dialog: { showMessageBox: vi.fn(), showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null }
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))

const terminalRunApi = await import('./index')
const currentModule = await import('./currentTerminalRunGate')
const harnessModule = await import('./terminalRunHarness')

/** 承認を飛ばせる・シェルを通せる・偽装できる口に見える名前。 */
const FORBIDDEN_NAME =
  /bypass|skip|disable|override|force|trust|assume|unchecked|insecure|unsafe(?!BatchArgument)|runRaw|rawCommand|execDirect|directExec|runShell|shellCommand|noApproval|withoutApproval|autoApprove|preApprove|markApproved|setApproved|grant|elevate|unmask|unredact|reveal|secretValue|credential|apiKey/i

const DIRECTORY = join(__dirname)
const SRC = join(__dirname, '..', '..', '..')

function sourceFiles(): readonly string[] {
  return readdirSync(DIRECTORY)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort()
}

function filesUnder(directory: string): readonly string[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' }).filter(
    (name) => name.endsWith('.ts') || name.endsWith('.tsx')
  )
}

/** 説明文を落として、コードに書かれているものだけを読む。 */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('公開する名前', () => {
  it('入口は runAgentTerminalCommand の1つだけ', () => {
    expect(Object.keys(terminalRunApi).sort()).toEqual(['runAgentTerminalCommand'])
    expect(Object.keys(currentModule).sort()).toEqual(['runAgentTerminalCommand'])
  })

  it('内部の module も、決めた名前しか公開しない', () => {
    expect(Object.keys(gateModule).sort()).toEqual(['createTerminalRunGate'])
    expect(Object.keys(commandModule).sort()).toEqual([
      'WINDOWS_EXECUTABLE_EXTENSIONS',
      'executableKindOf',
      'executableNameCandidates',
      'isAcceptableCommandName',
      'isSafeBatchArgument',
      'isSafeBatchPath'
    ])
    expect(Object.keys(executableModule).sort()).toEqual([
      'isInsideWorkspaceRoot',
      'resolveTerminalExecutable'
    ])
    expect(Object.keys(launchModule).sort()).toEqual(['buildTerminalLaunch'])
    expect(Object.keys(outputModule).sort()).toEqual([
      'TERMINAL_OUTPUT_DISPLAY_MAX_LINES',
      'TERMINAL_OUTPUT_DISPLAY_MAX_LINE_LENGTH',
      'TERMINAL_OUTPUT_MAX_CHARS',
      'createTerminalOutputCollector',
      'normalizeTerminalText',
      'sanitizeTerminalOutput',
      'terminalOutputDisplay'
    ])
    expect(Object.keys(ioModule).sort()).toEqual([
      'TERMINAL_RUN_TIMEOUT_MS',
      'executableExists',
      'inspectExecutable',
      'isSameExecutable',
      'runTerminalProcess'
    ])
    expect(Object.keys(auditModule).sort()).toEqual([
      'terminalApprovedEvent',
      'terminalCompletedEvent',
      'terminalDeniedEvent',
      'terminalFailedEvent',
      'terminalRequestedEvent'
    ])
    expect(Object.keys(harnessModule).sort()).toEqual([
      'canUseTerminalRunHarness',
      'proposeHarnessCommand',
      'proposeHarnessCommandInFolder'
    ])
  })

  it('迂回・シェル・偽装にあたる名前が1つも無い', () => {
    const names = [
      ...Object.keys(terminalRunApi),
      ...Object.keys(currentModule),
      ...Object.keys(gateModule),
      ...Object.keys(commandModule),
      ...Object.keys(executableModule),
      ...Object.keys(launchModule),
      ...Object.keys(outputModule),
      ...Object.keys(ioModule),
      ...Object.keys(auditModule),
      ...Object.keys(harnessModule)
    ]

    expect(names.filter((name) => FORBIDDEN_NAME.test(name))).toEqual([])
  })

  it('時間の上限は 120 秒で固定', () => {
    expect(ioModule.TERMINAL_RUN_TIMEOUT_MS).toBe(120_000)
  })
})

describe('シェルを通さない', () => {
  it('child_process を読むのは terminalRunIo.ts の1か所だけ', () => {
    for (const name of sourceFiles()) {
      const code = codeOf(readFileSync(join(DIRECTORY, name), 'utf8'))

      if (name === 'terminalRunIo.ts') {
        expect(code).toMatch(/from 'child_process'/)
        continue
      }

      expect(code).not.toMatch(/child_process|node-pty/)
    }
  })

  it('1本の文字列をシェルに解釈させる API を使わない', () => {
    for (const name of sourceFiles()) {
      const code = codeOf(readFileSync(join(DIRECTORY, name), 'utf8'))

      // 正規表現の `.exec(` は対象外（child_process の exec だけを見る）。
      expect(code).not.toMatch(/(?<!\.)\bexec\s*\(|\bexecSync\b|\bexecFileSync\b|\bspawnSync\b/)
      expect(code).not.toMatch(/shell\s*:\s*true/)
    }

    const io = codeOf(readFileSync(join(DIRECTORY, 'terminalRunIo.ts'), 'utf8'))

    expect(io).toMatch(/shell:\s*false/)
    expect(io).toMatch(/'ignore',\s*'pipe',\s*'pipe'/)
  })

  it('人間用 Terminal（node-pty・terminal:write）へ流さない', () => {
    for (const name of sourceFiles()) {
      const code = codeOf(readFileSync(join(DIRECTORY, name), 'utf8'))

      expect(code).not.toMatch(/terminalSessions|writeTerminalInput|createTerminalSession/)
      expect(code).not.toMatch(/TERMINAL_WRITE|terminal:write/)
    }
  })
})

describe('Renderer / Preload から届かない', () => {
  it('Agent を名乗る要求（Renderer → Main）のチャンネルは無く、知らせは片道の4本だけ', () => {
    expect(
      Object.values(IPC_CHANNELS).filter((channel) => /agent|terminal-run/i.test(channel))
    ).toEqual([])
    expect(
      Object.values(IPC_EVENT_CHANNELS)
        .filter((channel) => /agent-terminal/i.test(channel))
        .sort()
    ).toEqual(['agent-terminal:proposed', 'agent-terminal:settled'])
  })

  it('人間用 Terminal の要求チャンネルは STEP8 で増えていない', () => {
    expect(
      Object.values(IPC_CHANNELS)
        .filter((channel) => channel.startsWith('terminal:'))
        .sort()
    ).toEqual([
      'terminal:create',
      'terminal:dispose',
      'terminal:list-busy',
      'terminal:list-shells',
      'terminal:resize',
      'terminal:write'
    ])
  })

  it('Preload にも Renderer にも、Runner を呼ぶ名前は無い', () => {
    for (const directory of [join(SRC, 'preload'), join(SRC, 'renderer', 'src')]) {
      for (const name of filesUnder(directory)) {
        expect(readFileSync(join(directory, name), 'utf8')).not.toMatch(
          /runAgentTerminalCommand|createTerminalRunGate|runTerminalProcess|terminalRunHarness|proposeHarnessCommand/
        )
      }
    }
  })

  it('Preload の agent は購読だけ（Main を呼ぶ関数が無い）', () => {
    const agent = codeOf(readFileSync(join(SRC, 'preload', 'api', 'agent.ts'), 'utf8'))

    expect(agent).not.toMatch(/invoke|ipcRenderer\.send/)
    expect(agent.match(/subscribeIpcEvent\(/g)).toHaveLength(4)
  })

  it('Renderer の Terminal の画面は、承認の意思表示しか Main へ送らない', () => {
    const renderer = join(SRC, 'renderer', 'src', 'agent')

    for (const name of filesUnder(renderer).filter((file) => /terminal/i.test(file))) {
      const source = codeOf(readFileSync(join(renderer, name), 'utf8'))

      expect(source).not.toMatch(/fluvix\.terminal\./)
      expect(source).not.toMatch(/approved\s*:\s*true/)
      expect(source).not.toMatch(/dangerouslySetInnerHTML|contentEditable|<input|<textarea/)
    }
  })

  it('Renderer へ送る知らせに、exact な argv・絶対パス・raw な出力の欄は無い', () => {
    for (const file of [
      join(SRC, 'shared', 'ipc', 'events', 'agentTerminal.ts'),
      join(SRC, 'shared', 'security', 'terminalRun.ts')
    ]) {
      const declarations = codeOf(readFileSync(file, 'utf8'))

      expect(declarations).not.toMatch(
        /fingerprint|approved|absolutePath|realPath|executable\b|rawOutput|stdout|stderr|env\b|shell/i
      )
    }
  })
})

describe('開発用の足場', () => {
  it('配布ビルドでは使えず、Runner をそのまま呼ぶ（固定の一覧から選ぶだけ）', () => {
    const harness = readFileSync(join(DIRECTORY, 'terminalRunHarness.ts'), 'utf8')

    expect(harness).toContain('isDevelopment')
    expect(harness).toContain('canUseTerminalRunHarness')
    expect(harness).toContain('runAgentTerminalCommand')
    // 任意のコマンドを受け取る口（入力欄）は作らない。
    expect(codeOf(harness)).not.toMatch(/prompt\(|showInputBox|<input/)
  })

  it('足場の項目は開発時のメニューにしか出ない', () => {
    const menu = readFileSync(join(SRC, 'main', 'app', 'menu.ts'), 'utf8')

    expect(menu).toContain('proposeHarnessCommand')
    expect(menu.indexOf('if (!isDevelopment)')).toBeLessThan(menu.indexOf('harnessCommandItem('))
  })
})
