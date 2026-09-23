/**
 * Security Core のうち、Main と Renderer の両方が読む部分（型と純粋な関数だけ）。
 *
 * **判定そのものはここに無い。** 操作を許すか・承認を求めるか・拒むかを決めるのは
 * Main だけで（main/security/policy/）、Renderer が持つのは画面に出すための値の読み方まで。
 */
export { APPROVAL_ACTION_KINDS, isApprovalActionKind } from './approvalAction'
export {
  AGENT_PERMISSION_MODES,
  DEFAULT_AGENT_PERMISSION_MODE,
  FAIL_CLOSED_AGENT_PERMISSION_MODE,
  isAgentPermissionMode,
  normalizeAgentPermissionMode,
  resolveAgentPermissionMode,
  restrictSecuritySettings,
  strictestAgentPermissionMode
} from './permissionMode'

export type { AgentPermissionMode } from './permissionMode'
export type { ApprovalActionKind } from './approvalAction'
