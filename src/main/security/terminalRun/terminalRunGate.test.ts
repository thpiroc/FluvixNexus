import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentPermissionMode, SafeTerminalRunResult } from '@shared/security'
import type { AuditEvent } from '../audit/auditEvent'
import {
  createApprovalManager,
  type ApprovalConfirmation,
  type ApprovalManager,
  type ApprovalRequestNotice
} from '../approval/approvalManager'
import { recheckWorkspaceTarget, resolveWorkspaceTarget } from '../boundary/workspaceBoundary'
import type { SecurityPolicy } from '../policy/securityPolicy'
import { SECRET_MASK } from '../secret/secretMasking'
import type { TerminalExecutableResult } from './terminalExecutable'
import { buildTerminalLaunch, type TerminalLaunchSpec } from './terminalLaunch'
import {
  createTerminalRunGate,
  type TerminalProposalNotice,
  type TerminalRunGate,
  type TerminalRunGateDependencies
} from './terminalRunGate'
import { isSameExecutable, type ExecutableIdentity, type RunProcessResult } from './terminalRunIo'

/**
 * Terminal Command Runner（Security Core v1 の STEP8）。
 *
 * Boundary（STEP2）は一時フォルダの本物、Approval Manager（STEP6）も本物を使い、
 * 実行ファイルの解決と起動だけを差し替える。固定したいのは次のこと。
 *
 *   - 承認の前に起動しない・拒否なら起動しない・許可したときだけ1回起動する
 *   - 承認した argv / cwd と、起動する argv / cwd が同じ
 *   - 承認の後の差し替え（cwd・実行ファイル・PATH）では起動しない
 *   - Read なら承認を求めることすらしない
 *   - Audit に引数も出力も載らない。出力は伏せてから返す
 */

const NODE = 'C:\\tools\\node.exe'
const NPM = 'C:\\tools\\npm.cmd'
const TOKEN = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz'

let root: string
let events: AuditEvent[]
let approvalNotices: ApprovalRequestNotice[]
let proposals: TerminalProposalNotice[]
let settled: { readonly proposalId: string; readonly result: SafeTerminalRunResult | null }[]
let launches: { readonly spec: TerminalLaunchSpec; readonly cwd: string }[]

/** Renderer の第1段階の返事。 */
let rendererIntent: 'continue' | 'cancel' | 'none'
/** Main の Native 確認の返事。 */
let confirmation: ApprovalConfirmation
/** Native 確認が出ている間に起きること（差し替えを差し込む）。 */
let duringConfirm: (() => Promise<void>) | null

let permissionMode: AgentPermissionMode
let executables: Map<string, TerminalExecutableResult>
let identities: Map<string, ExecutableIdentity>
let runResult: RunProcessResult

const window = { isDestroyed: () => false }

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'fx-terminal-run-')))

  await mkdir(join(root, 'packages', 'app'), { recursive: true })
  await mkdir(join(root, '.ssh'), { recursive: true })
  await writeFile(join(root, 'README.md'), '# test\n')

  events = []
  approvalNotices = []
  proposals = []
  settled = []
  launches = []
  rendererIntent = 'continue'
  confirmation = 'approve'
  duringConfirm = null
  permissionMode = 'ask'
  executables = new Map([
    ['node', { ok: true, file: NODE, kind: 'program' }],
    ['npm', { ok: true, file: NPM, kind: 'batch' }]
  ])
  identities = new Map([
    [NODE, identity(NODE)],
    [NPM, identity(NPM)]
  ])
  runResult = { kind: 'exited', exitCode: 0, output: { text: 'v22.0.0\n', truncated: false } }
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function identity(realPath: string, mtimeNs = 1n): ExecutableIdentity {
  return { realPath, dev: 1n, ino: BigInt(realPath.length), size: 100n, mtimeNs }
}

