import type { StoredSecuritySettings } from '@shared/settings'
import { resolveAgentPermissionMode, type AgentPermissionMode } from '@shared/security'

/**
 * Security Policy（Security Core v1 の STEP1。Electron にも fs にも依存しない）。
 *
 * ## Policy に入るのは Permission だけ
 *
 * 設定から変えられるのは `permissionMode`（`read` / `ask`）の1つだけで、
 * **固定の規則は Policy に入れない。** Workspace の外・Secret ファイルへの書き込み・
 * hard link 経由の書き込み・MCP の書き込み・Git の Commit / Push を拒むことは
 * securityDecision.ts の定数が持つ ── Policy の欄にすると、「その欄を false にした
 * Policy」を作って渡すだけで規則が消える形になる。
 *
 * ## 凍結して返す
 *
 * 受け取った側が書き換えても効かないように（書こうとすれば TypeError になる）。
 * Policy を作り直す口はここの `resolveSecurityPolicy` だけで、材料は Main が
 * 保存から読んだ値に限る（currentSecurityPolicy.ts）。
 */

export interface SecurityPolicy {
  /** 実際に効く Permission（ユーザー設定とワークスペース設定の厳しい方）。 */
  readonly permissionMode: AgentPermissionMode
}

/**
 * 保存された2つの scope の値から、Policy を組み立てる。
 *
 * ワークスペース設定は、ユーザー設定より**厳しくする方向にしか効かない**
 * （shared/security/permissionMode.ts の `resolveAgentPermissionMode`）。
 */
export function resolveSecurityPolicy(
  user: StoredSecuritySettings | undefined,
  workspace: StoredSecuritySettings | null | undefined
): SecurityPolicy {
  return Object.freeze({ permissionMode: resolveAgentPermissionMode(user, workspace) })
}

/** 最も厳しい Policy（読めなかったときの落とし先）。 */
export const FAIL_CLOSED_SECURITY_POLICY: SecurityPolicy = Object.freeze({
  permissionMode: 'read'
})
