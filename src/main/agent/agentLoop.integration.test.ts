import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentPermissionMode, ApprovalActionKind } from '@shared/security'
import { readWorkspaceDirectory } from '../files/readWorkspaceDirectory'
import { searchWorkspaceFileContents } from '../files/searchWorkspaceFileContents'
import {
  createApprovalManager,
  type ApprovalManager,
  type ApprovalRequestNotice
} from '../security/approval/approvalManager'
import type { AuditEvent } from '../security/audit/auditEvent'
import {
  recheckWorkspaceTarget,
  resolveWorkspaceTarget
} from '../security/boundary/workspaceBoundary'
import { createExternalSendGate } from '../security/externalSend/externalSendGate'
import { createFileWriteGate } from '../security/fileWrite/fileWriteGate'
import { readCurrentFile, writeConfirmedFile } from '../security/fileWrite/fileWriteIo'
import { createReadToolsGate } from '../security/readTools/readToolsGate'
import {
  confirmPinnedWorkspaceRoot,
  listPinnedWorkspaceDirectory,
  readVerifiedFileBytes,
  resolvePinnedWorkspaceTarget
} from '../security/readTools/readToolsIo'
import { createSideEffectLock } from '../security/sideEffect/sideEffectLock'
import {
  buildTerminalLaunch,
  type TerminalLaunchSpec
} from '../security/terminalRun/terminalLaunch'
import { createTerminalRunGate } from '../security/terminalRun/terminalRunGate'
import { isSameExecutable, type RunProcessResult } from '../security/terminalRun/terminalRunIo'
import { createAgentLoop, type AgentLoop } from './agentLoop'
import { createScriptedProvider, SCRIPTED_E2E_CONTENT, SCRIPTED_E2E_FILE } from './scriptedProvider'

/**
 * Agent Loop の End-to-End（Security Core v1 の STEP9 の完了条件を自動テストで）。
 *
 * ```
 * 利用者の指示 → Read 系 Action → Scripted Provider の判断 → File Write の提案 → 二段階承認
 *   → Terminal の提案 → 二段階承認 → Tool の結果を安全に Agent へ返す → complete → 最終回答
 * ```
 *
 * Security Core は**本物をつなぐ** ── Boundary（一時フォルダ）・Read Tool Gate・Approval
 * Manager・File Write Gate（実際にディスクへ書く）・Terminal Command Runner・共有ロック・
 * External Send Gate。差し替えるのは、Renderer の第1段階の返事・Main の Native Dialog の返事・
 * 実行ファイルの解決と起動（プロセスは立てない）だけ。
 */

const NODE = 'C:\\tools\\node.exe'

let root: string
let events: AuditEvent[]
let mode: AgentPermissionMode
/** Renderer の第1段階の返事（File Write / Terminal ごと）。 */
let intents: {
  'file.write': 'continue' | 'cancel' | 'none'
  'terminal.run': 'continue' | 'cancel' | 'none'
}
let launches: { readonly spec: TerminalLaunchSpec; readonly cwd: string }[]
let manager: ApprovalManager
/** Renderer へ届いた承認の知らせ（届いた順）。 */
let notices: ApprovalRequestNotice[]
/** 承認の知らせを待っているテスト。 */
let noticeWaiters: ((notice: ApprovalRequestNotice) => void)[]
/**
 * Gate が**ロックを取った後・承認を求める前**の I/O（File Write は Boundary の解決、
 * Terminal は作業ディレクトリの解決）で止める栓。`reached` は Gate がそこへ来たこと、
 * `release` は先へ進めること。
 */
let holds: Partial<Record<ApprovalActionKind, { reached: Deferred; release: Deferred }>>
/** このテストで作った Workspace（切り替えを含む）。後片付け用。 */
let roots: string[]
/** 今のテストの Loop（後片付け用）。 */
let currentLoop: AgentLoop | null

const window = { isDestroyed: () => false }

interface Deferred {
  readonly promise: Promise<void>
  readonly resolve: () => void
}

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })

  return { promise, resolve }
}

async function createWorkspace(): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'fx-agent-e2e-')))

  roots.push(path)
  await mkdir(join(path, 'src'), { recursive: true })
  await writeFile(join(path, 'src', 'app.ts'), 'export const value = 1 // TODO: tidy\n')
  await writeFile(join(path, '.env'), 'API_KEY=A1b2C3d4E5f6G7h8\n')

  return path
}

