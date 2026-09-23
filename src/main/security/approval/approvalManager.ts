import {
  isAgentPermissionMode,
  isApprovalActionKind,
  type AgentPermissionMode,
  type ApprovalActionKind
} from '@shared/security'
import type { AuditEvent } from '../audit/auditEvent'
import { decideSecurityAction, type SecurityAction } from '../policy/securityDecision'
import type { SecurityDecisionReason } from '../policy/securityDecision'
import { FAIL_CLOSED_SECURITY_POLICY, type SecurityPolicy } from '../policy/securityPolicy'
import { agentFileWriteFacts } from '../secret/secretFileFacts'
import {
  approvalActionKindOf,
  normalizeApprovalRequest,
  type ApprovalActionDenial,
  type NormalizedApprovalAction
} from './approvalAction'
import { approvalApprovedEvent, approvalDeniedEvent, approvalRequestedEvent } from './approvalAudit'
import { approvalFingerprint } from './approvalFingerprint'
import { createApprovalId, isApprovalId } from './approvalId'
import { approvalSafeSummary, type ApprovalSafeSummary } from './approvalSummary'

/**
 * Main 側の Approval Manager（Security Core v1 の STEP6。Electron に依存しない）。
 *
 * FN Agent が副作用のある操作（File Write / Terminal）を求めたとき、**承認の状態を
 * 所有して結論を出すのは Main だけ**にするための層。Renderer は「利用者が続行を
 * 選んだ」と言えるだけで、承認は成立しない。
 *
 * ```
 * Agent / 後続 Gate
 *   ↓ request(raw)                 未検査の要求
 * Policy（STEP1）                  read なら deny。ask のときだけ先へ
 *   ↓
 * pending を作る                   id は randomUUID・fingerprint を控える・期限を押す
 *   ↓ notify                       Renderer へは**安全な要約だけ**を送る
 * Renderer                         利用者へ見せ、続行 / 取り消しを返す（第1段階）
 *   ↓ respond(intent)
 * Main Native Dialog               利用者へもう一度尋ねる（第2段階。deps.confirm）
 *   ↓
 * approved                         ここで初めて承認が成立する
 *   ↓ consume(id, 実行するもの)     STEP7 / STEP8 が実行の直前に1回だけ使う
 * ```
 *
 * ## Renderer は承認できない
 *
 * `respond` が受け取るのは `'continue'` / `'cancel'` の**意思表示**までで、
 * `approved: true` にあたる欄はこの module のどこにも無い。`'continue'` が来ても
 * 状態は `confirming` にしか進まず、`approved` へ移るのは `deps.confirm`
 * （Main の Native 確認）が承認を返したときだけ。
 *
 * ## 承認は「その操作1回」に結び付く
 *
 * 承認は id ではなく **action の種類 ＋ fingerprint**（approvalFingerprint.ts）で
 * 結び付ける。`consume` は実行する直前のものからもう一度 fingerprint を作り直し、
 * 一致しなければ拒む ── 「file.write が承認済み」という汎用の印は作らない。
 *
 * ## 1回きり・短い期限
 *
 * 承認は1度 `consume` すれば失効する。取り消し・Native の取り消し・× で閉じた・
 * ウィンドウが失われた・期限切れ・状態の不一致・binding の不一致も失効にあたる。
 * **失敗した consume も失効させる**（もう一度試す余地を残さない）。
 *
 * ## 残らない
 *
 * 状態はこの module の中の `Map` だけにあり、**ディスクへ書かない。** アプリを
 * 終了すれば承認はすべて消える（再起動後に復元する必要は無い。DESIGN.md §6.4）。
 *
 * ## 分からなければ拒む
 *
 * Policy を読めない・形が違う・知らない種類・時計が読めない・fingerprint を作れない・
 * Native 確認を出せない・状態が合わない、はすべて deny。**「判断できないから通す」は無い。**
 */

/** 承認の有効期限（ミリ秒）。 */
export const APPROVAL_TTL_MS = 5 * 60 * 1000

/** 承認しなかった理由。すべて `AuditReason` にある語にあたる。 */
export type ApprovalDenialReason =
  | ApprovalActionDenial
  | SecurityDecisionReason
  | 'user-cancelled'
  | 'approval-expired'
  | 'approval-not-found'
  | 'approval-already-used'
  | 'approval-state-invalid'
  | 'binding-mismatch'
  | 'fingerprint-failed'
  | 'dialog-failed'
  | 'window-unavailable'
  /** 利用者が Agent を停止した（STEP9。Main が承認待ちを取り消した）。 */
  | 'agent-stopped'

