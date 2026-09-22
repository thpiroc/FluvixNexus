import { redactLogText } from '../../logger/logRedaction'
import { describeErrorWithoutSecrets, maskSecretText } from '../secret/secretMasking'
import { SECRET_CATEGORIES, type SecretCategory } from '../secret/secretPatterns'
import {
  auditEventCategory,
  AUDIT_INTERNAL_CATEGORY,
  AUDIT_UNRECOGNIZED_EVENT,
  isAuditActionKind,
  isAuditDecision,
  isAuditOutcome,
  isAuditPermissionMode,
  isAuditReason,
  type AuditCategory,
  type AuditDecision,
  type AuditEvent,
  type AuditEventType,
  type AuditOutcome,
  type AuditReason,
  type AuditRecordEventType
} from './auditEvent'
import type { AgentPermissionMode } from '@shared/security'
import type { SecurityActionKind } from '../policy/securityDecision'

/**
 * Audit Event を、書いてよい1件の記録にする（Security Core v1 の STEP4）。
 *
 * **ここが Audit 専用の最終 Sanitize 境界にあたる。** 呼び出し側が「この値は安全だ」と
 * 主張しても信用しない ── 型を名乗っているだけのものとして読み、
 *
 * ```
 * 閉じた集合の欄   一覧に無い値は捨てる（null にする。知らない値をそのまま書かない）
 * 数の欄           有限の非負整数だけ。それ以外は捨てる
 * 文字列の欄       STEP3 の maskSecretText → 既存のログの伏せ字（絶対パス）→ 制御文字を潰す → 長さで切る
 * Error            describeErrorWithoutSecrets（stack は読まない）を通してから同じ手順
 * 知らない種別     その種別としては記録せず audit.unrecognized-event へ倒し、**他の欄も捨てる**
 * ```
 *
 * を必ず通す。Mask を呼ぶのは呼び出し側の責任にしない ── 呼び忘れた1か所が
 * そのまま平文の Secret になるため。
 *
 * ## 2つの伏せ字を重ねる
 *
 * STEP3（`maskSecretText`）は Secret の**値**を、既存の `redactLogText` は
 * **絶対パス**（`C:\Users\<名前>\…`）と URL の認証情報を伏せる。Audit Log は
 * 利用者の手を離れて渡りうるため、両方を通す。相対位置（`src/main/index.ts`）は
 * どちらにも当たらず、そのまま残る。
 *
 * ## 失敗しても平文へは倒さない
 *
 * getter が例外を投げる・種別が偽装されている・値が読めない、のどれでも
 * **未検査の文字は1つも記録しない。** 最小限の記録（時刻・`audit.unrecognized-event`・理由）
 * だけを返す。
 */

/** `subject` の上限（Tool 名・設定の key に足りる長さ）。 */
export const AUDIT_SUBJECT_MAX_LENGTH = 120

/** `workspacePath` の上限。 */
export const AUDIT_PATH_MAX_LENGTH = 256

/** `error` の上限。 */
export const AUDIT_ERROR_MAX_LENGTH = 400

/** 伏せる前に読む上限。これを超えた分は捨てる（切った端の欠片も残さない）。 */
const TEXT_READ_LIMIT = 4096

/** `maskedCount` の上限（これ以上は数として意味が無い）。 */
const MASKED_COUNT_MAX = 1_000_000

/**
 * Log に書く1件。**Secret の値を持つ欄はここにも無い。**
 * 分かっていない欄は `null`（書き出しでは省く）。
 */
export interface AuditRecord {
  /** ISO 8601（UTC）。 */
  readonly time: string
  readonly event: AuditRecordEventType
  readonly category: AuditCategory
  readonly decision: AuditDecision | null
  readonly reason: AuditReason | null
  readonly outcome: AuditOutcome | null
  readonly actionKind: SecurityActionKind | null
  readonly permissionMode: AgentPermissionMode | null
  readonly subject: string | null
  readonly workspacePath: string | null
  readonly secretCategories: readonly SecretCategory[] | null
  readonly maskedCount: number | null
  readonly userNoticeRequired: boolean | null
  readonly error: string | null
}

/**
 * Audit Event 1件を記録に変える。**例外を投げない。**
 *
 * `time` は書き込んだ時刻ではなく**この関数を呼んだ時刻**（= event が起きた時刻）。
 * 書き込みは列に並ぶため、書いた順と起きた順がずれないようにここで押す。
 */
