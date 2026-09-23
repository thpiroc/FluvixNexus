import { SECRET_MASK, SECRET_SCAN_MAX_CHARS } from '../secret/secretMasking'
import { findSecretMatches } from '../secret/secretPatterns'
import { splitLines } from './fileWriteDiff'

/**
 * 本文全体で Secret を探し、**行の数を変えずに**伏せる（Security Core v1 の STEP7）。
 *
 * Electron にも fs にも依存しない。
 *
 * ## 1行ずつ伏せるだけでは足りない
 *
 * STEP3 の `maskSecretText` を1行ずつ呼ぶと、**複数行にまたがる Secret が素通りする。**
 * Private Key は `-----BEGIN … PRIVATE KEY-----` から END までを1つとして見つける形の
 * ため、鍵の本体だけの行を単独で渡しても「ただの Base64 らしき文字列」にしかならない。
 *
 * ```
 * -----BEGIN RSA PRIVATE KEY-----   ← 1行ずつだと、この行は印だけ
 * MIIEowIBAAKCAQEAv0Hh8kQfQ2mZ…     ← **伏せられずに画面へ出てしまう**
 * -----END RSA PRIVATE KEY-----
 * ```
 *
 * ## 本文で探して、行へ割り当てる
 *
 * かといって本文をまとめて伏せてから行へ分けると、block 全体が伏せ字1つに畳まれて
 * **行数が変わる** ── Diff の行番号と対応が取れなくなる。
 *
 * そこで、探すのは本文全体に対して行い、**見つかった範囲を行ごとに切り分けて**
 * 伏せる。block にかかった行は、その行の中の重なった部分だけが伏せ字になり、
 * 行の数も並びも変わらない。
 *
 * ## 分からなければ伏せる
 *
 * 検出が例外で落ちた場合は**全部の行を伏せる。** 上限（`SECRET_SCAN_MAX_CHARS`）を
 * 超えた本文は、超えた先を「検査していない範囲」として丸ごと伏せる ── 読めていない
 * ところに何が入っているかは分からない（STEP3 と同じ倒し方）。
 */

export interface MaskedLines {
  /** 伏せた後の行（元の行数と同じ）。 */
  readonly lines: readonly string[]
  /** 1つでも伏せたか。 */
  readonly masked: boolean
}

/** 本文を行へ分け、Secret を伏せた形で返す。**例外を投げない。** */
export function maskSecretLines(text: string): MaskedLines {
  const lines = splitLines(text)

  if (lines.length === 0) {
    return Object.freeze({ lines, masked: false })
  }

  let spans: readonly Span[]

  try {
    spans = secretSpans(text)
  } catch {
    // 何が入っていたか分からない。全部伏せる。
    return Object.freeze({
      lines: Object.freeze(lines.map(() => SECRET_MASK)),
      masked: true
    })
  }

  if (spans.length === 0) {
    return Object.freeze({ lines, masked: false })
  }

  return Object.freeze({ lines: Object.freeze(applyToLines(lines, spans)), masked: true })
}

interface Span {
  readonly start: number
  readonly end: number
}

/**
 * 本文の中の、伏せる範囲。
 *
 * 重なったものは1つにまとめる（片方だけを採ると、採らなかった側のはみ出した部分が
 * 残る。secretMasking.ts と同じ判断）。
 */
function secretSpans(text: string): readonly Span[] {
  const overLimit = text.length > SECRET_SCAN_MAX_CHARS
  const scanned = overLimit ? text.slice(0, SECRET_SCAN_MAX_CHARS) : text
  const found = findSecretMatches(scanned)
    .filter(
      (match) =>
        Number.isInteger(match.start) &&
        Number.isInteger(match.end) &&
        match.start >= 0 &&
        match.end > match.start &&
        match.end <= scanned.length
    )
    .map((match) => ({ start: match.start, end: match.end }))
    .sort((left, right) => left.start - right.start || right.end - left.end)

  if (overLimit) {
    // 読んでいない先は、丸ごと「分からない範囲」にあたる。
    found.push({ start: SECRET_SCAN_MAX_CHARS, end: text.length })
  }

  const merged: { start: number; end: number }[] = []

  for (const span of found) {
    const last = merged[merged.length - 1]

    if (last !== undefined && span.start <= last.end) {
      last.end = Math.max(last.end, span.end)
      continue
    }

    merged.push({ start: span.start, end: span.end })
  }

  return merged.map((span) => Object.freeze(span))
}

/**
 * 範囲を行へ割り当てて伏せる。
 *
 * 行の位置は、分ける前の本文での開始位置から数える（分け方は splitLines と同じ
 * ため、`行の長さ + 1`（改行）を足していけば戻る）。
 */
function applyToLines(lines: readonly string[], spans: readonly Span[]): string[] {
  const masked: string[] = []
  let offset = 0
  let index = 0

  for (const line of lines) {
    const lineStart = offset
    const lineEnd = lineStart + line.length

    // この行より手前で終わった範囲は、もう使わない。
    while (index < spans.length && spans[index].end <= lineStart) {
      index += 1
    }

    masked.push(maskWithin(line, lineStart, lineEnd, spans, index))
    offset = lineEnd + 1
  }

  return masked
}

/** 1行の中で、重なった部分だけを伏せ字へ置き換える。 */
function maskWithin(
  line: string,
  lineStart: number,
  lineEnd: number,
  spans: readonly Span[],
  from: number
): string {
  let result = ''
  let cursor = 0

  for (let index = from; index < spans.length; index += 1) {
    const span = spans[index]

    if (span.start >= lineEnd) {
      break
    }

    const start = Math.max(span.start - lineStart, 0)
    const end = Math.min(span.end - lineStart, line.length)

    if (end <= cursor) {
      continue
    }

    result += line.slice(cursor, Math.max(start, cursor))
    result += SECRET_MASK
    cursor = end
  }

  return `${result}${line.slice(cursor)}`
}