/** 承認を求めた結果。 */
export type ApprovalOutcome =
  | {
      readonly decision: 'approved'
      readonly approvalId: string
      readonly summary: ApprovalSafeSummary
    }
  | { readonly decision: 'denied'; readonly reason: ApprovalDenialReason }

/** 実行の直前に承認を使い切った結果。 */
export type ApprovalConsumeResult =
  | { readonly ok: true; readonly summary: ApprovalSafeSummary }
  | { readonly ok: false; readonly reason: ApprovalDenialReason }

/** Renderer から届く意思表示。**承認そのものではない。** */
export type ApprovalIntent = 'continue' | 'cancel'

/** Main の Native 確認の結果。 */
export type ApprovalConfirmation = 'approve' | 'cancel'

/**
 * Native 確認を出す相手のウィンドウ。
 *
 * `BrowserWindow` をそのまま型にしないのは、この module を Electron から切り離した
 * ままにするため。Manager が見るのは「まだ生きているか」だけで、実際に確認を出すのは
 * `deps.confirm`（approvalDialog.ts）になる。
 */
export interface ApprovalWindow {
  readonly isDestroyed: () => boolean
}

/** Renderer へ送る、承認を求めていることの知らせ（安全な要約だけ）。 */
export interface ApprovalRequestNotice {
  readonly approvalId: string
  readonly actionKind: ApprovalActionKind
  readonly subject: string
  readonly workspacePath: string | null
  readonly commandSummary: string | null
  /** 期限（Main の時計の epoch ミリ秒）。**表示のためだけの値にあたる。** */
  readonly expiresAt: number
}

/** Manager が使う、Main 側の道具。 */
export interface ApprovalManagerDependencies {
  /** 今効いている Policy（STEP1）。要求のたびに読み直す。 */
  readonly readPolicy: () => SecurityPolicy
  /** Audit Event を1件記録する（STEP4）。成否は返さない。 */
  readonly recordEvent: (event: AuditEvent) => void
  /** 今の時刻（epoch ミリ秒）。**Renderer の自己申告は使わない。** */
  readonly now: () => number
  /** 期限で起こしてもらう。返り値は取り消しの手続き。 */
  readonly setTimer: (run: () => void, delayMs: number) => () => void
  /** Renderer へ知らせる（第1段階）。 */
  readonly notify: (notice: ApprovalRequestNotice) => void
  /** Main の Native 確認を出す（第2段階）。 */
  readonly confirm: (
    summary: ApprovalSafeSummary,
    window: ApprovalWindow
  ) => Promise<ApprovalConfirmation>
}

export interface ApprovalManager {
  /** 承認を求める。二段階が終わるまで解決しない。 */
  readonly request: (raw: unknown) => Promise<ApprovalOutcome>
  /** Renderer の意思表示を受ける。**承認は成立しない**（Native 確認へ進むだけ）。 */
  readonly respond: (raw: unknown, window: unknown) => Promise<void>
  /** 実行の直前に1回だけ使い切る（STEP7 / STEP8 が呼ぶ）。 */
  readonly consume: (approvalId: unknown, raw: unknown) => ApprovalConsumeResult
  /**
   * まだ使い切られていない承認を、すべて取り消す（STEP9。Agent の停止）。
   *
   * **取り消すだけで、承認する向きには働かない。** pending・確認中・承認済み（consume 前）の
   * どれも `agent-stopped` で失効し、待っている Gate は deny で解ける ── 承認済みでも
   * consume が通らなくなるため、停止の後に書き込み・起動は起きない。
   * 返り値は取り消した件数。
   */
  readonly cancelAll: () => number
}

/** Main が持つ承認1件。**本文も引数も fingerprint 以外は持たない。** */
interface StoredApproval {
  readonly id: string
  readonly actionKind: ApprovalActionKind
  readonly fingerprint: string
  readonly summary: ApprovalSafeSummary
  readonly permissionMode: AgentPermissionMode
  readonly expiresAt: number
  state: 'pending' | 'confirming' | 'approved' | 'denied' | 'consumed'
  cancelTimer: () => void
  settle: (outcome: ApprovalOutcome) => void
}

