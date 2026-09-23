/**
 * Security Core の Policy API（Security Core v1 の STEP1）。
 *
 * 後の STEP の Gate（File Write・Command Runner・MCP Gateway・External Send …）が
 * 共通で使う入口はこの2つだけ。
 *
 * ```
 * getCurrentSecurityPolicy()          今効いている Policy（Main が保存から毎回読み直す）
 * decideSecurityAction(policy, action) 操作1件を allow / ask / deny にする
 * ```
 *
 * **Security Core を無効にする・規則を飛ばす・判定を上書きする・Policy を書き換える
 * API は作らない**（DESIGN.md §6.3）。Permission を変える経路は、利用者の設定
 * （Main が検証する `settings:save-section`）だけになる。
 * 公開する名前は securityPolicySurface.test.ts が固定している。
 */
export { isFnAgentEnabled } from './currentAgentEnabled'
export { getCurrentSecurityPolicy } from './currentSecurityPolicy'
export { decideSecurityAction, SECURITY_ACTION_KINDS } from './securityDecision'

export type {
  FileTargetFacts,
  FileWriteTargetFacts,
  SecurityAction,
  SecurityActionKind,
  SecurityDecision,
  SecurityDecisionReason,
  SecurityVerdict
} from './securityDecision'
export type { SecurityPolicy } from './securityPolicy'
