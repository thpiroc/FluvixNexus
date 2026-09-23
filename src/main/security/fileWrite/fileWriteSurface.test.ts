import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'
import * as auditModule from './fileWriteAudit'
import * as contentModule from './fileWriteContent'
import * as diffModule from './fileWriteDiff'
import * as gateModule from './fileWriteGate'
import * as ioModule from './fileWriteIo'
import * as maskModule from './secretLineMask'
import * as safeDiffModule from './safeFileWriteDiff'

/**
 * File Write を迂回できないこと（Security Core v1 の STEP7）。
 *
 * securityPolicySurface（STEP1）・boundarySurface（STEP2）・secretSurface（STEP3）・
 * auditSurface（STEP4）・externalSendSurface（STEP5）・approvalSurface（STEP6）と
 * 同じく、公開する名前を**一覧で固定**する。名前を足すときはこのテストも書き換える
 * ことになり、「それは承認や確認を飛ばせる口ではないか」を見直す機会が必ず生まれる。
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

const fileWriteApi = await import('./index')
const currentModule = await import('./currentFileWriteGate')
const harnessModule = await import('./fileWriteHarness')

/** 承認や確認を飛ばせる・偽装できる口に見える名前。 */
const FORBIDDEN_NAME =
  /bypass|skip|disable|override|force|trust|assume|unchecked|insecure|unsafe|raw(?:Write|Content)|writeDirect|directWrite|noApproval|withoutApproval|autoApprove|preApprove|markApproved|setApproved|grant|elevate|unmask|unredact|reveal|secretValue|credential|apiKey/i

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
function declarationsOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('公開する名前', () => {
  it('File Write Gate の入口は1つだけ', () => {
    expect(Object.keys(fileWriteApi).sort()).toEqual(['writeAgentWorkspaceFile'])
  })

  it('内部の module も、決めた名前しか公開しない', () => {
    expect(Object.keys(currentModule).sort()).toEqual(['writeAgentWorkspaceFile'])
    expect(Object.keys(gateModule).sort()).toEqual(['createFileWriteGate'])
    expect(Object.keys(ioModule).sort()).toEqual(['readCurrentFile', 'writeConfirmedFile'])
    expect(Object.keys(contentModule).sort()).toEqual(['prepareFileWriteContent'])
    expect(Object.keys(diffModule).sort()).toEqual([
      'DIFF_LCS_MAX_LINES',
      'createLineDiff',
      'splitLines'
    ])
    expect(Object.keys(safeDiffModule).sort()).toEqual([
      'SAFE_DIFF_CONTROL_MARK',
      'SAFE_DIFF_LINE_MAX_LENGTH',
      'SAFE_DIFF_MAX_LINES',
      'SAFE_DIFF_TRUNCATION_MARK',
      'createSafeFileWriteDiff'
    ])
    expect(Object.keys(maskModule).sort()).toEqual(['maskSecretLines'])
    expect(Object.keys(auditModule).sort()).toEqual([
      'fileWriteApprovedEvent',
      'fileWriteDeniedEvent',
      'fileWriteFailedEvent',
      'fileWriteRequestedEvent',
      'fileWriteSucceededEvent'
    ])
    expect(Object.keys(harnessModule).sort()).toEqual([
      'canUseFileWriteHarness',
      'proposeHarnessWriteToExistingFile',
      'proposeHarnessWriteToNewFile'
    ])
  })

  it('fileWrite フォルダのどのファイルも、迂回できる名前を export していない', () => {
    expect(sourceFiles()).toEqual([
      'currentFileWriteGate.ts',
      'fileWriteAudit.ts',
      'fileWriteContent.ts',
      'fileWriteDiff.ts',
      'fileWriteGate.ts',
      'fileWriteHarness.ts',
      'fileWriteIo.ts',
      'index.ts',
      'safeFileWriteDiff.ts',
      'secretLineMask.ts'
    ])

    for (const name of sourceFiles()) {
      const exported = readFileSync(join(DIRECTORY, name), 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('export'))

      expect(exported.filter((line) => FORBIDDEN_NAME.test(line))).toEqual([])
    }
  })

  it('Policy と Boundary と承認と Audit の差し替えは、入口からはできない', () => {
    const source = readFileSync(join(DIRECTORY, 'currentFileWriteGate.ts'), 'utf8')

    expect(source).toContain('getCurrentSecurityPolicy')
    expect(source).toContain('resolveAgentWorkspaceTarget')
    expect(source).toContain('requestApproval')
    expect(source).toContain('consumeApproval')
    expect(source).toContain('recordAuditEvent')
    expect(readFileSync(join(DIRECTORY, 'index.ts'), 'utf8')).not.toContain('createFileWriteGate')
  })
})

