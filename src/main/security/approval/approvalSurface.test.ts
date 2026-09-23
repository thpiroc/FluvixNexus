import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'
import * as sharedApproval from '@shared/security/approvalAction'
import * as actionModule from './approvalAction'
import * as auditModule from './approvalAudit'
import * as fingerprintModule from './approvalFingerprint'
import * as idModule from './approvalId'
import * as managerModule from './approvalManager'
import * as summaryModule from './approvalSummary'

/**
 * 承認を迂回できないこと（Security Core v1 の STEP6）。
 *
 * securityPolicySurface（STEP1）・boundarySurface（STEP2）・secretSurface（STEP3）・
 * auditSurface（STEP4）・externalSendSurface（STEP5）と同じく、公開する名前を
 * **一覧で固定**する。名前を足すときはこのテストも書き換えることになり、
 * 「それは承認を飛ばせる口ではないか」を見直す機会が必ず生まれる。
 */

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getVersion: () => '0.0.0',
    getPath: () => ''
  },
  dialog: { showMessageBox: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))

const approvalApi = await import('./index')
const currentModule = await import('./currentApprovalManager')
const dialogModule = await import('./approvalDialog')

/** 承認を飛ばせる・偽装できる・勝手に通せる口に見える名前。 */
const FORBIDDEN_NAME =
  /bypass|skip|disable|override|force|trust|assume|unchecked|insecure|allowAll|autoApprove|approveAll|preApprove|markApproved|setApproved|grant|elevate|unlock|remember|persist|save(?:Approval|State)|rawContent|rawCommand|secretValue|credential|apiKey|unmask|unredact|reveal/i

const DIRECTORY = join(__dirname)

/** 説明文を落として、型に書かれているものだけを読む。 */
function declarationsOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function sourceFiles(): readonly string[] {
  return readdirSync(DIRECTORY)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort()
}

describe('公開する名前', () => {
  it('Approval Manager の入口', () => {
    expect(Object.keys(approvalApi).sort()).toEqual([
      'APPROVAL_TTL_MS',
      // STEP9: Agent の停止で承認待ちを取り消す（取り消す向きにしか働かない）。
      'cancelPendingApprovals',
      'consumeApproval',
      'requestApproval',
      'respondToApproval'
    ])
  })

  it('内部の module も、決めた名前しか公開しない', () => {
    expect(Object.keys(actionModule).sort()).toEqual([
      'APPROVAL_ARG_MAX_LENGTH',
      'APPROVAL_COMMAND_LINE_MAX_LENGTH',
      'APPROVAL_COMMAND_MAX_LENGTH',
      'APPROVAL_CONTENT_MAX_CHARS',
      'APPROVAL_CWD_MAX_LENGTH',
      'APPROVAL_MAX_ARGS',
      'approvalActionKindOf',
      'normalizeApprovalRequest'
    ])
    expect(Object.keys(fingerprintModule).sort()).toEqual(['approvalFingerprint'])
    expect(Object.keys(idModule).sort()).toEqual(['createApprovalId', 'isApprovalId'])
    expect(Object.keys(summaryModule).sort()).toEqual([
      'APPROVAL_SUBJECT_MAX_LENGTH',
      'APPROVAL_TRUNCATION_MARK',
      'approvalSafeSummary',
      'describeTerminalCommand'
    ])
    expect(Object.keys(auditModule).sort()).toEqual([
      'approvalApprovedEvent',
      'approvalDeniedEvent',
      'approvalRequestedEvent'
    ])
    expect(Object.keys(managerModule).sort()).toEqual(['APPROVAL_TTL_MS', 'createApprovalManager'])
    expect(Object.keys(dialogModule).sort()).toEqual(['confirmApprovalNatively'])
    expect(Object.keys(currentModule).sort()).toEqual([
      'cancelPendingApprovals',
      'consumeApproval',
      'requestApproval',
      'respondToApproval'
    ])
    expect(Object.keys(sharedApproval).sort()).toEqual([
      'APPROVAL_ACTION_KINDS',
      'isApprovalActionKind'
    ])
  })

  it('approval フォルダのどのファイルも、迂回できる名前を export していない', () => {
    expect(sourceFiles()).toEqual([
      'approvalAction.ts',
      'approvalAudit.ts',
      'approvalDialog.ts',
      'approvalFingerprint.ts',
      'approvalId.ts',
      'approvalManager.ts',
      'approvalSummary.ts',
      'currentApprovalManager.ts',
      'index.ts'
    ])

    for (const name of sourceFiles()) {
      const exported = readFileSync(join(DIRECTORY, name), 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('export'))

      expect(exported.filter((line) => FORBIDDEN_NAME.test(line))).toEqual([])
    }
  })

  it('Policy と Audit と確認の差し替えは、入口からはできない', () => {
    const source = readFileSync(join(DIRECTORY, 'currentApprovalManager.ts'), 'utf8')

    expect(source).toContain('getCurrentSecurityPolicy')
    expect(source).toContain('recordAuditEvent')
    expect(source).toContain('confirmApprovalNatively')
    expect(readFileSync(join(DIRECTORY, 'index.ts'), 'utf8')).not.toContain('createApprovalManager')
  })

  it('承認の対象は閉じた集合', () => {
    expect([...sharedApproval.APPROVAL_ACTION_KINDS]).toEqual(['file.write', 'terminal.run'])
    expect(Object.isFrozen(sharedApproval.APPROVAL_ACTION_KINDS)).toBe(true)

    for (const kind of ['mcp.write', 'git.commit', 'git.push', 'external-send', 'toString']) {
      expect(sharedApproval.isApprovalActionKind(kind)).toBe(false)
    }
  })

  it('有効期限は短く、固定されている', () => {
    expect(approvalApi.APPROVAL_TTL_MS).toBe(5 * 60 * 1000)
  })
})