export function sanitizeAuditEvent(event: AuditEvent, time: Date = new Date()): AuditRecord {
  const at = timeText(time)

  try {
    const raw: unknown = event

    if (!isRecord(raw)) {
      return unrecognized(at, 'sanitize-failed')
    }

    const category = auditEventCategory(raw.type)

    if (category === null) {
      // 種別が偽装されている・知らない。**他の欄も信用しない**（何の記録かが決まらない）。
      return unrecognized(at, 'unrecognized-event')
    }

    return Object.freeze({
      time: at,
      event: raw.type as AuditEventType,
      category,
      decision: isAuditDecision(raw.decision) ? raw.decision : null,
      reason: isAuditReason(raw.reason) ? raw.reason : null,
      outcome: isAuditOutcome(raw.outcome) ? raw.outcome : null,
      actionKind: isAuditActionKind(raw.actionKind) ? raw.actionKind : null,
      permissionMode: isAuditPermissionMode(raw.permissionMode) ? raw.permissionMode : null,
      subject: sanitizeAuditText(raw.subject, AUDIT_SUBJECT_MAX_LENGTH),
      workspacePath: sanitizeAuditText(raw.workspacePath, AUDIT_PATH_MAX_LENGTH),
      secretCategories: sanitizeCategories(raw.secretCategories),
      maskedCount: sanitizeCount(raw.maskedCount),
      userNoticeRequired:
        typeof raw.userNoticeRequired === 'boolean' ? raw.userNoticeRequired : null,
      error: sanitizeError(raw.error)
    })
  } catch {
    // getter が投げた・値を読めなかった。何が入っていたか分からない以上、何も書かない。
    return unrecognized(at, 'sanitize-failed')
  }
}

/** 最小限の記録（他の欄は持たない）。 */
export function minimalAuditRecord(time: string, reason: AuditReason): AuditRecord {
  return unrecognized(time, reason)
}

function unrecognized(time: string, reason: AuditReason): AuditRecord {
  return Object.freeze({
    time,
    event: AUDIT_UNRECOGNIZED_EVENT,
    category: AUDIT_INTERNAL_CATEGORY,
    decision: null,
    reason,
    outcome: null,
    actionKind: null,
    permissionMode: null,
    subject: null,
    workspacePath: null,
    secretCategories: null,
    maskedCount: null,
    userNoticeRequired: null,
    error: null
  })
}

/**
 * 文字列1つを、記録してよい形にする。
 *
 * 伏せる順が大事 ── **切るのは伏せた後。** 先に切ると、切れ目をまたいだ Secret の
 * 前半だけが伏せられずに残る。上限を超えた入力は、末尾の語（空白で区切られた最後の塊）を
 * 落としてから伏せる ── 切れ目で半分になった token を「形が違う」として見逃さないため。
 */
export function sanitizeAuditText(value: unknown, limit: number): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }

  const overLimit = value.length > TEXT_READ_LIMIT
  const read = overLimit ? value.slice(0, TEXT_READ_LIMIT).replace(/\S+$/, '') : value
  const masked = maskSecretText(read).text
  const redacted = redactLogText(masked)
  const collapsed = redacted.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim()

  if (collapsed.length === 0) {
    return null
  }

  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit)}…`
}

/**
 * Error を1行にする。
 *
 * stack は読まない（アプリの置き場所のパスが並ぶだけで、伏せると行番号も読めなくなる。
 * main/logger/logRedaction.ts と同じ判断）。必要なら name・code・伏せた message だけが残る。
 */
function sanitizeError(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }

  return sanitizeAuditText(describeErrorWithoutSecrets(value), AUDIT_ERROR_MAX_LENGTH)
}

/** 知っている種別だけ（重複なし・名前順）。 */
function sanitizeCategories(value: unknown): readonly SecretCategory[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const known = new Set<SecretCategory>()

  for (const entry of value) {
    if (typeof entry === 'string' && SECRET_CATEGORIES.includes(entry as SecretCategory)) {
      known.add(entry as SecretCategory)
    }
  }

  return known.size === 0 ? null : Object.freeze([...known].sort())
}

/** 有限の非負整数だけ。 */
function sanitizeCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return null
  }

  return Math.min(value, MASKED_COUNT_MAX)
}

/** 読めない時刻は現在時刻に倒す（記録に時刻の無い行を作らない）。 */
function timeText(time: Date): string {
  const value = time instanceof Date ? time.getTime() : Number.NaN

  return new Date(Number.isFinite(value) ? value : Date.now()).toISOString()
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