export function createApprovalManager(deps: ApprovalManagerDependencies): ApprovalManager {
  /** 承認の状態。**ここだけが真実にあたる**（Renderer の Store は見ない）。 */
  const approvals = new Map<string, StoredApproval>()

  function record(event: AuditEvent): void {
    try {
      deps.recordEvent(event)
    } catch {
      // 記録できなかったことで allow / deny が変わってはいけない。
    }
  }

  /** 要求そのものを断る（pending を作らない）。 */
  function denyRequest(
    reason: ApprovalDenialReason,
    mode: AgentPermissionMode,
    summary: ApprovalSafeSummary | null,
    actionKind: ApprovalActionKind | null
  ): ApprovalOutcome {
    record(approvalDeniedEvent(reason, mode, summary, actionKind))

    return Object.freeze({ decision: 'denied' as const, reason })
  }

  /** ある承認を失効させる。待っている要求があれば deny で解決する。 */
  function denyApproval(approval: StoredApproval, reason: ApprovalDenialReason): void {
    if (approval.state === 'denied' || approval.state === 'consumed') {
      return
    }

    approval.state = 'denied'
    record(approvalDeniedEvent(reason, approval.permissionMode, approval.summary, null))
    approval.settle(Object.freeze({ decision: 'denied' as const, reason }))
  }

  /** 状態だけを見て断る（その承認は動かさない）。 */
  function refuse(
    reason: ApprovalDenialReason,
    mode: AgentPermissionMode,
    summary: ApprovalSafeSummary | null,
    actionKind: ApprovalActionKind | null
  ): ApprovalConsumeResult {
    record(approvalDeniedEvent(reason, mode, summary, actionKind))

    return Object.freeze({ ok: false as const, reason })
  }

  async function request(raw: unknown): Promise<ApprovalOutcome> {
    const policy = readPolicy(deps)
    const mode = policy.permissionMode
    const requestedKind = approvalActionKindOf(raw)
    const normalized = normalizeApprovalRequest(raw)

    if (!normalized.ok) {
      return denyRequest(normalized.denial, mode, null, requestedKind)
    }

    const action = normalized.action
    const summary = approvalSafeSummary(action)
    const decision = decideSecurityAction(policy, securityActionOf(action))

    /*
      `ask` 以外はここで終わり。`read`（読み取り専用）の Permission では
      `read-only-mode` になり、**承認を求めるところまで進まない**（DESIGN.md §6.4）。
      Workspace の外・Secret ファイル・hard link も同じく、承認の対象にならない。
    */
    if (decision.verdict !== 'ask') {
      return denyRequest(decision.reason, mode, summary, action.kind)
    }

    const fingerprint = approvalFingerprint(action)

    if (fingerprint === null) {
      return denyRequest('fingerprint-failed', mode, summary, action.kind)
    }

    const createdAt = readClock(deps)

    if (createdAt === null) {
      return denyRequest('approval-state-invalid', mode, summary, action.kind)
    }

    const id = createApprovalId()
    const approval: StoredApproval = {
      id,
      actionKind: action.kind,
      fingerprint,
      summary,
      permissionMode: mode,
      expiresAt: createdAt + APPROVAL_TTL_MS,
      state: 'pending',
      cancelTimer: () => {},
      settle: () => {}
    }

    approvals.set(id, approval)
    record(approvalRequestedEvent(summary, mode))

    const outcome = new Promise<ApprovalOutcome>((resolve) => {
      let settled = false

      approval.settle = (value) => {
        if (settled) {
          return
        }

        settled = true
        resolve(value)
      }
    })

    approval.cancelTimer = startTimer(deps, () => {
      // 期限。待っている要求を deny で解き、記録を片付ける。
      denyApproval(approval, 'approval-expired')
      approvals.delete(id)
    })

    try {
      deps.notify(notice(approval))
    } catch {
      /*
        知らせられなかった（ウィンドウが無い・送信が失敗した）。利用者が見られない
        承認を期限まで残さず、その場で失効させる。
      */
      finish(approval, 'window-unavailable')
    }

    return outcome
  }

  async function respond(raw: unknown, window: unknown): Promise<void> {
    const parsed = parseIntent(raw)

    if (parsed === null) {
      record(approvalDeniedEvent('invalid-request', currentMode(deps), null, null))
      return
    }

    const approval = approvals.get(parsed.approvalId)

    if (approval === undefined) {
      /*
        知らない id。**他の承認には一切触れない** ── 当てずっぽうの id で
        別の承認を巻き添えに失効させられないようにする。
      */
      record(approvalDeniedEvent('approval-not-found', currentMode(deps), null, parsed.actionKind))
      return
    }

    if (approval.state !== 'pending') {
      /*
        すでに確認中・承認済み・失効済み。ここで失効させないのは、Native 確認を
        出している最中の承認を、取りこぼした Renderer の送り直しで壊さないため。
      */
      record(
        approvalDeniedEvent(
          'approval-state-invalid',
          approval.permissionMode,
          approval.summary,
          parsed.actionKind
        )
      )
      return
    }

    /*
      種類の名乗りが違う。**その承認を失効させる** ── 生きている承認に対して
      別の操作として続行を送ってきたもので、取りこぼしの送り直しには当たらない。
    */
    if (parsed.actionKind !== approval.actionKind) {
      finish(approval, 'binding-mismatch')
      return
    }

    if (isExpired(deps, approval)) {
      finish(approval, 'approval-expired')
      return
    }

    if (parsed.intent === 'cancel') {
      finish(approval, 'user-cancelled')
      return
    }

    if (!isUsableWindow(window)) {
      finish(approval, 'window-unavailable')
      return
    }

    // 続行の意思表示まで。ここではまだ承認になっていない。
    approval.state = 'confirming'

    let confirmation: ApprovalConfirmation

    try {
      confirmation = await deps.confirm(approval.summary, window)
    } catch {
      finish(approval, 'dialog-failed')
      return
    }

    // 確認している間に期限が来て片付いていることがある。
    if (approval.state !== 'confirming') {
      return
    }

    if (confirmation !== 'approve') {
      finish(approval, 'user-cancelled')
      return
    }

    if (!isUsableWindow(window)) {
      finish(approval, 'window-unavailable')
      return
    }

    if (isExpired(deps, approval)) {
      finish(approval, 'approval-expired')
      return
    }

    approval.state = 'approved'
    record(approvalApprovedEvent(approval.summary, approval.permissionMode))
    approval.settle(
      Object.freeze({
        decision: 'approved' as const,
        approvalId: approval.id,
        summary: approval.summary
      })
    )
  }

  /**
   * 実行の直前に承認を使い切る。
   *
   * **同期で状態を進める。** `await` を挟まないため、同時に2回呼ばれても
   * 成功するのは1回だけになる（2回目は `approval-already-used`）。
   */
  function consume(approvalId: unknown, raw: unknown): ApprovalConsumeResult {
    const mode = currentMode(deps)

    if (!isApprovalId(approvalId)) {
      return refuse('invalid-request', mode, null, approvalActionKindOf(raw))
    }

    const approval = approvals.get(approvalId)

    if (approval === undefined) {
      return refuse('approval-not-found', mode, null, approvalActionKindOf(raw))
    }

    if (approval.state === 'consumed') {
      return refuse(
        'approval-already-used',
        approval.permissionMode,
        approval.summary,
        approval.actionKind
      )
    }

    if (approval.state !== 'approved') {
      // 未承認のまま・確認中・失効済みのまま使おうとした。**その承認もここで失効させる。**
      finish(approval, 'approval-state-invalid')

      return Object.freeze({ ok: false as const, reason: 'approval-state-invalid' as const })
    }

    if (isExpired(deps, approval)) {
      finish(approval, 'approval-expired')
      return Object.freeze({ ok: false as const, reason: 'approval-expired' as const })
    }

    const normalized = normalizeApprovalRequest(raw)

    if (!normalized.ok) {
      finish(approval, normalized.denial)
      return Object.freeze({ ok: false as const, reason: normalized.denial })
    }

    const action = normalized.action

    if (action.kind !== approval.actionKind) {
      finish(approval, 'binding-mismatch')
      return Object.freeze({ ok: false as const, reason: 'binding-mismatch' as const })
    }

    const fingerprint = approvalFingerprint(action)

    if (fingerprint === null) {
      finish(approval, 'fingerprint-failed')
      return Object.freeze({ ok: false as const, reason: 'fingerprint-failed' as const })
    }

    /*
      承認したときと、これから行うものが同じか。対象の綴り・本文・コマンド・引数・
      cwd のどれか1つでも違えば、別の fingerprint になる。
    */
    if (fingerprint !== approval.fingerprint) {
      finish(approval, 'binding-mismatch')
      return Object.freeze({ ok: false as const, reason: 'binding-mismatch' as const })
    }

    approval.state = 'consumed'
    approval.cancelTimer()
    approvals.delete(approvalId)

    return Object.freeze({ ok: true as const, summary: approval.summary })
  }

  /** 失効させて片付ける（待っている要求は deny で解ける）。 */
  function finish(approval: StoredApproval, reason: ApprovalDenialReason): void {
    denyApproval(approval, reason)
    approval.cancelTimer()
    approvals.delete(approval.id)
  }

  /**
   * Agent の停止で、残っている承認をすべて失効させる（STEP9）。
   *
   * Native 確認を出している最中（`confirming`）のものも失効させる。確認の結果が後から
   * 届いても、状態が `confirming` でなくなっているため承認にはならない（respond の
   * 「確認している間に片付いている」と同じ扱い）。
   */
  function cancelAll(): number {
    const open = [...approvals.values()]

    for (const approval of open) {
      finish(approval, 'agent-stopped')
    }

    return open.length
  }

  return { request, respond, consume, cancelAll }
}

