import { findSecretMatches, type SecretCategory, type SecretMatch } from './secretPatterns'

/**
 * 見つけた Secret を伏せて、伏せたことだけを返す（Security Core v1 の STEP3）。
 *
 * Electron にも fs にも依存しない。**Main 側の共通の道具**として作ってあり、後の STEP の
 * Audit Log・Activity・Provider への要求・Diagnostics・Error は同じここを通す
 * （Renderer 専用の伏せ字を別に持つと、片方だけ直した状態が生まれる）。
 *
 * ## 元の値は復元できない形にする
 *
 * 見つけた範囲は、長さも形も残さず `***REDACTED***` の1つに置き換える。
 * **先頭数文字を残す・末尾4桁を残す、といった作りにはしない。** 「デバッグで困るから」は
 * 理由にならない ── 残した断片から総当たりの範囲が縮み、Provider へ渡る経路にも
 * 同じ断片が乗るため。
 *
 * ## metadata に値は入れない
 *
 * 返すのは「あったか・いくつか・どの種類か・利用者へ知らせるべきか」まで。
 * 当たった生の値を持つ欄は作らない（型にも無い）。
 *
 * ## 普通のファイルは拒まない
 *
 * 中身に Secret があっても、ファイルごと拒否はしない ── 伏せた本文を返し、
 * `userNoticeRequired` で「一部を伏せた」ことを伝えられるようにする（通知の UI は後の STEP）。
 * ファイルごと拒むのは、名前から Secret ファイルと分かったときだけ（secretPaths.ts）。
 *
 * ## 失敗しても平文は返さない
 *
 * 文字列でない・検出が例外で落ちた・上限を超えた、のどれでも**未検査の文字は返さない。**
 * 検出が落ちたときは全体を伏せ、上限を超えたときは超えた分を捨てる。
 */

/** 伏せ字。長さも形も元の値と関係しない。 */
export const SECRET_MASK = '***REDACTED***'

/**
 * 1回の検査で読む文字数の上限（STEP3 で足した上限）。
 *
 * ファイルを読む側の上限（`FILES_FILE_MAX_BYTES` = 2 MiB）とバイナリの判定は
 * secretScan.ts が既存の Files のものをそのまま使う。こちらは、ファイルに限らない
 * 文字列（CLI の出力・Provider への要求・Error）が来たときに、正規表現へ
 * 無制限に渡さないための上限にあたる。
 */
export const SECRET_SCAN_MAX_CHARS = 1_000_000

/**
 * 伏せた結果。**Secret の値そのものは、どの欄にも入らない。**
 */
export interface SecretMaskResult {
  /** 伏せた後の本文。 */
  readonly text: string
  /** 1つでも伏せたか。 */
  readonly secretsFound: boolean
  /** 伏せた箇所の数（重なったものは1つに数える）。 */
  readonly maskedCount: number
  /** 伏せたものの種別（重複なし・名前順）。 */
  readonly categories: readonly SecretCategory[]
  /** 利用者へ「一部を伏せた」と知らせるべきか。 */
  readonly userNoticeRequired: boolean
  /** 上限を超えて、後ろを捨てたか。 */
  readonly truncated: boolean
}

/**
 * 文字列1つを伏せる。
 *
 * 改行はそのまま残る（伏せるのは見つけた範囲だけで、行の形は変えない）。
 * Private Key block だけは、複数行がまとめて1つの伏せ字になる。
 */
export function maskSecretText(input: unknown): SecretMaskResult {
  if (typeof input !== 'string') {
    // 文字列でないものは、中身が分からない。渡せるものは何も無い。
    return result('', true, 0, ['unscanned'], false)
  }

  const overLimit = input.length > SECRET_SCAN_MAX_CHARS
  const scanned = overLimit ? sliceWholeCharacters(input, SECRET_SCAN_MAX_CHARS) : input

  let matches: readonly SecretMatch[]

  try {
    matches = findSecretMatches(scanned)
  } catch {
    // 検出が落ちた。何が入っていたか分からない以上、全体を伏せる。
    return result(SECRET_MASK, true, 1, ['unscanned'], overLimit)
  }

  const spans = mergeMatches(matches, scanned.length)
  const masked = applyMask(scanned, spans)
  const categories = new Set<SecretCategory>()

  for (const span of spans) {
    for (const category of span.categories) {
      categories.add(category)
    }
  }

  if (overLimit) {
    categories.add('unscanned')
  }

  return result(
    overLimit ? `${masked}${SECRET_MASK}` : masked,
    spans.length > 0,
    spans.length,
    [...categories],
    overLimit
  )
}