describe('Renderer から届く経路', () => {
  it('承認を名乗るチャンネルは、知らせと返事の2本だけ', () => {
    const channels = [...Object.values(IPC_CHANNELS), ...Object.values(IPC_EVENT_CHANNELS)]

    expect(channels.filter((channel) => /approv/i.test(channel)).sort()).toEqual([
      'approval:requested',
      'approval:respond'
    ])
  })

  it('承認を作る / 使い切るチャンネルは無い', () => {
    const channels = [...Object.values(IPC_CHANNELS), ...Object.values(IPC_EVENT_CHANNELS)]

    expect(
      channels.filter((channel) => /consume|request-approval|approve|grant/i.test(channel))
    ).toEqual([])
  })

  it('Preload は、確認の受け取りと意思表示だけを公開している', () => {
    const preload = join(__dirname, '..', '..', '..', 'preload')
    const files = readdirSync(preload, { recursive: true, encoding: 'utf8' }).filter((name) =>
      name.endsWith('.ts')
    )

    expect(files.length).toBeGreaterThan(0)

    for (const name of files) {
      const source = readFileSync(join(preload, name), 'utf8')

      expect(source).not.toMatch(
        /consumeApproval|requestApproval|createApprovalManager|cancelPendingApprovals/
      )
      expect(source).not.toMatch(/approved\s*:\s*true/)
    }
  })

  it('Renderer にも、承認を作る / 使い切る名前は無い', () => {
    const renderer = join(__dirname, '..', '..', '..', 'renderer', 'src')
    const files = readdirSync(renderer, { recursive: true, encoding: 'utf8' }).filter(
      (name) => name.endsWith('.ts') || name.endsWith('.tsx')
    )

    expect(files.length).toBeGreaterThan(0)

    for (const name of files) {
      expect(readFileSync(join(renderer, name), 'utf8')).not.toMatch(
        /consumeApproval|requestApproval|createApprovalManager/
      )
    }
  })

  it('Main の IPC handler は送信元の検証を通った窓だけを Security Core へ渡す', () => {
    const handler = readFileSync(
      join(__dirname, '..', '..', 'ipc', 'handlers', 'approval.ts'),
      'utf8'
    )

    // 基盤（registry.ts）を通す。ipcMain.handle を直に呼ぶ経路は作らない。
    expect(handler).toContain('handleIpc')
    expect(handler).toContain('context.window')
    expect(handler).not.toContain('ipcMain')
    // 承認を作る / 使い切る API は handler から呼ばない。
    expect(handler).not.toMatch(/consumeApproval|requestApproval/)
  })

  it('承認の一括取り消しは、どの IPC handler からも直接は呼ばない（Agent Loop の停止だけ）', () => {
    const handlers = join(__dirname, '..', '..', 'ipc')

    for (const name of readdirSync(handlers, { recursive: true, encoding: 'utf8' }).filter((file) =>
      file.endsWith('.ts')
    )) {
      expect(readFileSync(join(handlers, name), 'utf8')).not.toContain('cancelPendingApprovals')
    }
  })

  it('Renderer が送れるのは continue / cancel の意思表示まで', () => {
    const contract = readFileSync(
      join(__dirname, '..', '..', '..', 'shared', 'ipc', 'contracts', 'approval.ts'),
      'utf8'
    )
    const fields = contract
      .split('\n')
      .flatMap((line) => line.match(/^\s*readonly ([A-Za-z]\w*)/)?.[1] ?? [])

    expect(fields.sort()).toEqual(['actionKind', 'approvalId', 'intent'])
    expect(declarationsOf(contract)).not.toMatch(/approved|decision|token|fingerprint/i)
  })

  it('Renderer へ送る知らせに、本文も fingerprint も載らない', () => {
    const event = readFileSync(
      join(__dirname, '..', '..', '..', 'shared', 'ipc', 'events', 'approval.ts'),
      'utf8'
    )
    const fields = event
      .split('\n')
      .flatMap((line) => line.match(/^\s*readonly ([A-Za-z]\w*)/)?.[1] ?? [])

    expect(fields.sort()).toEqual([
      'actionKind',
      'approvalId',
      'commandSummary',
      'expiresAt',
      'subject',
      'workspacePath'
    ])
    expect(declarationsOf(event)).not.toMatch(/fingerprint|content|diff|stdout|stderr/i)
  })
})