/** 承認を求める操作を、STEP1 の判定にかけられる形にする。 */
function securityActionOf(action: NormalizedApprovalAction): SecurityAction {
  if (action.kind === 'file.write') {
    /*
      Workspace の中か・Secret ファイルか・hard link かは、Boundary（STEP2）が
      確かめた対象から作り直す。要求に付いてきた自己申告は読まない。
    */
    return { kind: 'file.write', target: agentFileWriteFacts(action.target) }
  }

  return { kind: 'terminal.run' }
}

/** Renderer から届いた意思表示。**`approved` にあたる欄はここにも無い。** */
interface ParsedIntent {
  readonly approvalId: string
  readonly actionKind: ApprovalActionKind
  readonly intent: ApprovalIntent
}

function parseIntent(raw: unknown): ParsedIntent | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }

  try {
    const { approvalId, actionKind, intent } = raw as {
      readonly approvalId?: unknown
      readonly actionKind?: unknown
      readonly intent?: unknown
    }

    if (!isApprovalId(approvalId) || !isApprovalActionKind(actionKind)) {
      return null
    }

    if (intent !== 'continue' && intent !== 'cancel') {
      return null
    }

    return { approvalId, actionKind, intent }
  } catch {
    return null
  }
}

/** Native 確認を出せるウィンドウか。 */
function isUsableWindow(window: unknown): window is ApprovalWindow {
  if (typeof window !== 'object' || window === null) {
    return false
  }

  const candidate = window as { readonly isDestroyed?: unknown }

  if (typeof candidate.isDestroyed !== 'function') {
    return false
  }

  try {
    return (candidate as ApprovalWindow).isDestroyed() === false
  } catch {
    return false
  }
}

