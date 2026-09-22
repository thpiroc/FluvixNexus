/**
 * Secret Detection / Masking の API（Security Core v1 の STEP3）。
 *
 * FN Agent が読むファイル・Context・ログ・Error に Secret が混ざったとき、
 * **平文のまま先へ渡さない**ための共通の層。後の STEP（Audit Log・Activity・
 * Approval・File Write Gate・External Provider Send Gate）はすべてここを通す。
 *
 * ```
 * classifySecretPath(relativePath)    名前だけで Secret ファイルか決める
 * isSecretWorkspaceTarget(target)     Boundary（STEP2）の対象が Secret ファイルか
 * agentFileReadFacts / agentFileWriteFacts
 *                                     Boundary の結果 ＋ Secret 判定 → STEP1 へ渡す事実
 * scanTargetFromBytes(bytes)          バイナリ・大きすぎるものを検査にかけない
 * maskSecretText(text)                本文を伏せて、伏せたことだけを返す
 * redactSecretText(text)              伏せた本文だけが欲しいとき
 * describeErrorWithoutSecrets(error)  Error を Secret 抜きの1行にする
 * ```
 *
 * **Secret の検出を止める・結果を上書きする・元の値を取り出す API は作らない。**
 * 伏せ字から元の値へ戻す経路も無い（置き換えであり、可逆な変換ではない）。
 * 公開する名前は secretSurface.test.ts が固定している。
 *
 * ## ここが持たないもの
 *
 * 既存の MCP の秘密の保存（main/mcp/mcpSecretStore.ts）とその伏せ字
 * （main/mcp/mcpRedaction.ts）、ログの1行の伏せ字（main/logger/logRedaction.ts）は、
 * **それぞれの用途の対策としてそのまま残す。** この層はそれらを置き換えるものではなく、
 * 「Agent・Context・外部送信へ Secret を出さない」ための別の層にあたる。
 */
export {
  describeErrorWithoutSecrets,
  maskSecretText,
  redactSecretText,
  SECRET_MASK,
  SECRET_SCAN_MAX_CHARS
} from './secretMasking'
export { SECRET_CATEGORIES } from './secretPatterns'
export { agentFileReadFacts, agentFileWriteFacts, isSecretWorkspaceTarget } from './secretFileFacts'
export { classifySecretPath } from './secretPaths'
export { scanTargetFromBytes } from './secretScan'

export type { SecretMaskResult } from './secretMasking'
export type { SecretCategory } from './secretPatterns'
export type { SecretPathVerdict } from './secretPaths'
export type { SecretScanTarget } from './secretScan'
