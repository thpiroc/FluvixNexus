import type { AgentPermissionMode } from '@shared/security'
import type { AuditEvent, AuditReason } from '../audit/auditEvent'

/**
 * Read Tool Gate の Audit Event（Security Core v1 の STEP9）。
 *
 * **拒否だけを記録する。** 許可した読み取りは記録しない（2026-09-23 確定）── Agent は
 * 1つの作業で何十回も読むため、許可まで残すと Audit Log が読み取りの履歴で埋まる。
 *
 * 載せるのは Tool の名前（`subject`）・理由・効いていた Permission・Workspace 相対の位置
 * だけ。**読んだ中身・検索語・一覧の名前は載せない**（AuditEvent の型にも欄が無い）。
 */

/** 読み取り系の Tool の名前（Audit の `subject`）。 */
export type ReadToolName = 'file_read' | 'workspace_list' | 'file_search' | 'workspace_status'

export function readToolDeniedEvent(
  tool: ReadToolName,
  reason: AuditReason,
  workspacePath: string | null,
  permissionMode: AgentPermissionMode
): AuditEvent {
  return {
    type: 'file-read.denied',
    decision: 'deny',
    reason,
    actionKind: 'file.read',
    permissionMode,
    subject: tool,
    ...(workspacePath === null || workspacePath === '' ? {} : { workspacePath })
  }
}