describe('Renderer / Agent から届かない', () => {
  it('Agent の File Write を頼める IPC チャンネルは無い', () => {
    const channels = [...Object.values(IPC_CHANNELS), ...Object.values(IPC_EVENT_CHANNELS)]

    // Agent の File Write に関するチャンネルは、Main → Renderer の知らせ2本だけ
    // （STEP8 の agent-terminal:* は terminalRunSurface.test.ts が見る）。
    expect(Object.values(IPC_CHANNELS).filter((channel) => /agent/i.test(channel))).toEqual([])
    expect(channels.filter((channel) => /agent-file-write/i.test(channel)).sort()).toEqual([
      'agent-file-write:proposed',
      'agent-file-write:settled'
    ])
  })

  it('Preload に、書き込みを頼む / 本文を渡す名前は無い', () => {
    const preload = join(SRC, 'preload')

    for (const name of filesUnder(preload)) {
      const source = readFileSync(join(preload, name), 'utf8')

      expect(source).not.toMatch(/writeAgentWorkspaceFile|createFileWriteGate|writeConfirmedFile/)
      expect(source).not.toMatch(/AGENT_FILE_WRITE_[A-Z_]*(?<!PROPOSED)(?<!SETTLED)\b/)
    }
  })

  it('Renderer にも、Gate を呼ぶ名前は無い', () => {
    const renderer = join(SRC, 'renderer', 'src')

    for (const name of filesUnder(renderer)) {
      expect(readFileSync(join(renderer, name), 'utf8')).not.toMatch(
        /writeAgentWorkspaceFile|createFileWriteGate|writeConfirmedFile|readCurrentFile/
      )
    }
  })

  it('Renderer から Main へ送れるのは、承認の意思表示だけ', () => {
    const renderer = join(SRC, 'renderer', 'src', 'agent')

    for (const name of filesUnder(renderer)) {
      const source = readFileSync(join(renderer, name), 'utf8')

      // files ドメインの書き込み API（人の保存の経路）を Agent の画面から呼ばない。
      expect(source).not.toMatch(/fluvix\.files\./)
      expect(source).not.toMatch(/approved\s*:\s*true/)
    }
  })

  it('Renderer へ送る知らせに、exact な本文も fingerprint も載らない', () => {
    const event = readFileSync(join(SRC, 'shared', 'ipc', 'events', 'agentFileWrite.ts'), 'utf8')
    const fields = event
      .split('\n')
      .flatMap((line) => line.match(/^\s*readonly ([A-Za-z]\w*)/)?.[1] ?? [])

    expect(fields.sort()).toEqual(['diff', 'newFile', 'proposalId', 'proposalId', 'workspacePath'])

    const declarations = event.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    expect(declarations).not.toMatch(/fingerprint|content|approved|absolutePath|realPath/i)
  })

  it('表示用の Diff の型に、本文を戻す欄は無い', () => {
    const shared = readFileSync(join(SRC, 'shared', 'security', 'fileWriteDiff.ts'), 'utf8')
    const declarations = shared.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    expect(declarations).not.toMatch(/content|fingerprint|approved|editable/i)
  })
})

describe('人の保存とは別の経路', () => {
  it('Gate は既存の書き込み（files/writeWorkspaceFile.ts）を呼ばない', () => {
    for (const name of sourceFiles()) {
      const code = declarationsOf(readFileSync(join(DIRECTORY, name), 'utf8'))

      expect(code).not.toContain('writeWorkspaceFile')
      expect(code).not.toContain('mutateWorkspaceEntry')
      expect(code).not.toContain('saveFileAs')
    }
  })

  it('既存の files の handler は、Gate を呼ばない（人の保存はそのまま）', () => {
    const handler = readFileSync(join(SRC, 'main', 'ipc', 'handlers', 'files.ts'), 'utf8')

    expect(handler).not.toMatch(/writeAgentWorkspaceFile|fileWrite/)
  })

  it('人の保存の経路は残っている', () => {
    expect(Object.values(IPC_CHANNELS)).toContain('files:write-file')
  })
})

describe('raw な fs へ落ちない', () => {
  it('パスを渡して書く fs の API を使わない（ハンドル越しだけ）', () => {
    for (const name of sourceFiles()) {
      const source = readFileSync(join(DIRECTORY, name), 'utf8')
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

      expect(code).not.toMatch(/\bwriteFileSync\b/)
      expect(code).not.toMatch(/from 'fs'$/m)
      // fs/promises から取り込んでよいのは、開く・状態を見る・作ったものを消す、まで。
      expect(code).not.toMatch(/\brename\b|\bcopyFile\b|\bappendFile\b|\bchmod\b/)
    }
  })

  it('書き込みは fileWriteIo.ts の1か所だけが行う', () => {
    const io = readFileSync(join(DIRECTORY, 'fileWriteIo.ts'), 'utf8')

    expect(io).toContain('confirmOpenedWorkspaceFile')
    expect(io).toContain("'wx+'")
    expect(io).toContain("'r+'")

    for (const name of sourceFiles()) {
      if (name === 'fileWriteIo.ts') {
        continue
      }

      expect(readFileSync(join(DIRECTORY, name), 'utf8')).not.toMatch(/from 'fs\/promises'/)
    }
  })
})

describe('開発用の足場', () => {
  it('配布ビルドでは使えない（isDevelopment を見る）', () => {
    const harness = readFileSync(join(DIRECTORY, 'fileWriteHarness.ts'), 'utf8')

    expect(harness).toContain('isDevelopment')
    expect(harness).toContain('canUseFileWriteHarness')
    // Gate をそのまま呼ぶ（Boundary も Policy も承認も同じように通る）。
    expect(harness).toContain('writeAgentWorkspaceFile')
  })

  it('足場は IPC も Preload も通らない', () => {
    for (const directory of [join(SRC, 'preload'), join(SRC, 'renderer', 'src')]) {
      for (const name of filesUnder(directory)) {
        expect(readFileSync(join(directory, name), 'utf8')).not.toMatch(
          /fileWriteHarness|proposeHarnessWrite|canUseFileWriteHarness/
        )
      }
    }
  })

  it('足場を呼ぶのは、開発時だけ作られるメニューから', () => {
    const menu = readFileSync(join(SRC, 'main', 'app', 'menu.ts'), 'utf8')

    expect(menu).toContain('isDevelopment')
    expect(menu).toContain('proposeHarnessWriteToExistingFile')
    expect(menu).toContain('proposeHarnessWriteToNewFile')
  })
})
