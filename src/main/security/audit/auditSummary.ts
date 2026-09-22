import type { AuditCategory, AuditDecision, AuditRecordEventType } from './auditEvent'
import type { AuditRecord } from './auditRecord'

/**
 * Audit の記録から、Activity（後の STEP）へ出せる安全な要約を作る（Security Core v1 の STEP4）。
 *
 * **Activity は Audit Log の行をそのまま表示しない。** 理由は2つ。
 *
 *   - Log の行は「後から追う」ための形で、画面に出すための形ではない
 *     （欄が増えるたびに UI が影響を受け、増えた欄がそのまま画面へ漏れる）
 *   - 表示は Renderer へ渡る。渡る欄は**閉じた集合の値だけ**に絞っておきたい
 *
 * そこで、この要約が持つのは**時刻と、閉じた集合から来た語だけ。** `subject`・
 * `workspacePath`・`error` のような文字列の欄は、伏せた後のものであっても含めない
 * （Activity に必要になった時点で、欄ごとに是非を決める）。
 *
 * STEP4 では Activity UI も、この要約を Renderer へ渡す IPC も作らない。用意するのは
 * 「安全な要約を作れる形になっている」ことまで。
 */

export interface AuditSummary {
  /** ISO 8601（UTC）。 */
  readonly time: string
  readonly category: AuditCategory
  /** 何が起きたか（閉じた集合）。 */
  readonly action: AuditRecordEventType
  readonly decision: AuditDecision | null
  /**
   * 1行の説明。**閉じた集合の語をつないだだけ**で、名前・パス・Error の文言は入らない。
   * 例：`file-write.denied / deny / secret-file`
   */
  readonly summary: string
  /** 利用者へ「一部を伏せた」と知らせるべきか。 */
  readonly userNoticeRequired: boolean
}

export function summarizeAuditRecord(record: AuditRecord): AuditSummary {
  const parts: string[] = [record.event, record.decision, record.reason, record.outcome].filter(
    (part) => part !== null
  )

  return Object.freeze({
    time: record.time,
    category: record.category,
    action: record.event,
    decision: record.decision,
    summary: parts.join(' / '),
    userNoticeRequired: record.userNoticeRequired === true
  })
}