function gate(overrides: Partial<TerminalRunGateDependencies> = {}): TerminalRunGate {
  const readPolicy = (): SecurityPolicy => Object.freeze({ permissionMode })

  const manager: ApprovalManager = createApprovalManager({
    readPolicy,
    recordEvent: (event) => events.push(event),
    now: () => Date.now(),
    setTimer: () => () => {},
    notify: (notice) => {
      approvalNotices.push(notice)

      if (rendererIntent === 'none') {
        return
      }

      const intent = rendererIntent

      void Promise.resolve().then(() =>
        manager.respond(
          { approvalId: notice.approvalId, actionKind: notice.actionKind, intent },
          window
        )
      )
    },
    confirm: async () => {
      if (duringConfirm !== null) {
        await duringConfirm()
      }

      return confirmation
    }
  })

  return createTerminalRunGate({
    platform: 'win32',
    readPolicy,
    recordEvent: (event) => events.push(event),
    resolveCwd: (relativePath) => resolveWorkspaceTarget(root, relativePath, 'read'),
    recheckCwd: (target) => recheckWorkspaceTarget(target),
    resolveExecutable: (command) =>
      executables.get(command) ?? { ok: false, denial: 'command-not-found' },
    inspectExecutable: async (file) => identities.get(file) ?? null,
    isSameExecutable,
    buildLaunch: (executable, args) =>
      buildTerminalLaunch(executable, args, { SystemRoot: 'C:\\Windows' }),
    runProcess: async (spec, cwd) => {
      launches.push({ spec, cwd })
      return runResult
    },
    requestApproval: (raw) => manager.request(raw),
    consumeApproval: (id, raw) => manager.consume(id, raw),
    notifyProposed: (notice) => proposals.push(notice),
    notifySettled: (proposalId, result) => settled.push({ proposalId, result }),
    createProposalId: () => `proposal-${proposals.length + 1}`,
    ...overrides
  })
}

function types(): string[] {
  return events.map((event) => event.type)
}

describe('許可したときだけ、承認したものを1回起動する', () => {
  it('続行 → Native で許可 → 承認した argv / cwd のまま1回だけ起動する', async () => {
    const outcome = await gate().run({ command: 'node', args: ['--version'], cwd: 'packages/app' })

    expect(outcome).toMatchObject({ ok: true, exitCode: 0 })
    expect(launches).toEqual([
      {
        spec: { file: NODE, args: ['--version'], windowsVerbatimArguments: false },
        cwd: join(root, 'packages', 'app')
      }
    ])
    expect(types()).toEqual([
      'terminal.requested',
      'approval.requested',
      'approval.approved',
      'terminal.approved',
      'terminal.completed'
    ])
  })

  it('引数はシェルを通さずそのまま渡る（& や | を含んでも1つの引数）', async () => {
    await gate().run({ command: 'node', args: ['-e', 'console.log("a & b | c")'], cwd: '' })

    expect(launches[0].spec.args).toEqual(['-e', 'console.log("a & b | c")'])
    expect(launches[0].cwd).toBe(root)
  })

  it('.cmd は cmd.exe で包み、安全な引数だけを並べる', async () => {
    await gate().run({ command: 'npm', args: ['run', 'test'], cwd: '' })

    expect(launches[0].spec).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/v:off', '/s', '/c', `""${NPM}" run test"`],
      windowsVerbatimArguments: true
    })
  })

  it('終了コードが 0 でなければ、実行はしたが failure として記録する', async () => {
    runResult = { kind: 'exited', exitCode: 2, output: { text: 'fail\n', truncated: false } }

    const outcome = await gate().run({ command: 'node', args: [], cwd: '' })

    expect(outcome).toMatchObject({ ok: true, exitCode: 2 })
    expect(events.at(-1)).toMatchObject({
      type: 'terminal.completed',
      outcome: 'failure',
      reason: 'non-zero-exit'
    })
  })
})

