import { minimalAuditRecord, type AuditRecord } from './auditRecord'

/**
 * 記録1件を Log の1行にする（Security Core v1 の STEP4）。
 *
 * ## 形式：JSON Lines（1行 = 1件の JSON object）
 *
 * ```
 * {"time":"2026-09-23T09:41:02.318Z","event":"file-write.denied","category":"file-write","decision":"deny","reason":"secret-file"}
 * ```
 *
 * この形にした理由は3つ。
 *
 * ```
 * 1件が1行で閉じる      … 途中の1行が壊れても、他の行はそのまま読める（全体を1つの JSON にしない）
 * 構造を壊せない        … 改行・引用符・制御文字は JSON の文字列として逃がされる。
 *                         値に何を入れても行の区切りにならない（偽の行を差し込めない）
 * 人も機械も読める      … 目で追え、Activity（後の STEP）や集計はそのまま構文解析できる
 * ```
 *
 * 欄の順は固定（時刻 → 種別 → 分類 → 判定 → …）で、**分かっていない欄は書かない。**
 * `null` を並べても読む側に何も伝わらず、1件を無駄に長くするだけのため。
 *
 * ## 1件の上限
 *
 * 1件が異常に大きくなっても、Log 全体の上限（1 MiB）を1件で大きく超えないよう
 * **`AUDIT_RECORD_MAX_BYTES` で頭打ちにする。** 超えた場合は、その1件を最小限の記録
 * （時刻・`audit.unrecognized-event`・`record-too-large`）に落とす ── 途中で切ると、
 * 壊れた JSON の行が残るため。
 *
 * Sanitize（auditRecord.ts）が各欄の長さを抑えているため、通常この上限には当たらない。
 * ここは**最後の歯止め**にあたる。
 */

/** 1件の上限（バイト。改行を含む）。 */
export const AUDIT_RECORD_MAX_BYTES = 4096

/** 書き出す欄の順。ここに無い欄は書かない。 */
const FIELD_ORDER = [
  'time',
  'event',
  'category',
  'decision',
  'reason',
  'outcome',
  'actionKind',
  'permissionMode',
  'subject',
  'workspacePath',
  'secretCategories',
  'maskedCount',
  'userNoticeRequired',
  'attempt',
  'error'
] as const satisfies readonly (keyof AuditRecord)[]

/**
 * 記録1件を1行にする（改行は含まない）。**例外を投げない。**
 *
 * `maxBytes` はテストのための差し替え口で、既定は `AUDIT_RECORD_MAX_BYTES`。
 */
export function formatAuditRecordLine(
  record: AuditRecord,
  maxBytes: number = AUDIT_RECORD_MAX_BYTES
): string {
  const line = toLine(record)

  if (byteLengthWithNewline(line) <= maxBytes) {
    return line
  }

  const fallback = toLine(minimalAuditRecord(record.time, 'record-too-large'))

  // 最小限の記録でも入らない上限を渡された場合だけ、いちばん短い形へ落とす。
  return byteLengthWithNewline(fallback) <= maxBytes ? fallback : '{}'
}

function toLine(record: AuditRecord): string {
  const fields: Record<string, unknown> = {}

  for (const key of FIELD_ORDER) {
    const value = record[key]

    if (value !== null && value !== undefined) {
      fields[key] = value
    }
  }

  let text: string

  try {
    text = JSON.stringify(fields)
  } catch {
    // 作れないものは行にしない（読む側に壊れた JSON を見せない）。
    return '{}'
  }

  /*
    JSON.stringify は制御文字を逃がすが、U+2028 / U+2029 はそのまま残す
    （JSON としては正しいが、行として読む側には改行に見えうる）。Sanitize で既に潰して
    あり、ここは二重の歯止めにあたる。
  */
  return text === undefined ? '{}' : text.replace(/[\r\n\u2028\u2029]/g, ' ')
}

function byteLengthWithNewline(line: string): number {
  return Buffer.byteLength(line, 'utf8') + 1
}
