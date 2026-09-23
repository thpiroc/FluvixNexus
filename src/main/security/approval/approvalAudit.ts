import type { AgentPermissionMode, ApprovalActionKind } from '@shared/security'
import type { AuditEvent, AuditReason } from '../audit/auditEvent'
import type { ApprovalSafeSummary } from './approvalSummary'

/**
 * 承認の判断を、Audit Event 1件にする（Security Core v1 の STEP6。Electron に依存しない）。
 *
 * ```
 * 渡す     種別（requested / approved / denied）・判定・理由・効いていた Permission・
 *          操作の種類・安全な対象名（subject）・Workspace 相対 Path
 * 渡さない 書き込む本文・Diff 本文・コマンドの全文と引数・コマンドの出力・
 *          fingerprint・Approval の id・絶対パス・Secret
 * ```
 *
 * `subject` に載るのは approvalSummary.ts が Mask して切った後の文字列だけで、
 * Terminal なら**コマンド名まで**にあたる（引数を並べた1行は画面には出すが、
 * Log には残さない ── Log は利用者の手を離れて渡りうるため）。
 *
 * **fingerprint も Approval の id も載せない。** どちらも「同じものか」を確かめるための
 * 値で、後から辿るための記録には要らない。Secret を hash 化すれば保存してよい、
 * という扱いにもしない（DESIGN.md §6.4）。
 *
 * `actionKind` は STEP1 の `SecurityActionKind` と同じ語（`file.write` / `terminal.run`）に
 * なるため、Policy の記録と Approval の記録を同じ欄で辿れる。
 */

/** 承認を求め始めた（pending を作った）。 */
export function approvalRequestedEvent(
  summary: ApprovalSafeSummary,
  permissionMode: AgentPermissionMode
): AuditEvent {
  return Object.freeze({
    type: 'approval.requested' as const,
    decision: 'ask' as const,
    reason: 'approval-required' as const,
    actionKind: summary.actionKind,
    permissionMode,
    subject: summary.subject,
    workspacePath: summary.workspacePath ?? undefined
  })
}

/** 利用者が Main の Native 確認で承認した。 */
export function approvalApprovedEvent(
  summary: ApprovalSafeSummary,
  permissionMode: AgentPermissionMode
): AuditEvent {
  return Object.freeze({
    type: 'approval.approved' as const,
    decision: 'allow' as const,
    reason: 'user-approved' as const,
    actionKind: summary.actionKind,
    permissionMode,
    subject: summary.subject,
    workspacePath: summary.workspacePath ?? undefined
  })
}

/**
 * 承認しなかった。
 *
 * `summary` が無い（形を読めずに拒んだ）場合は、種類だけが分かっていれば載せる。
 * **読めなかった値を「たぶんこれだろう」と補って記録することはしない。**
 */
export function approvalDeniedEvent(
  reason: AuditReason,
  permissionMode: AgentPermissionMode,
  summary: ApprovalSafeSummary | null,
  actionKind: ApprovalActionKind | null
): AuditEvent {
  return Object.freeze({
    type: 'approval.denied' as const,
    decision: 'deny' as const,
    reason,
    actionKind: summary?.actionKind ?? actionKind ?? undefined,
    permissionMode,
    subject: summary?.subject,
    workspacePath: summary?.workspacePath ?? undefined
  })
}