beforeEach(async () => {
  roots = []
  root = await createWorkspace()

  events = []
  mode = 'ask'
  intents = { 'file.write': 'continue', 'terminal.run': 'continue' }
  launches = []
  notices = []
  noticeWaiters = []
  holds = {}
  currentLoop = null
})

afterEach(async () => {
  /*
    途中で落ちたテストの Loop・承認・ロックを次のテストへ残さない。
    **判定はすべて各テストの中で済んでいる** ── ここは後片付けだけで、race を隠す場所ではない。
  */
  if (currentLoop !== null) {
    for (const hold of Object.values(holds)) {
      hold?.release.resolve()
    }

    currentLoop.stop()
    manager.cancelAll()
    await currentLoop.whenIdle()
  }

  for (const path of roots) {
    await rm(path, { recursive: true, force: true })
  }
})

/** その種類の承認が Renderer へ知らされるまで待つ（ポーリングしない）。 */
function approvalNotified(kind: ApprovalActionKind): Promise<ApprovalRequestNotice> {
  const seen = notices.find((notice) => notice.actionKind === kind)

  if (seen !== undefined) {
    return Promise.resolve(seen)
  }

  return new Promise((resolve) => {
    noticeWaiters.push((notice) => {
      if (notice.actionKind === kind) {
        resolve(notice)
      }
    })
  })
}

/** Gate が、ロックを取った後・承認を求める前の I/O で止まるようにする。 */
function holdBeforeApproval(kind: ApprovalActionKind): {
  reached: Promise<void>
  release: () => void
} {
  const hold = { reached: deferred(), release: deferred() }

  holds[kind] = hold

  return { reached: hold.reached.promise, release: hold.release.resolve }
}

/** 栓で止まっているところへ来たら、そこで待つ。 */
async function passHold(kind: ApprovalActionKind): Promise<void> {
  const hold = holds[kind]

  if (hold !== undefined) {
    hold.reached.resolve()
    await hold.release.promise
  }
}