describe('承認の前に起動しない / 拒否なら起動しない', () => {
  it('Read なら承認を求めず、画面にも出さない', async () => {
    permissionMode = 'read'

    const outcome = await gate().run({ command: 'node', args: [], cwd: '' })

    expect(outcome).toEqual({ ok: false, reason: 'read-only-mode', output: null })
    expect(proposals).toEqual([])
    expect(approvalNotices).toEqual([])
    expect(launches).toEqual([])
  })

  it('Policy が読めなければ Read として扱う', async () => {
    const outcome = await gate({
      readPolicy: () => {
        throw new Error('broken')
      }
    }).run({ command: 'node', args: [], cwd: '' })

    expect(outcome).toMatchObject({ ok: false, reason: 'read-only-mode' })
    expect(launches).toEqual([])
  })

  it('画面で取り消せば起動しない（結果は届かない）', async () => {
    rendererIntent = 'cancel'

    const outcome = await gate().run({ command: 'node', args: [], cwd: '' })

    expect(outcome).toMatchObject({ ok: false, reason: 'user-cancelled' })
    expect(launches).toEqual([])
    expect(settled).toEqual([{ proposalId: 'proposal-1', result: null }])
  })

  it('Native で「許可しない」なら起動しない', async () => {
    confirmation = 'cancel'

    const outcome = await gate().run({ command: 'node', args: [], cwd: '' })

    expect(outcome).toMatchObject({ ok: false, reason: 'user-cancelled' })
    expect(launches).toEqual([])
    expect(types()).not.toContain('terminal.approved')
  })

  it('返事を待っている間は起動しない（2件目は run-in-progress）', async () => {
    rendererIntent = 'none'

    const api = gate()
    void api.run({ command: 'node', args: [], cwd: '' })
    await Promise.resolve()

    const second = await api.run({ command: 'node', args: ['--version'], cwd: '' })

    expect(second).toMatchObject({ ok: false, reason: 'run-in-progress' })
    expect(launches).toEqual([])
  })

  it('提案を画面へ知らせられなければ、承認を求めない', async () => {
    const outcome = await gate({
      notifyProposed: () => {
        throw new Error('no window')
      }
    }).run({ command: 'node', args: [], cwd: '' })

    expect(outcome).toMatchObject({ ok: false, reason: 'window-unavailable' })
    expect(approvalNotices).toEqual([])
    expect(launches).toEqual([])
  })
})

describe('承認の後の差し替えでは起動しない', () => {
  it('承認している間に実行ファイルの中身が変わった', async () => {
    duringConfirm = async () => {
      identities.set(NODE, identity(NODE, 2n))
    }

    const outcome = await gate().run({ command: 'node', args: [], cwd: '' })

    expect(outcome).toMatchObject({ ok: false, reason: 'executable-changed' })
    expect(launches).toEqual([])
  })

  it('承認している間に PATH が変わり、別の実体が選ばれるようになった', async () => {
    duringConfirm = async () => {
      executables.set('node', { ok: true, file: 'C:\\other\\node.exe', kind: 'program' })
      identities.set('C:\\other\\node.exe', identity('C:\\other\\node.exe'))
    }

    const outcome = await gate().run({ command: 'node', args: [], cwd: '' })

    expect(outcome).toMatchObject({ ok: false, reason: 'executable-changed' })
    expect(launches).toEqual([])
  })

  it('承認している間に作業ディレクトリが消えた / 別物に差し替えられた', async () => {
    duringConfirm = async () => {
      await rm(join(root, 'packages', 'app'), { recursive: true, force: true })
      await writeFile(join(root, 'packages', 'app'), 'not a directory')
    }

    const outcome = await gate().run({ command: 'node', args: [], cwd: 'packages/app' })

    expect(outcome.ok).toBe(false)
    expect(launches).toEqual([])
  })

  it('承認している間に作業ディレクトリが外へのジャンクションへ差し替えられた', async () => {
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'fx-terminal-outside-')))

    try {
      duringConfirm = async () => {
        await rm(join(root, 'packages', 'app'), { recursive: true, force: true })
        await symlink(outside, join(root, 'packages', 'app'), 'junction')
      }

      const outcome = await gate().run({ command: 'node', args: [], cwd: 'packages/app' })

      expect(outcome.ok).toBe(false)
      expect(launches).toEqual([])
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('Approval の consume を先に使い切られていたら起動しない（1回きり）', async () => {
    let stolen = false

    const outcome = await gate({
      consumeApproval: () => {
        stolen = true
        return { ok: false, reason: 'approval-already-used' }
      }
    }).run({ command: 'node', args: [], cwd: '' })

    expect(stolen).toBe(true)
    expect(outcome).toMatchObject({ ok: false, reason: 'approval-already-used' })
    expect(launches).toEqual([])
  })
})

