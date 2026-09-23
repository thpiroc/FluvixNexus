import type { StoredSecuritySettings } from '../settings/sections'

/**
 * FN Agent 全体の ON / OFF（Security Core v1 の STEP9。DESIGN.md §6.4）。
 *
 * | 保存されている値        | 使う値 |
 * | ----------------------- | ------ |
 * | 無い（未設定）          | ON（既定） |
 * | `true` / `false`        | そのまま |
 * | 真偽値でない値          | OFF（安全側） |
 *
 * **User / Workspace は常に厳しい方（strictest）。** どちらか一方でも OFF なら OFF で、
 * 両方が ON のときだけ ON になる（Permission と同じ `restrictive` の重ね方）。
 * Workspace から Agent を有効に戻すことはできない。
 *
 * OFF が止めるのは **Agent Loop を始めること**（実行中なら次の Action へ進むこと）で、
 * Security Core そのものを止める欄ではない。ON にしても検査・承認は何も緩まない。
 */

/** 何も設定されていないときの値。 */
export const DEFAULT_AGENT_ENABLED = true

/** 保存されている値から、使う値へ。`undefined` だけが既定（ON）。 */
export function normalizeAgentEnabled(raw: unknown): boolean {
  if (raw === undefined) {
    return DEFAULT_AGENT_ENABLED
  }

  return raw === true
}

/** ユーザー設定とワークスペース設定から、実際に効く ON / OFF を決める（厳しい方）。 */
export function resolveAgentEnabled(
  user: StoredSecuritySettings | undefined,
  workspace: StoredSecuritySettings | null | undefined
): boolean {
  return normalizeAgentEnabled(user?.agentEnabled) && normalizeAgentEnabled(workspace?.agentEnabled)
}