function system() {
  const readPolicy = () => Object.freeze({ permissionMode: mode })
  const recordEvent = (event: AuditEvent): void => {
    events.push(event)
  }
  const lock = createSideEffectLock()

  manager = createApprovalManager({
    readPolicy,
    recordEvent,
    now: () => Date.now(),
    setTimer: () => () => {},
    notify: (notice) => {
      notices.push(notice)

      for (const waiter of noticeWaiters) {
        waiter(notice)
      }

      const intent = intents[notice.actionKind]

      if (intent === 'none') {
        return
      }

      void Promise.resolve().then(() =>
        manager.respond(
          { approvalId: notice.approvalId, actionKind: notice.actionKind, intent },
          window
        )
      )
    },
    // Main の Native Dialog（第2段階）。利用者は「許可する」を押す。
    confirm: async () => 'approve'
  })

  const fileWrite = createFileWriteGate({
    readPolicy,
    recordEvent,
    resolveTarget: async (path) => {
      // 本物と同じく、呼ばれた時点の Workspace root を使う（currentWorkspaceBoundary.ts）。
      const workspace = root

      await passHold('file.write')

      return resolveWorkspaceTarget(workspace, path, 'write')
    },
    recheckTarget: (target) => recheckWorkspaceTarget(target),
    readCurrent: readCurrentFile,
    writeFile: writeConfirmedFile,
    requestApproval: (raw, signal) => manager.request(raw, signal),
    consumeApproval: (id, raw) => manager.consume(id, raw),
    notifyProposed: () => {},
    notifySettled: () => {},
    createProposalId: () => 'proposal',
    acquireSideEffect: lock.acquire
  })

  const terminal = createTerminalRunGate({
    platform: 'win32',
    readPolicy,
    recordEvent,
    resolveCwd: async (path) => {
      const workspace = root

      await passHold('terminal.run')

      return resolveWorkspaceTarget(workspace, path, 'read')
    },
    recheckCwd: (target) => recheckWorkspaceTarget(target),
    resolveExecutable: (command) =>
      command === 'node'
        ? { ok: true, file: NODE, kind: 'program' }
        : { ok: false, denial: 'command-not-found' },
    inspectExecutable: async (file) => ({
      realPath: file,
      dev: 1n,
      ino: 2n,
      size: 3n,
      mtimeNs: 4n
    }),
    isSameExecutable,
    buildLaunch: (executable, args) =>
      buildTerminalLaunch(executable, args, { SystemRoot: 'C:\\Windows' }),
    runProcess: async (spec, cwd): Promise<RunProcessResult> => {
      launches.push({ spec, cwd })
      return {
        kind: 'exited',
        exitCode: 0,
        output: {
          text: 'FN Agent E2E: OK\nGITHUB_TOKEN=ghp_0123456789abcdefghijklmnopqrstuvwxyz\n',
          truncated: false
        }
      }
    },
    requestApproval: (raw, signal) => manager.request(raw, signal),
    consumeApproval: (id, raw) => manager.consume(id, raw),
    notifyProposed: () => {},
    notifySettled: () => {},
    createProposalId: () => 'proposal',
    acquireSideEffect: lock.acquire
  })

  const readTools = createReadToolsGate({
    readPolicy,
    recordEvent,
    resolveTarget: (path) => resolveWorkspaceTarget(root, path, 'read'),
    readBytes: readVerifiedFileBytes,
    readDirectory: readWorkspaceDirectory,
    resolvePinnedTarget: resolvePinnedWorkspaceTarget,
    listPinnedDirectory: listPinnedWorkspaceDirectory,
    confirmPinnedRoot: confirmPinnedWorkspaceRoot,
    searchContents: searchWorkspaceFileContents,
    readWorkspaceName: () => 'fx-agent-e2e',
    readGitRepository: async () => ({ status: 'not-a-repository' })
  })

  const external = createExternalSendGate({ readPolicy, recordEvent })

  const loop = createAgentLoop({
    createProvider: createScriptedProvider,
    isProviderAvailable: () => true,
    isAgentEnabled: () => true,
    hasWorkspace: () => true,
    readPermissionMode: () => mode,
    sendToProvider: (request, deliver) => external.send(request, deliver),
    toolbox: {
      describeStatus: readTools.describeStatus,
      listDirectory: readTools.listDirectory,
      readFile: readTools.readFile,
      search: readTools.search,
      writeFile: fileWrite.write,
      runCommand: terminal.run
    },
    isSideEffectInProgress: () => lock.heldBy() !== null,
    cancelPendingApprovals: () => manager.cancelAll(),
    recordEvent,
    emitState: () => {}
  })

  currentLoop = loop

  return { loop, lock, fileWrite, terminal }
}

function types(): string[] {
  return events.map((event) => event.type)
}

describe('完了条件の End-to-End（Scripted Provider）', () => {
  it('Read → File Write（二段階承認）→ Terminal（二段階承認）→ 結果を安全に返す → complete', async () => {
    const { loop } = system()

    expect(loop.start('E2E を確認して')).toEqual({ started: true })
    await loop.whenIdle()

    const state = loop.getState()

    expect(state).toMatchObject({ status: 'completed', endReason: 'completed' })
    // 書いたものは、提案した本文と同じ。
    expect(await readFile(join(root, SCRIPTED_E2E_FILE), 'utf8')).toBe(SCRIPTED_E2E_CONTENT)
    // 承認したコマンドだけが、そのとおりに1回起動した。
    expect(launches).toHaveLength(1)
    expect(launches[0].spec.args).toEqual([SCRIPTED_E2E_FILE])
    expect(launches[0].cwd).toBe(root)
    // Tool の結果が Agent へ返り、最終回答に使われた（出力の Secret は伏せてある）。
    expect(state.finalAnswer).toContain('FN Agent E2E: OK')
    expect(state.finalAnswer).toContain('終了コード 0')
    // 二段階承認が2回（File Write と Terminal）。
    expect(types().filter((type) => type === 'approval.approved')).toHaveLength(2)
    expect(types()).toContain('file-write.succeeded')
    expect(types()).toContain('terminal.completed')
    // Provider へは External Send Gate を通ったものだけ（Read 系の結果も含めて毎回）。
    expect(types().filter((type) => type === 'external-send.allowed').length).toBe(state.loopsUsed)
    expect(types()).not.toContain('external-send.denied')
    // Audit にも最終回答にも Secret の値は出ない。
    expect(JSON.stringify(events)).not.toContain('ghp_0123456789')
    expect(JSON.stringify(events)).not.toContain('A1b2C3d4E5f6G7h8')
  })

  it('File Write を取り消すと、書かず・コマンドも提案せず・同じ変更を出し直さずに終わる', async () => {
    intents['file.write'] = 'cancel'

    const { loop } = system()

    loop.start('E2E')
    await loop.whenIdle()

    await expect(stat(join(root, SCRIPTED_E2E_FILE))).rejects.toThrow()
    expect(launches).toEqual([])
    expect(loop.getState()).toMatchObject({ status: 'completed' })
    expect(loop.getState().finalAnswer).toContain('user-cancelled')
  })

  it('Terminal を取り消すと、ファイルは書いたままコマンドは起動しない', async () => {
    intents['terminal.run'] = 'cancel'

    const { loop } = system()

    loop.start('E2E')
    await loop.whenIdle()

    expect(await readFile(join(root, SCRIPTED_E2E_FILE), 'utf8')).toBe(SCRIPTED_E2E_CONTENT)
    expect(launches).toEqual([])
    expect(loop.getState().finalAnswer).toContain('コマンドは実行されませんでした')
  })

  it('Read の Permission では、書き込みも起動も承認を求めずに拒まれる', async () => {
    mode = 'read'

    const { loop } = system()

    loop.start('E2E')
    await loop.whenIdle()

    await expect(stat(join(root, SCRIPTED_E2E_FILE))).rejects.toThrow()
    expect(types()).not.toContain('approval.requested')
    expect(loop.getState().finalAnswer).toContain('read-only-mode')
  })
})

