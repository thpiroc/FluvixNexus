import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentPermissionMode } from '@shared/security'
import type { AuditEvent } from '../audit/auditEvent'
import { resolveWorkspaceTarget, type VerifiedWorkspaceTarget } from '../boundary/workspaceBoundary'
import type { SecurityPolicy } from '../policy/securityPolicy'
import { SECRET_MASK } from '../secret/secretMasking'
import {
  createApprovalManager,
  APPROVAL_TTL_MS,
  type ApprovalConfirmation,
  type ApprovalManager,
  type ApprovalOutcome,
  type ApprovalRequestNotice
} from './approvalManager'

/**
 * Main-side Approval Manager（Security Core v1 の STEP6）。
 *
 * ここで固定したいのは4つ。
 *
 *   1. **Renderer だけでは承認が成立しない**（続行の意思表示は Native 確認へ進むだけ）
 *   2. **承認はその操作1回に結び付く**（action ＋ fingerprint。汎用の印にならない）
 *   3. **1回きり**（consume で失効。取り消し・期限切れ・不一致・失敗も失効）
 *   4. **分からなければ拒む**（Policy・形・時計・確認・状態のどれが欠けても deny）
 */

let root: string

/** Native 確認が返すもの（各テストで差し替える）。 */
let confirmation: ApprovalConfirmation | (() => Promise<ApprovalConfirmation>)

/** Main の時計（テストから進められる）。 */
let clock: number

let events: AuditEvent[]
let notices: ApprovalRequestNotice[]

/** 期限で起こす手続き（テストから発火できる）。 */
let timers: (() => void)[]

const window = { isDestroyed: () => false }
const destroyedWindow = { isDestroyed: () => true }

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'fx-approval-')))

  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1\n')
  await writeFile(join(root, '.env'), 'API_KEY=A1b2C3d4E5f6G7h8\n')

  confirmation = 'approve'
  clock = 1_700_000_000_000
  events = []
  notices = []
  timers = []
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function manager(
  permissionMode: AgentPermissionMode | (() => SecurityPolicy) = 'ask',
  overrides: Partial<Parameters<typeof createApprovalManager>[0]> = {}
): ApprovalManager {
  return createApprovalManager({
    readPolicy:
      typeof permissionMode === 'function'
        ? permissionMode
        : () => Object.freeze({ permissionMode }),
    recordEvent: (event) => events.push(event),
    now: () => clock,
    setTimer: (run) => {
      timers.push(run)
      return () => {
        timers = timers.filter((entry) => entry !== run)
      }
    },
    notify: (notice) => notices.push(notice),
    confirm: async () => (typeof confirmation === 'function' ? confirmation() : confirmation),
    ...overrides
  })
}

async function writeTarget(relativePath: string): Promise<VerifiedWorkspaceTarget> {
  const result = await resolveWorkspaceTarget(root, relativePath, 'write')

  if (!result.ok) {
    throw new Error(`expected a verified target, got ${result.denial}`)
  }

  return result.target
}

/** Renderer の第1段階を通して、二段階の結末を取る。 */
async function runTwoStages(
  api: ApprovalManager,
  request: unknown,
  intent: 'continue' | 'cancel' = 'continue',
  respondWindow: unknown = window
): Promise<ApprovalOutcome> {
  const outcome = api.request(request)

  // notify は同期に届く（request が pending を作った直後）。
  const notice = notices.at(-1)

  if (notice === undefined) {
    return outcome
  }

  await api.respond(
    { approvalId: notice.approvalId, actionKind: notice.actionKind, intent },
    respondWindow
  )

  return outcome
}

function reasons(): readonly (string | undefined)[] {
  return events.map((event) => event.reason)
}

function types(): readonly string[] {
  return events.map((event) => event.type)
}

const TERMINAL = Object.freeze({
  kind: 'terminal.run' as const,
  command: 'npm',
  args: Object.freeze(['test']),
  cwd: ''
})