function notice(approval: StoredApproval): ApprovalRequestNotice {
  return Object.freeze({
    approvalId: approval.id,
    actionKind: approval.actionKind,
    subject: approval.summary.subject,
    workspacePath: approval.summary.workspacePath,
    commandSummary: approval.summary.commandSummary,
    expiresAt: approval.expiresAt
  })
}

/** 時刻は Main の時計だけを見る。読めなければ `null`（拒否側へ倒す材料になる）。 */
function readClock(deps: ApprovalManagerDependencies): number | null {
  try {
    const value = deps.now()

    return typeof value === 'number' && Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

/** 期限を過ぎているか。**時刻が読めない場合も過ぎていると読む。** */
function isExpired(deps: ApprovalManagerDependencies, approval: StoredApproval): boolean {
  const now = readClock(deps)

  return now === null || now >= approval.expiresAt
}

function startTimer(deps: ApprovalManagerDependencies, run: () => void): () => void {
  try {
    const cancel = deps.setTimer(run, APPROVAL_TTL_MS)

    return typeof cancel === 'function' ? cancel : () => {}
  } catch {
    return () => {}
  }
}

/** Policy が読めなければ、最も厳しい Policy として扱う（STEP1 / STEP5 と同じ倒し方）。 */
function readPolicy(deps: ApprovalManagerDependencies): SecurityPolicy {
  try {
    const policy: unknown = deps.readPolicy()

    if (typeof policy !== 'object' || policy === null) {
      return FAIL_CLOSED_SECURITY_POLICY
    }

    const mode = (policy as { readonly permissionMode?: unknown }).permissionMode

    return isAgentPermissionMode(mode) ? (policy as SecurityPolicy) : FAIL_CLOSED_SECURITY_POLICY
  } catch {
    return FAIL_CLOSED_SECURITY_POLICY
  }
}

function currentMode(deps: ApprovalManagerDependencies): AgentPermissionMode {
  return readPolicy(deps).permissionMode
}