describe('Fail Closed', () => {
  it('#secret: .env は読めず、同じ Action の出し直しは Gate へ渡さない', async () => {
    const { loop } = system()

    loop.start('#secret')
    await loop.whenIdle()

    expect(events.filter((event) => event.type === 'file-read.denied')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'agent.action-rejected')).toEqual([
      expect.objectContaining({ reason: 'repeated-action' })
    ])
    expect(loop.getState().status).toBe('completed')
    expect(JSON.stringify(events)).not.toContain('A1b2C3d4E5f6G7h8')
  })

  it('#invalid: 壊れた出力・並列・知らない種類・知らない欄は、どれも実行しない', async () => {
    const { loop } = system()

    loop.start('#invalid')
    await loop.whenIdle()

    expect(
      events.filter((event) => event.type === 'agent.action-rejected').map((event) => event.reason)
    ).toEqual(['invalid-action', 'parallel-action', 'invalid-action', 'invalid-action'])
    expect(loop.getState().status).toBe('completed')
  })

  it('#broken: 壊れた出力が続けば止まる', async () => {
    const { loop } = system()

    loop.start('#broken')
    await loop.whenIdle()

    expect(loop.getState()).toMatchObject({
      status: 'failed',
      endReason: 'too-many-invalid-actions'
    })
  })

  it('Terminal の承認待ちの間は、別の経路からの File Write も共有ロックで拒まれる', async () => {
    intents['terminal.run'] = 'none'

    const { loop, lock, fileWrite } = system()

    loop.start('E2E')
    // ロックではなく、**承認が実際に知らされたこと**を待つ（ロックは承認より前に取られる）。
    await approvalNotified('terminal.run')
    expect(lock.heldBy()).toBe('terminal.run')

    expect(await fileWrite.write('other.txt', 'x')).toEqual({
      ok: false,
      reason: 'side-effect-in-progress'
    })

    loop.stop()
    await loop.whenIdle()

    expect(launches).toEqual([])
    await expect(stat(join(root, 'other.txt'))).rejects.toThrow()
  })
})