describe('Policy（STEP1）との関係', () => {
  it('read（読み取り専用）では、承認を求めるところまで進まない', async () => {
    const api = manager('read')

    expect(await api.request(TERMINAL)).toEqual({ decision: 'denied', reason: 'read-only-mode' })
    expect(notices).toEqual([])
    expect(types()).toEqual(['approval.denied'])
  })

  it('read では File Write も承認の対象にならない', async () => {
    const api = manager('read')
    const target = await writeTarget('src/app.ts')

    expect(await api.request({ kind: 'file.write', target, content: 'x' })).toEqual({
      decision: 'denied',
      reason: 'read-only-mode'
    })
    expect(notices).toEqual([])
  })

  it('ask なら承認を求められる', async () => {
    const api = manager('ask')

    void api.request(TERMINAL)

    expect(notices).toHaveLength(1)
    expect(types()).toEqual(['approval.requested'])
  })

  it('Secret ファイルへの書き込みは、ask でも承認の対象にならない', async () => {
    const api = manager('ask')
    const target = await writeTarget('.env')

    expect(await api.request({ kind: 'file.write', target, content: 'x' })).toEqual({
      decision: 'denied',
      reason: 'secret-file'
    })
    expect(notices).toEqual([])
  })

  it('Policy を読めなければ read として扱う', async () => {
    const api = manager(() => {
      throw new Error('settings unavailable')
    })

    expect(await api.request(TERMINAL)).toEqual({ decision: 'denied', reason: 'read-only-mode' })
  })

  it('Policy の形が違っても read として扱う', async () => {
    const api = manager(() => ({ permissionMode: 'auto' }) as unknown as SecurityPolicy)

    expect(await api.request(TERMINAL)).toEqual({ decision: 'denied', reason: 'read-only-mode' })
  })
})

