import type { AgentPermissionMode } from '@shared/security'
import type { AuditEvent, AuditReason } from '../security/audit'
import type { AgentActionType } from './agentAction'

/**
 * Agent Loop の Audit Event（Security Core v1 の STEP9）。
 *
 * **Security 上意味のある出来事だけ**を記録する（2026-09-23 確定）。
 *
 * ```
 * agent.action-rejected   AI の Action を実行せずに拒んだ（壊れた出力・並列・拒否済みの再提案）
 * agent.stopped           利用者が停止した（承認待ちを取り消し、次の Action を始めない）
 * ```
 *
 * 単なる開始・完了・Loop の回数は記録しない。**AI の出力・指示・Action の中身
 * （パス・本文・コマンド・引数）は載せない** ── 載せるのは Action の種類（`subject`）・
 * 理由・効いていた Permission だけ。副作用ロックでの拒否は、File Write / Terminal の Gate が
 * それぞれ `side-effect-in-progress` として記録する。
 */

export function agentActionRejectedEvent(
  reason: Extract<AuditReason, 'invalid-action' | 'parallel-action' | 'repeated-action'>,
  actionType: AgentActionType | null,
  permissionMode: AgentPermissionMode
): AuditEvent {
  return {
    type: 'agent.action-rejected',
    decision: 'deny',
    reason,
    permissionMode,
    subject: actionType ?? 'unknown'
  }
}

export function agentStoppedEvent(permissionMode: AgentPermissionMode): AuditEvent {
  return {
    type: 'agent.stopped',
    reason: 'agent-stopped',
    permissionMode
  }
}
