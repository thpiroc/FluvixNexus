import type { AgentPermissionMode } from '@shared/security'
import type { AuditEvent, AuditReason } from '../audit/auditEvent'

/**
 * File Write の判断と結果を、Audit Event 1件にする（Security Core v1 の STEP7。Electron に依存しない）。
 *
 * ```
 * 渡す     種別（requested / approved / denied / succeeded / failed）・判定・理由・
 *          効いていた Permission・操作の種類（file.write）・Workspace 相対 Path
 * 渡さない ファイル本文・Diff 本文・提案された中身・Secret・fingerprint・
 *          中身の指紋・Approval の id・提案の id・絶対パス
 * ```
 *
 * **本文を載せられる欄を1つも通さない。** `subject` に入るのは Workspace 相対の Path
 * だけで（Audit 側でもう一度 Mask と長さの制限が掛かる）、Diff の行も、書いた
 * バイト数も入れない ── バイト数は中身の推定に使える上、「何が起きたか」を
 * 後から辿るのに要らない（DESIGN.md §6.4）。
 *
 * Path が読めなかった場合は**載せない。** 「たぶんこれだろう」と補った Path を
 * 記録すると、後から辿ったときに実際とは違う場所を指す。
 */

/** File Write を求められた（判定の前）。 */
export function fileWriteRequestedEvent(
  workspacePath: string | null,
  permissionMode: AgentPermissionMode
): AuditEvent {
  return event('file-write.requested', 'ask', 'approval-required', workspacePath, permissionMode)
}

/** 承認が通り、これから書く。 */
export function fileWriteApprovedEvent(
  workspacePath: string | null,
  permissionMode: AgentPermissionMode
): AuditEvent {
  return event('file-write.approved', 'allow', 'user-approved', workspacePath, permissionMode)
}

/** 書かなかった（判定・承認・事前の確認のどこかで止まった）。 */
export function fileWriteDeniedEvent(
  reason: AuditReason,
  workspacePath: string | null,
  permissionMode: AgentPermissionMode
): AuditEvent {
  return event('file-write.denied', 'deny', reason, workspacePath, permissionMode)
}

/** 書いて、書いた結果も確かめられた。 */
export function fileWriteSucceededEvent(
  workspacePath: string | null,
  permissionMode: AgentPermissionMode
): AuditEvent {
  return Object.freeze({
    ...event('file-write.succeeded', 'allow', 'user-approved', workspacePath, permissionMode),
    outcome: 'success' as const
  })
}

/**
 * 承認は通ったが、書き込みそのものが通らなかった。
 *
 * `denied`（書かなかった）と分けてあるのは、**書き込みに手を付けた後の失敗**が
 * ここに来るため ── 既存のファイルが途中まで変わっている可能性があり、
 * 後から辿るときに「拒否されただけ」と区別できる必要がある。
 */
export function fileWriteFailedEvent(
  reason: AuditReason,
  workspacePath: string | null,
  permissionMode: AgentPermissionMode,
  error?: unknown
): AuditEvent {
  return Object.freeze({
    ...event('file-write.failed', 'deny', reason, workspacePath, permissionMode),
    outcome: 'failure' as const,
    ...(error === undefined ? {} : { error })
  })
}

function event(
  type: AuditEvent['type'],
  decision: 'allow' | 'ask' | 'deny',
  reason: AuditReason,
  workspacePath: string | null,
  permissionMode: AgentPermissionMode
): AuditEvent {
  return Object.freeze({
    type,
    decision,
    reason,
    actionKind: 'file.write' as const,
    permissionMode,
    ...(workspacePath === null ? {} : { subject: workspacePath, workspacePath })
  })
}