describe('承認を求める', () => {
  it('id は毎回違い、予測できる連番ではない', async () => {
    const api = manager()

    void api.request(TERMINAL)
    void api.request(TERMINAL)

    const [first, second] = notices

    expect(first.approvalId).not.toBe(second.approvalId)
    expect(first.approvalId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })

  it('Renderer へ送るのは安全な要約だけ', async () => {
    const api = manager()
    const target = await writeTarget('src/app.ts')

    void api.request({ kind: 'file.write', target, content: 'secret body' })

    expect(notices[0]).toEqual({
      approvalId: expect.any(String) as unknown as string,
      actionKind: 'file.write',
      subject: 'src/app.ts',
      workspacePath: 'src/app.ts',
      commandSummary: null,
      expiresAt: clock + APPROVAL_TTL_MS
    })
  })

  it('Terminal の Secret は Renderer へ届く前に伏せられている', async () => {
    const api = manager()

    void api.request({
      kind: 'terminal.run',
      command: 'npm',
      args: ['publish', '--token', 'ghp_0123456789abcdefghijklmnopqrstuvwxyz'],
      cwd: ''
    })

    expect(notices[0].commandSummary).toContain(SECRET_MASK)
    expect(JSON.stringify(notices[0])).not.toContain('ghp_0123456789')
  })

  it('期限は Main の時計で決まる', async () => {
    const api = manager()

    void api.request(TERMINAL)

    expect(notices[0].expiresAt).toBe(clock + APPROVAL_TTL_MS)
  })

  it('時計を読めなければ承認を作らない', async () => {
    const api = manager('ask', {
      now: () => {
        throw new Error('no clock')
      }
    })

    expect(await api.request(TERMINAL)).toEqual({
      decision: 'denied',
      reason: 'approval-state-invalid'
    })
    expect(notices).toEqual([])
  })

  it('知らない操作は承認の対象にならない', async () => {
    const api = manager()

    for (const request of [{ kind: 'mcp.write' }, { kind: 'git.push' }, { kind: 'file.read' }]) {
      expect(await api.request(request)).toEqual({ decision: 'denied', reason: 'unknown-action' })
    }

    expect(notices).toEqual([])
  })

  it('形の違う要求は承認の対象にならない', async () => {
    const api = manager()

    for (const request of [null, 'terminal.run', 42, { kind: 'terminal.run', command: '' }]) {
      expect(await api.request(request)).toEqual({ decision: 'denied', reason: 'invalid-request' })
    }
  })

  it('Renderer へ知らせられなければ、その場で失効させる', async () => {
    const api = manager('ask', {
      notify: () => {
        throw new Error('no window')
      }
    })

    expect(await api.request(TERMINAL)).toEqual({
      decision: 'denied',
      reason: 'window-unavailable'
    })
  })
})

describe('Renderer の第1段階', () => {
  it('続行だけでは承認にならない（Native 確認が承認を決める）', async () => {
    const api = manager()

    confirmation = 'cancel'

    expect(await runTwoStages(api, TERMINAL)).toEqual({
      decision: 'denied',
      reason: 'user-cancelled'
    })
    expect(types()).toEqual(['approval.requested', 'approval.denied'])
  })

  it('approved を名乗る欄があっても読まれない', async () => {
    const api = manager()
    const outcome = api.request(TERMINAL)
    const notice = notices[0]

    await api.respond(
      {
        approvalId: notice.approvalId,
        actionKind: notice.actionKind,
        intent: 'cancel',
        approved: true,
        decision: 'allow',
        bypass: true
      },
      window
    )

    expect(await outcome).toEqual({ decision: 'denied', reason: 'user-cancelled' })
  })

  it('intent が無い / 知らない値なら、何も進まない', async () => {
    const api = manager()

    void api.request(TERMINAL)

    const notice = notices[0]

    for (const intent of [undefined, 'approve', 'allow', true]) {
      await api.respond(
        { approvalId: notice.approvalId, actionKind: 'terminal.run', intent },
        window
      )
    }

    expect(reasons()).toEqual([
      'approval-required',
      'invalid-request',
      'invalid-request',
      'invalid-request',
      'invalid-request'
    ])
  })

  it('偽の Approval ID は、どの承認にも触れない', async () => {
    const api = manager()
    const outcome = api.request(TERMINAL)

    await api.respond(
      {
        approvalId: '00000000-0000-4000-8000-000000000000',
        actionKind: 'terminal.run',
        intent: 'continue'
      },
      window
    )

    expect(reasons()).toEqual(['approval-required', 'approval-not-found'])

    // もとの承認は生きたまま。
    await api.respond(
      { approvalId: notices[0].approvalId, actionKind: 'terminal.run', intent: 'continue' },
      window
    )

    expect((await outcome).decision).toBe('approved')
  })

  it('Approval ID の形が違えば、引き当てにもかからない', async () => {
    const api = manager()

    void api.request(TERMINAL)

    for (const approvalId of ['1', 'not-a-uuid', '', null, notices[0].approvalId.toUpperCase()]) {
      await api.respond({ approvalId, actionKind: 'terminal.run', intent: 'continue' }, window)
    }

    expect(reasons().slice(1)).toEqual([
      'invalid-request',
      'invalid-request',
      'invalid-request',
      'invalid-request',
      'invalid-request'
    ])
  })

  it('操作の種類を偽ると、その承認を失効させる', async () => {
    const api = manager()
    const outcome = api.request(TERMINAL)

    await api.respond(
      { approvalId: notices[0].approvalId, actionKind: 'file.write', intent: 'continue' },
      window
    )

    expect(await outcome).toEqual({ decision: 'denied', reason: 'binding-mismatch' })
  })

  it('Approval A の確認で Approval B は承認できない', async () => {
    const api = manager()
    const first = api.request(TERMINAL)
    const second = api.request({ ...TERMINAL, command: 'npx' })

    // B の id へ続行を送る。A は動かない。
    await api.respond(
      { approvalId: notices[1].approvalId, actionKind: 'terminal.run', intent: 'continue' },
      window
    )

    expect((await second).decision).toBe('approved')

    confirmation = 'cancel'
    await api.respond(
      { approvalId: notices[0].approvalId, actionKind: 'terminal.run', intent: 'continue' },
      window
    )

    expect(await first).toEqual({ decision: 'denied', reason: 'user-cancelled' })
  })

  it('同じ承認へ続行を2度送っても、確認は1度しか出ない', async () => {
    const confirm = vi.fn(async () => 'approve' as const)
    const api = manager('ask', { confirm })
    const outcome = api.request(TERMINAL)
    const notice = notices[0]
    const respond = { approvalId: notice.approvalId, actionKind: notice.actionKind }

    await Promise.all([
      api.respond({ ...respond, intent: 'continue' }, window),
      api.respond({ ...respond, intent: 'continue' }, window)
    ])

    expect(confirm).toHaveBeenCalledTimes(1)
    expect((await outcome).decision).toBe('approved')
  })

  it('取り消しは拒否', async () => {
    const api = manager()

    expect(await runTwoStages(api, TERMINAL, 'cancel')).toEqual({
      decision: 'denied',
      reason: 'user-cancelled'
    })
  })

  it('送信元のウィンドウが失われていれば拒否', async () => {
    const api = manager()

    expect(await runTwoStages(api, TERMINAL, 'continue', destroyedWindow)).toEqual({
      decision: 'denied',
      reason: 'window-unavailable'
    })
  })

  it('ウィンドウで無いものを渡されても拒否', async () => {
    const api = manager()

    expect(await runTwoStages(api, TERMINAL, 'continue', { id: 1 })).toEqual({
      decision: 'denied',
      reason: 'window-unavailable'
    })
  })
})

describe('Main の Native 確認（第2段階）', () => {
  it('承認されたときだけ approved になる', async () => {
    const api = manager()
    const outcome = await runTwoStages(api, TERMINAL)

    expect(outcome.decision).toBe('approved')
    expect(types()).toEqual(['approval.requested', 'approval.approved'])
  })

  it('確認に出るのは安全な要約だけ', async () => {
    const seen: unknown[] = []
    const api = manager('ask', {
      confirm: async (summary) => {
        seen.push(summary)
        return 'approve'
      }
    })
    const target = await writeTarget('src/app.ts')

    await runTwoStages(api, { kind: 'file.write', target, content: 'body with ghp_secret' })

    expect(seen[0]).toEqual({
      actionKind: 'file.write',
      subject: 'src/app.ts',
      workspacePath: 'src/app.ts',
      commandSummary: null
    })
  })

  it('取り消し / × で閉じたときは拒否', async () => {
    const api = manager()

    confirmation = 'cancel'

    expect(await runTwoStages(api, TERMINAL)).toEqual({
      decision: 'denied',
      reason: 'user-cancelled'
    })
  })

  it('確認を出せなかったときも拒否', async () => {
    const api = manager('ask', {
      confirm: () => {
        throw new Error('dialog unavailable')
      }
    })

    expect(await runTwoStages(api, TERMINAL)).toEqual({
      decision: 'denied',
      reason: 'dialog-failed'
    })
  })

  it('確認が「承認」以外を返したら拒否', async () => {
    const api = manager('ask', {
      confirm: async () => 'yes' as unknown as ApprovalConfirmation
    })

    expect(await runTwoStages(api, TERMINAL)).toEqual({
      decision: 'denied',
      reason: 'user-cancelled'
    })
  })

  it('確認している間に期限が来ていたら拒否', async () => {
    const api = manager('ask', {
      confirm: async () => {
        clock += APPROVAL_TTL_MS + 1
        return 'approve'
      }
    })

    expect(await runTwoStages(api, TERMINAL)).toEqual({
      decision: 'denied',
      reason: 'approval-expired'
    })
  })

  it('確認している間にウィンドウが消えたら拒否', async () => {
    let destroyed = false
    const vanishing = { isDestroyed: () => destroyed }
    const api = manager('ask', {
      confirm: async () => {
        destroyed = true
        return 'approve'
      }
    })

    expect(await runTwoStages(api, TERMINAL, 'continue', vanishing)).toEqual({
      decision: 'denied',
      reason: 'window-unavailable'
    })
  })
})

describe('期限', () => {
  it('期限で起こされたら拒否になる', async () => {
    const api = manager()
    const outcome = api.request(TERMINAL)

    expect(timers).toHaveLength(1)
    timers[0]()

    expect(await outcome).toEqual({ decision: 'denied', reason: 'approval-expired' })
  })

  it('期限を過ぎた承認には続行を送れない', async () => {
    const api = manager()
    const outcome = api.request(TERMINAL)

    clock += APPROVAL_TTL_MS

    await api.respond(
      { approvalId: notices[0].approvalId, actionKind: 'terminal.run', intent: 'continue' },
      window
    )

    expect(await outcome).toEqual({ decision: 'denied', reason: 'approval-expired' })
  })
})

describe('consume（STEP7 / STEP8 が使う）', () => {
  async function approved(api: ApprovalManager, request: unknown = TERMINAL): Promise<string> {
    const outcome = await runTwoStages(api, request)

    if (outcome.decision !== 'approved') {
      throw new Error(`expected approved, got ${outcome.reason}`)
    }

    return outcome.approvalId
  }

  it('承認済みなら1回だけ成功する', async () => {
    const api = manager()
    const id = await approved(api)

    expect(api.consume(id, TERMINAL)).toEqual({
      ok: true,
      summary: {
        actionKind: 'terminal.run',
        subject: 'npm',
        workspacePath: null,
        commandSummary: 'npm test'
      }
    })
    expect(api.consume(id, TERMINAL)).toEqual({ ok: false, reason: 'approval-not-found' })
  })

  it('同時に呼んでも、成功するのは1回だけ', async () => {
    const api = manager()
    const id = await approved(api)

    const results = await Promise.all([
      Promise.resolve().then(() => api.consume(id, TERMINAL)),
      Promise.resolve().then(() => api.consume(id, TERMINAL)),
      Promise.resolve().then(() => api.consume(id, TERMINAL))
    ])

    expect(results.filter((result) => result.ok)).toHaveLength(1)
  })

  it('承認前（pending / 確認中）には使えない', async () => {
    const api = manager()
    const outcome = api.request(TERMINAL)

    expect(api.consume(notices[0].approvalId, TERMINAL)).toEqual({
      ok: false,
      reason: 'approval-state-invalid'
    })

    // 使おうとした時点で失効している（後から続行しても承認にならない）。
    await api.respond(
      { approvalId: notices[0].approvalId, actionKind: 'terminal.run', intent: 'continue' },
      window
    )

    expect(await outcome).toEqual({ decision: 'denied', reason: 'approval-state-invalid' })
  })

  it('取り消された承認には使えない', async () => {
    const api = manager()

    confirmation = 'cancel'

    expect((await runTwoStages(api, TERMINAL)).decision).toBe('denied')

    expect(api.consume(notices[0].approvalId, TERMINAL)).toEqual({
      ok: false,
      reason: 'approval-not-found'
    })
  })

  it('期限切れには使えない', async () => {
    const api = manager()
    const id = await approved(api)

    clock += APPROVAL_TTL_MS

    expect(api.consume(id, TERMINAL)).toEqual({ ok: false, reason: 'approval-expired' })
  })

  it('知らない / 形の違う id には使えない', async () => {
    const api = manager()

    expect(api.consume('00000000-0000-4000-8000-000000000000', TERMINAL)).toEqual({
      ok: false,
      reason: 'approval-not-found'
    })
    expect(api.consume('not-a-uuid', TERMINAL)).toEqual({ ok: false, reason: 'invalid-request' })
    expect(api.consume(null, TERMINAL)).toEqual({ ok: false, reason: 'invalid-request' })
  })

  it('操作の種類が違えば使えない', async () => {
    const api = manager()
    const id = await approved(api)
    const target = await writeTarget('src/app.ts')

    expect(api.consume(id, { kind: 'file.write', target, content: 'x' })).toEqual({
      ok: false,
      reason: 'binding-mismatch'
    })
  })
})

describe('binding（承認したものと、実行するもの）', () => {
  async function approvedFileWrite(
    api: ApprovalManager,
    relativePath: string,
    content: string
  ): Promise<{ readonly id: string; readonly target: VerifiedWorkspaceTarget }> {
    const target = await writeTarget(relativePath)
    const outcome = await runTwoStages(api, { kind: 'file.write', target, content })

    if (outcome.decision !== 'approved') {
      throw new Error(`expected approved, got ${outcome.reason}`)
    }

    return { id: outcome.approvalId, target }
  }

  it('File: 同じ対象・同じ本文なら通る', async () => {
    const api = manager()
    const { id, target } = await approvedFileWrite(api, 'src/app.ts', 'next\n')

    expect(api.consume(id, { kind: 'file.write', target, content: 'next\n' }).ok).toBe(true)
  })

  it('File: 対象がすり替わっていれば通らない', async () => {
    const api = manager()
    const { id } = await approvedFileWrite(api, 'src/app.ts', 'next\n')
    const other = await writeTarget('src/other.ts')

    expect(api.consume(id, { kind: 'file.write', target: other, content: 'next\n' })).toEqual({
      ok: false,
      reason: 'binding-mismatch'
    })
  })

  it('File: 本文が書き換えられていれば通らない', async () => {
    const api = manager()
    const { id, target } = await approvedFileWrite(api, 'src/app.ts', 'next\n')

    expect(api.consume(id, { kind: 'file.write', target, content: 'next!\n' })).toEqual({
      ok: false,
      reason: 'binding-mismatch'
    })
  })

  it('File: 同じ対象を確かめ直したものは通る（オブジェクトの同一性では見ない）', async () => {
    const api = manager()
    const { id } = await approvedFileWrite(api, 'src/app.ts', 'next\n')
    const rechecked = await writeTarget('src/app.ts')

    expect(api.consume(id, { kind: 'file.write', target: rechecked, content: 'next\n' }).ok).toBe(
      true
    )
  })

  it('Terminal: command が違えば通らない', async () => {
    const api = manager()
    const outcome = await runTwoStages(api, TERMINAL)

    if (outcome.decision !== 'approved') {
      throw new Error('expected approved')
    }

    expect(api.consume(outcome.approvalId, { ...TERMINAL, command: 'npx' })).toEqual({
      ok: false,
      reason: 'binding-mismatch'
    })
  })

  it('Terminal: 引数が増えていれば通らない', async () => {
    const api = manager()
    const outcome = await runTwoStages(api, TERMINAL)

    if (outcome.decision !== 'approved') {
      throw new Error('expected approved')
    }

    expect(api.consume(outcome.approvalId, { ...TERMINAL, args: ['test', '--force'] })).toEqual({
      ok: false,
      reason: 'binding-mismatch'
    })
  })

  it('Terminal: cwd が違えば通らない', async () => {
    const api = manager()
    const outcome = await runTwoStages(api, { ...TERMINAL, cwd: 'packages/app' })

    if (outcome.decision !== 'approved') {
      throw new Error('expected approved')
    }

    expect(api.consume(outcome.approvalId, { ...TERMINAL, cwd: 'packages/other' })).toEqual({
      ok: false,
      reason: 'binding-mismatch'
    })
    expect(api.consume(outcome.approvalId, { ...TERMINAL, cwd: 'packages/app' })).toEqual({
      ok: false,
      reason: 'approval-not-found'
    })
  })

  it('一致しなかった承認は、正しいもので出し直しても通らない', async () => {
    const api = manager()
    const outcome = await runTwoStages(api, TERMINAL)

    if (outcome.decision !== 'approved') {
      throw new Error('expected approved')
    }

    expect(api.consume(outcome.approvalId, { ...TERMINAL, command: 'npx' }).ok).toBe(false)
    expect(api.consume(outcome.approvalId, TERMINAL)).toEqual({
      ok: false,
      reason: 'approval-not-found'
    })
  })
})

describe('Audit（STEP4）', () => {
  it('求めた・承認した・拒んだ を記録する', async () => {
    const api = manager()

    await runTwoStages(api, TERMINAL)

    expect(events).toEqual([
      {
        type: 'approval.requested',
        decision: 'ask',
        reason: 'approval-required',
        actionKind: 'terminal.run',
        permissionMode: 'ask',
        subject: 'npm',
        workspacePath: undefined
      },
      {
        type: 'approval.approved',
        decision: 'allow',
        reason: 'user-approved',
        actionKind: 'terminal.run',
        permissionMode: 'ask',
        subject: 'npm',
        workspacePath: undefined
      }
    ])
  })

  it('File Write は Workspace 相対 Path を記録する', async () => {
    const api = manager()
    const target = await writeTarget('src/app.ts')

    await runTwoStages(api, { kind: 'file.write', target, content: 'x' })

    expect(events[0].workspacePath).toBe('src/app.ts')
    expect(events[0].subject).toBe('src/app.ts')
  })

  it('書き込む本文は記録に入らない', async () => {
    const api = manager()
    const target = await writeTarget('src/app.ts')

    await runTwoStages(api, {
      kind: 'file.write',
      target,
      content: 'const token = "ghp_0123456789abcdefghijklmnopqrstuvwxyz"'
    })

    expect(JSON.stringify(events)).not.toContain('ghp_')
    expect(JSON.stringify(events)).not.toContain('const token')
  })

  it('コマンドの引数も fingerprint も記録に入らない', async () => {
    const api = manager()

    await runTwoStages(api, {
      kind: 'terminal.run',
      command: 'npm',
      args: ['publish', '--token', 'ghp_0123456789abcdefghijklmnopqrstuvwxyz'],
      cwd: ''
    })

    const recorded = JSON.stringify(events)

    expect(recorded).not.toContain('ghp_0123456789')
    expect(recorded).not.toContain('--token')
    expect(recorded).not.toMatch(/[0-9a-f]{64}/)
    expect(events[0].subject).toBe('npm')
  })

  it('Approval の id も記録に入らない', async () => {
    const api = manager()

    await runTwoStages(api, TERMINAL)

    expect(JSON.stringify(events)).not.toContain(notices[0].approvalId)
  })

  it('記録できなくても承認の結論は変わらない', async () => {
    const api = manager('ask', {
      recordEvent: () => {
        throw new Error('audit unavailable')
      }
    })

    expect((await runTwoStages(api, TERMINAL)).decision).toBe('approved')

    const denying = manager('read', {
      recordEvent: () => {
        throw new Error('audit unavailable')
      }
    })

    expect(await denying.request(TERMINAL)).toEqual({
      decision: 'denied',
      reason: 'read-only-mode'
    })
  })

  it('拒んだ理由がそのまま記録に残る', async () => {
    const api = manager()

    confirmation = 'cancel'
    await runTwoStages(api, TERMINAL)

    expect(types()).toEqual(['approval.requested', 'approval.denied'])
    expect(events[1]).toMatchObject({
      decision: 'deny',
      reason: 'user-cancelled',
      actionKind: 'terminal.run',
      subject: 'npm'
    })
  })
})