describe('作業ディレクトリ（Workspace Boundary）', () => {
  it('Workspace の外・絶対パスは拒む（承認を求めない）', async () => {
    for (const cwd of ['../outside', 'C:/Windows', '/etc', 'a\\b']) {
      const outcome = await gate().run({ command: 'node', args: [], cwd })

      expect(outcome.ok).toBe(false)
    }

    expect(approvalNotices).toEqual([])
    expect(launches).toEqual([])
  })

  it('ディレクトリでなければ cwd-not-directory、無ければ not-found', async () => {
    expect(await gate().run({ command: 'node', args: [], cwd: 'README.md' })).toMatchObject({
      reason: 'cwd-not-directory'
    })
    expect(await gate().run({ command: 'node', args: [], cwd: 'missing' })).toMatchObject({
      reason: 'not-found'
    })
  })

  it('Secret の置き場所（.ssh）では実行しない', async () => {
    expect(await gate().run({ command: 'node', args: [], cwd: '.ssh' })).toMatchObject({
      reason: 'secret-file'
    })
  })

  it('ジャンクションを通った作業ディレクトリは、中を指していても拒む', async () => {
    await symlink(join(root, 'packages', 'app'), join(root, 'alias'), 'junction')

    expect(await gate().run({ command: 'node', args: [], cwd: 'alias' })).toMatchObject({
      reason: 'aliased-target'
    })
    expect(launches).toEqual([])
  })
})

describe('コマンドと引数', () => {
  it('PATH 上の名前でなければ拒む（絶対パス・Workspace の中の実行ファイル）', async () => {
    for (const command of ['C:\\Windows\\System32\\cmd.exe', './gradlew', 'scripts/run']) {
      expect(await gate().run({ command, args: [], cwd: '' })).toMatchObject({
        reason: 'unsupported-command'
      })
    }

    expect(launches).toEqual([])
  })

  it('実体が Workspace の中にある実行ファイルは使わない', async () => {
    const inside = join(root, 'tool.exe')

    executables.set('tool', { ok: true, file: 'C:\\bin\\tool.exe', kind: 'program' })
    identities.set('C:\\bin\\tool.exe', identity(inside))

    expect(await gate().run({ command: 'tool', args: [], cwd: '' })).toMatchObject({
      reason: 'unsupported-command'
    })
  })

  it('.cmd へ危険な文字を渡そうとしたら、承認を求めずに拒む', async () => {
    for (const arg of ['x&whoami', '%PATH%', 'a b', '"q"', '']) {
      const outcome = await gate().run({ command: 'npm', args: ['run', arg], cwd: '' })

      expect(outcome).toMatchObject({ ok: false, reason: 'unsafe-batch-argument' })
    }

    expect(approvalNotices).toEqual([])
    expect(launches).toEqual([])
  })

  it('形の違う要求は拒む（受け取るのは command / args / cwd だけ）', async () => {
    for (const request of [
      null,
      'node --version',
      { command: 'node', args: '--version', cwd: '' },
      { command: 'node', args: [], cwd: undefined },
      { command: 'node', args: ['a\u202Eb'], cwd: '' },
      { command: 'node', args: ['x'.repeat(600)], cwd: '' },
      { command: 'node', args: Array.from({ length: 5 }, () => 'y'.repeat(500)), cwd: '' }
    ]) {
      expect(await gate().run(request)).toMatchObject({ ok: false })
    }

    expect(launches).toEqual([])
  })

  it('shell / approved / executable のような余計な欄は読まない', async () => {
    await gate().run({
      command: 'node',
      args: ['--version'],
      cwd: '',
      shell: true,
      approved: true,
      executable: 'C:\\evil.exe',
      env: { EVIL: '1' }
    })

    expect(launches[0].spec).toEqual({
      file: NODE,
      args: ['--version'],
      windowsVerbatimArguments: false
    })
  })
})