/**
 * 伏せた本文だけが欲しいとき。
 *
 * 文字列でないものには伏せ字を返す（空文字にすると、呼び出し側で
 * 「何も無かった」と見分けられなくなる）。
 */
export function redactSecretText(input: unknown): string {
  if (typeof input !== 'string') {
    return SECRET_MASK
  }

  return maskSecretText(input).text
}

/**
 * Error を、Secret を含まない1行の説明にする。
 *
 * Error の message には、失敗した要求の URL・環境変数・コマンドの引数がそのまま
 * 入ってくることがある。Audit Log・Activity・Diagnostics へ出す前にここを通す。
 * stack は使わない（main/logger/logRedaction.ts と同じ理由）。
 */
export function describeErrorWithoutSecrets(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { readonly code?: unknown }).code
    const codeText =
      typeof code === 'string' || typeof code === 'number' ? ` (${String(code)})` : ''

    return redactSecretText(`${error.name}${codeText}: ${error.message}`)
  }

  if (typeof error === 'string') {
    return redactSecretText(error)
  }

  // 形の分からないものは中身を辿らない（describeLogDetail と同じ）。
  return error === null || error === undefined ? String(error) : '[object]'
}

interface SecretSpan {
  readonly start: number
  readonly end: number
  readonly categories: readonly SecretCategory[]
}

/**
 * 重なった範囲を1つにまとめる。
 *
 * 重なったものを「片方だけ採る」形にすると、採らなかった側のはみ出した部分が
 * 伏せられずに残る。まとめる側へ倒す。
 */
function mergeMatches(matches: readonly SecretMatch[], length: number): readonly SecretSpan[] {
  const valid = matches
    .filter(
      (match) =>
        Number.isInteger(match.start) &&
        Number.isInteger(match.end) &&
        match.start >= 0 &&
        match.end > match.start &&
        match.end <= length
    )
    .sort((left, right) => left.start - right.start || right.end - left.end)

  const spans: { start: number; end: number; categories: SecretCategory[] }[] = []

  for (const match of valid) {
    const last = spans[spans.length - 1]

    if (last !== undefined && match.start < last.end) {
      last.end = Math.max(last.end, match.end)

      if (!last.categories.includes(match.category)) {
        last.categories.push(match.category)
      }

      continue
    }

    spans.push({ start: match.start, end: match.end, categories: [match.category] })
  }

  return spans.map((span) =>
    Object.freeze({ start: span.start, end: span.end, categories: Object.freeze(span.categories) })
  )
}

function applyMask(text: string, spans: readonly SecretSpan[]): string {
  if (spans.length === 0) {
    return text
  }

  const parts: string[] = []
  let cursor = 0

  for (const span of spans) {
    parts.push(text.slice(cursor, span.start), SECRET_MASK)
    cursor = span.end
  }

  parts.push(text.slice(cursor))

  return parts.join('')
}

/** サロゲートペアを割らずに切る。 */
function sliceWholeCharacters(text: string, limit: number): string {
  const code = text.charCodeAt(limit - 1)
  const splitsPair = code >= 0xd800 && code <= 0xdbff

  return text.slice(0, splitsPair ? limit - 1 : limit)
}

function result(
  text: string,
  secretsFound: boolean,
  maskedCount: number,
  categories: readonly SecretCategory[],
  truncated: boolean
): SecretMaskResult {
  return Object.freeze({
    text,
    secretsFound,
    maskedCount,
    categories: Object.freeze([...categories].sort()),
    userNoticeRequired: secretsFound || truncated,
    truncated
  })
}