/*
  停止・Workspace の切り替え（halt）と承認の race（2026-09-24 に見つかったもの。DESIGN.md §6）。

  Gate は**ロックを取ってから** Boundary の解決などの I/O を経て承認を求める。その間に
  止めると、止めた時点ではまだ承認が無いため取り消しは 0 件に終わり、Gate はその後で
  新しい承認を作っていた。ここでは栓（holdBeforeApproval）でその間に止め、ポーリングせずに
  順番を決めて確かめる。
*/
describe('停止・halt と承認の race', () => {
  const TRIGGERS = [
    { name: 'stop', endReason: 'user-stopped', fire: (loop: AgentLoop) => loop.stop() },
    {
      name: "halt('workspace-changed')",
      endReason: 'workspace-changed',
      fire: (loop: AgentLoop) => loop.halt('workspace-changed')
    }
  ] as const
  const KINDS = ['file.write', 'terminal.run'] as const
  const CASES = KINDS.flatMap((kind) =>
    TRIGGERS.map((trigger) => [kind, trigger.name, trigger] as const)
  )

  const DENIED_EVENT = { 'file.write': 'file-write.denied', 'terminal.run': 'terminal.denied' }

  function count(type: AuditEvent['type']): number {
    return events.filter((event) => event.type === type).length
  }

  /** halt のときは、本物と同じく Workspace を先に切り替えてから止める。 */
  async function fire(trigger: (typeof TRIGGERS)[number], loop: AgentLoop): Promise<void> {
    if (trigger.name !== 'stop') {
      root = await createWorkspace()
    }

    trigger.fire(loop)
  }

  /** 副作用が起きていないこと。Terminal の場合は、その前の File Write は承認どおり書かれている。 */
  async function expectNoNewSideEffect(kind: ApprovalActionKind): Promise<void> {
    expect(launches).toEqual([])

    if (kind === 'file.write') {
      for (const path of roots) {
        await expect(stat(join(path, SCRIPTED_E2E_FILE))).rejects.toThrow()
      }
    }
  }

  it.each(CASES)(
    '%s: ロックを取った後・承認を求める前に %s → 新しい承認を作らず、何も起こさずに止まる',
    async (kind, _name, trigger) => {
      const held = holdBeforeApproval(kind)
      const { loop, lock } = system()

      loop.start('E2E')
      await held.reached
      expect(lock.heldBy()).toBe(kind)

      const requestedBefore = count('approval.requested')
      const noticesBefore = notices.length

      await fire(trigger, loop)
      held.release()

      /*
        止めた後に承認が知らされたら、その時点で落とす。**待ち時間は使わない** ── 以前は
        ここで承認が作られ、whenIdle() が解けないまま 30 秒の timeout になっていた。
      */
      const lateApproval = approvalNotified(kind).then((notice) => {
        throw new Error(`${notice.actionKind} の承認が、止めた後に作られた`)
      })

      await Promise.race([loop.whenIdle(), lateApproval])

      expect(loop.getState()).toMatchObject({ status: 'stopped', endReason: trigger.endReason })
      expect(count('approval.requested')).toBe(requestedBefore)
      expect(notices).toHaveLength(noticesBefore)
      expect(events).toContainEqual(
        expect.objectContaining({ type: DENIED_EVENT[kind], reason: 'agent-stopped' })
      )
      expect(lock.heldBy()).toBeNull()

      // 止めた後に「続ける」を送っても、何も始まらない。
      loop.continueTask('continue')
      await loop.whenIdle()

      expect(loop.getState().status).toBe('stopped')
      await expectNoNewSideEffect(kind)
    }
  )

  it.each(CASES)(
    '%s: 承認待ちの間に %s → 承認は取り消され、後から続行しても何も起こらない',
    async (kind, _name, trigger) => {
      intents[kind] = 'none'

      const { loop, lock } = system()

      loop.start('E2E')

      const notice = await approvalNotified(kind)

      expect(lock.heldBy()).toBe(kind)

      await fire(trigger, loop)
      await loop.whenIdle()

      expect(loop.getState()).toMatchObject({ status: 'stopped', endReason: trigger.endReason })
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'approval.denied', reason: 'agent-stopped' })
      )
      expect(notices.filter((seen) => seen.actionKind === kind)).toHaveLength(1)
      expect(lock.heldBy()).toBeNull()

      // 取り消された承認へ、後から Renderer が続行を送っても通らない。
      await manager.respond(
        { approvalId: notice.approvalId, actionKind: kind, intent: 'continue' },
        window
      )

      expect(events.at(-1)).toMatchObject({ type: 'approval.denied', reason: 'approval-not-found' })
      expect(count('approval.approved')).toBe(kind === 'file.write' ? 0 : 1)
      expect(lock.heldBy()).toBeNull()
      await expectNoNewSideEffect(kind)
    }
  )
})
