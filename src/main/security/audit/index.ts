/**
 * Security Audit Log の API（Security Core v1 の STEP4）。
 *
 * FN Agent / Security Core で起きた **Security 上重要な判断**を、Secret を漏らさず
 * Main 側で記録する共通の基盤。後の STEP（External Send Gate・Approval Manager・
 * File Write Gate・Command Runner・MCP Gateway・Activity）はすべてここを通す。
 *
 * ```
 * recordAuditEvent(event)      1件記録する（Main の Security Core だけが呼ぶ）
 * summarizeAuditRecord(record) Activity へ出せる安全な要約にする
 * AUDIT_EVENT_TYPES            記録できる種別（閉じた集合）
 * ```
 *
 * ## 決めてあること
 *
 * ```
 * 置き場所   <userData>/logs/agent-audit.log（Main が決める。指定できる引数は無い）
 * 上限       1 MiB / 1世代（agent-audit.log.1）
 * 形式       JSON Lines（1行 = 1件）
 * 種別       閉じた集合。Renderer / Agent から自由文字列では渡せない
 * Secret     書き込みの直前に Audit 自身が Mask する（STEP3 を最終防御として使う）
 * 失敗       呼び出し側へ返さない。Audit の失敗を理由に Security を緩める形を作らない
 * ```
 *
 * **Renderer へ公開する IPC も Preload の API も作らない。** Audit Event を外から
 * 注文できる口（`audit:write` のようなもの）は作らない（auditSurface.test.ts が見ている）。
 *
 * 公開する名前は auditSurface.test.ts が固定している。
 */
export { AUDIT_EVENT_TYPES, AUDIT_REASONS } from './auditEvent'
export { AUDIT_LOG_FILE_NAME, AUDIT_LOG_MAX_BYTES } from './auditLogWriter'
export { recordAuditEvent, whenAuditLogIdle } from './currentAuditLog'
export { summarizeAuditRecord } from './auditSummary'

export type {
  AuditCategory,
  AuditDecision,
  AuditEvent,
  AuditEventType,
  AuditOutcome,
  AuditReason
} from './auditEvent'
export type { AuditRecord } from './auditRecord'
export type { AuditSummary } from './auditSummary'