describe('表示と承認の知らせ', () => {
  it('提案と承認の知らせは同じ1行・同じ場所を指し、絶対パスを含まない', async () => {
    await gate().run({ command: 'node', args: ['-e', 'x y'], cwd: 'packages/app' })

    expect(proposals[0].command).toEqual({
      commandName: 'node',
      commandArgs: ['-e', 'x y'],
      commandSummary: 'node -e "x y"',
      workspacePath: 'packages/app',
      viaBatch: false,
      secretMasked: false
    })
    expect(approvalNotices[0].commandSummary).toBe(proposals[0].command.commandSummary)
    expect(approvalNotices[0].workspacePath).toBe(proposals[0].command.workspacePath)
    expect(JSON.stringify([proposals, approvalNotices, settled])).not.toContain(root)
    expect(JSON.stringify([proposals, approvalNotices, settled])).not.toContain('tools')
  })

  it('引数の Secret は画面へは伏せ、起動には元の値を使う', async () => {
    await gate().run({ command: 'node', args: ['--token', TOKEN], cwd: '' })

    expect(proposals[0].command.commandArgs).toEqual(['--token', SECRET_MASK])
    expect(proposals[0].command.secretMasked).toBe(true)
    expect(approvalNotices[0].commandSummary).not.toContain(TOKEN)
    expect(launches[0].spec.args).toEqual(['--token', TOKEN])
  })
})

describe('出力と Audit', () => {
  it('出力は伏せてから返し、画面へも伏せた後のものだけを送る', async () => {
    runResult = {
      kind: 'exited',
      exitCode: 0,
      output: { text: `GITHUB_TOKEN=${TOKEN}\ndone\n`, truncated: false }
    }

    const outcome = await gate().run({ command: 'node', args: [], cwd: '' })

    if (!outcome.ok) {
      throw new Error(outcome.reason)
    }

    expect(outcome.output.text).not.toContain(TOKEN)
    expect(outcome.output.secretMasked).toBe(true)
    expect(JSON.stringify(settled)).not.toContain(TOKEN)
    expect(settled[0].result).toMatchObject({ status: 'completed', exitCode: 0 })
    expect(settled[0].result?.output.lines).toContain('done')
  })

  it('Audit に引数・出力・絶対パスは載らない（伏せた数だけ）', async () => {
    runResult = {
      kind: 'exited',
      exitCode: 0,
      output: { text: `secret ${TOKEN}\n`, truncated: false }
    }

    await gate().run({ command: 'node', args: ['--token', TOKEN, '-m', 'hello body'], cwd: '' })

    const serialized = JSON.stringify(events)

    expect(serialized).not.toContain(TOKEN)
    expect(serialized).not.toContain('hello body')
    expect(serialized).not.toContain('--token')
    expect(serialized).not.toContain(root)
    expect(serialized).not.toContain(NODE)
    expect(events.at(-1)).toMatchObject({
      type: 'terminal.completed',
      subject: 'node',
      userNoticeRequired: true
    })
  })

  it('時間切れは failed として記録し、それまでの出力を伏せて返す', async () => {
    runResult = { kind: 'timed-out', output: { text: `partial ${TOKEN}\n`, truncated: false } }

    const outcome = await gate().run({ command: 'node', args: [], cwd: '' })

    expect(outcome).toMatchObject({ ok: false, reason: 'timed-out' })
    expect(JSON.stringify(outcome)).not.toContain(TOKEN)
    expect(events.at(-1)).toMatchObject({ type: 'terminal.failed', reason: 'timed-out' })
    expect(settled[0].result).toMatchObject({ status: 'timed-out', exitCode: null })
  })

  it('起動できなければ spawn-failed', async () => {
    runResult = { kind: 'spawn-failed', error: new Error(`spawn ${NODE} ENOENT`) }

    const outcome = await gate().run({ command: 'node', args: [], cwd: '' })

    expect(outcome).toEqual({ ok: false, reason: 'spawn-failed', output: null })
    expect(events.at(-1)).toMatchObject({ type: 'terminal.failed', reason: 'spawn-failed' })
    expect(settled[0].result).toMatchObject({ status: 'failed' })
  })

  it('Audit が落ちても結論は変わらない', async () => {
    const outcome = await gate({
      recordEvent: () => {
        throw new Error('disk full')
      }
    }).run({ command: 'node', args: [], cwd: '' })

    expect(outcome).toMatchObject({ ok: true })
    expect(launches).toHaveLength(1)
  })
})
