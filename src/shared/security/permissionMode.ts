import type { StoredSecuritySettings } from '../settings/sections'
import { resolveAgentEnabled } from './agentEnabled'

/**
 * FN Agent の Permission（Security Core v1。DESIGN.md §6.4）。
 *
 * ```
 * read … 読み取り専用。副作用のある操作は「承認すれば通る」ではなく、実行できない
 * ask  … 副作用のある操作を、操作ごとに Main 側の承認（Renderer の Diff ＋ Main の
 *        Native 確認）を通して実行できる。**自動で許可するモードではない**
 * ```
 *
 * **Security の強さは `read` の方が `ask` より厳しい。** 自動で許可する `auto` は
 * v2 以降で、v1 には存在しない ── 保存に `auto` があっても、それは
 * 「知らない値」として扱う（下の `normalizeAgentPermissionMode`）。
 *
 * ## 既定は `ask`、読めない値は `read`
 *
 * | 保存されている値                | 使う値 |
 * | ------------------------------- | ------ |
 * | 無い（未設定）                  | `ask`（既定） |
 * | `read` / `ask`                  | そのまま |
 * | `auto`・知らない文字列・文字列でない値 | `read`（安全側） |
 *
 * 「無い」と「読めない」を分けるのは、**読めない値は利用者が何かを決めた跡**だからにほかならない
 * ── 壊れた / 古い / 新しい版の値を既定へ戻すと、`read` を選んでいた人の設定が
 * 壊れただけで `ask` へ緩む。緩む方向へ倒れる読み替えはしない。
 *
 * ## User / Workspace は常に厳しい方（strictest）
 *
 * 他の設定の `ワークスペース > ユーザー` とは違い、**どちらか一方でも `read` なら `read`**。
 * 両方が `ask` のときだけ `ask` になる。ワークスペース設定は、ユーザー設定より
 * 厳しくする方向にしか効かない（shared/settings/scope.ts の `restrictive`）。
 */

export type AgentPermissionMode = 'read' | 'ask'

/** 厳しい順。 */
export const AGENT_PERMISSION_MODES: readonly AgentPermissionMode[] = ['read', 'ask']

/** 何も設定されていないときの値。 */
export const DEFAULT_AGENT_PERMISSION_MODE: AgentPermissionMode = 'ask'

/** 読めない値の落とし先（最も厳しい値）。 */
export const FAIL_CLOSED_AGENT_PERMISSION_MODE: AgentPermissionMode = 'read'

/** 素の値が、この版の知っている Permission か。 */
export function isAgentPermissionMode(value: unknown): value is AgentPermissionMode {
  return value === 'read' || value === 'ask'
}

/**
 * 保存されている値から、使う値へ。
 *
 * `undefined` だけが既定（`ask`）になり、それ以外で知らない値はすべて `read`。
 * 大文字の `ASK` や前後に空白のある ` ask` も読み替えない（知らない値）。
 */
export function normalizeAgentPermissionMode(raw: unknown): AgentPermissionMode {
  if (raw === undefined) {
    return DEFAULT_AGENT_PERMISSION_MODE
  }

  return isAgentPermissionMode(raw) ? raw : FAIL_CLOSED_AGENT_PERMISSION_MODE
}

/** 2つの Permission のうち厳しい方。どちらかが `read` なら `read`。 */
export function strictestAgentPermissionMode(
  a: AgentPermissionMode,
  b: AgentPermissionMode
): AgentPermissionMode {
  return a === 'ask' && b === 'ask' ? 'ask' : 'read'
}

/**
 * ユーザー設定とワークスペース設定から、実際に効く Permission を決める。
 *
 * ワークスペース設定が無い（Workspace を開いていない / 上書きしていない）なら
 * `normalize(undefined)` ＝ `ask` と重ねることになり、ユーザー設定がそのまま効く
 * ── `ask` は strictest の単位元なので、「上書きが無い」を別に扱う必要が無い。
 */
export function resolveAgentPermissionMode(
  user: StoredSecuritySettings | undefined,
  workspace: StoredSecuritySettings | null | undefined
): AgentPermissionMode {
  return strictestAgentPermissionMode(
    normalizeAgentPermissionMode(user?.permissionMode),
    normalizeAgentPermissionMode(workspace?.permissionMode)
  )
}

/**
 * section の形のまま、厳しい方を採って重ねる（shared/settings/scope.ts から呼ぶ）。
 *
 * ワークスペース側に上書きが無ければユーザー設定の section を**そのまま**返す
 * （他の section と同じく、変わっていないものは同じ object のまま）。
 * 上書きがあれば、重ねた結果を**正規化した値**で持つ。
 *
 * Agent の ON / OFF（STEP9。shared/security/agentEnabled.ts）も同じ重ね方にする。
 * どちらの scope にも無い key は、結果にも入れない（既定のまま）。
 */
export function restrictSecuritySettings(
  user: StoredSecuritySettings,
  workspace: StoredSecuritySettings | undefined
): StoredSecuritySettings {
  if (workspace === undefined) {
    return user
  }

  if (workspace.permissionMode === undefined && workspace.agentEnabled === undefined) {
    return user
  }

  return {
    ...(user.permissionMode === undefined && workspace.permissionMode === undefined
      ? {}
      : { permissionMode: resolveAgentPermissionMode(user, workspace) }),
    ...(user.agentEnabled === undefined && workspace.agentEnabled === undefined
      ? {}
      : { agentEnabled: resolveAgentEnabled(user, workspace) })
  }
}