describe('承認は残らない', () => {
  it('状態をディスクへ書かない', () => {
    for (const name of sourceFiles()) {
      const source = readFileSync(join(DIRECTORY, name), 'utf8')

      expect(source).not.toMatch(/from 'fs/)
      expect(source).not.toMatch(/writeFile|readFile|jsonStore|settingsStore|getPath\(/)
    }
  })

  it('Manager は Electron にも Renderer の Store にも依存しない', () => {
    const source = readFileSync(join(DIRECTORY, 'approvalManager.ts'), 'utf8')

    expect(source).not.toContain("from 'electron'")
    expect(source).not.toContain('@renderer')
  })
})

describe('承認の対象', () => {
  it('External Send は承認の対象ではない', () => {
    for (const name of sourceFiles()) {
      expect(readFileSync(join(DIRECTORY, name), 'utf8')).not.toContain('sendThroughExternalGate')
    }
  })

  it('本文を保持する欄は、Main が持つ承認の型にも無い', () => {
    const manager = readFileSync(join(DIRECTORY, 'approvalManager.ts'), 'utf8')
    const stored = manager.slice(
      manager.indexOf('interface StoredApproval'),
      manager.indexOf('export function createApprovalManager')
    )
    const fields = stored
      .split('\n')
      .flatMap((line) => line.match(/^\s*(?:readonly )?([A-Za-z]\w*)(?::|\s*:)/)?.[1] ?? [])

    expect(fields).not.toContain('content')
    expect(fields).not.toContain('command')
    expect(fields).not.toContain('args')
    expect(fields).not.toContain('diff')
    expect(fields).toContain('fingerprint')
  })
})
