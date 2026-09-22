/**
 * 文字列の中から Secret らしい**位置**を見つける（Security Core v1 の STEP3）。
 *
 * ここが返すのは位置と種別だけで、**値そのものは返さない。** 値を返り値へ入れた時点で、
 * Mask した結果の隣に平文が並ぶ構造になる（secretMasking.ts がその位置を伏せる）。
 *
 * ## 過検出を避ける
 *
 * 「`token` という語がある」だけでは Secret にしない。形の決まっているもの
 * （GitHub の token・JWT・Private Key block・Provider の API Key・URL の認証情報）は
 * **形で**、そうでないものは **鍵の名前 ＋ 代入 ＋ 値の見た目**の3つが揃ったときだけ拾う。
 *
 * 値の見た目（isPlausibleSecretValue）で落とすもの：
 *
 * ```
 * 短すぎる            "hunter2"（8 文字未満）
 * 雛形の値            "changeme" / "your-api-key-here" / "xxxxxxxx" / "<token>"
 * 参照・展開          "${API_KEY}" / "$TOKEN" / "%TOKEN%"
 * コードの式          "process.env.API_KEY" / "getToken()" / "SECRET_KEY"
 * 型・語              "string" / "boolean"（短さで落ちる）
 * 空白を含むもの      散文の一部を伏せない
 * 単調な文字          16 文字未満で1種類の文字しか無いもの
 * ```
 *
 * ## 伏せ漏れより伏せすぎ
 *
 * 迷ったら Mask する側へ倒す（main/logger/logRedaction.ts と同じ方針）。ただし
 * **散文まで伏せると読めなくなる**ため、上の落とし方だけは残す。
 */

/** 見つけたものの種別。metadata として外へ出す（値は含めない）。 */
export type SecretCategory =
  | 'private-key'
  | 'github-token'
  | 'provider-api-key'
  | 'jwt'
  | 'authorization-value'
  | 'url-credential'
  | 'key-value'
  /** 検査しきれなかった範囲（大きすぎる・検出が失敗した）。secretMasking.ts が付ける。 */
  | 'unscanned'

/** 知っている種別（surface テストと metadata の検証に使う）。 */
export const SECRET_CATEGORIES: readonly SecretCategory[] = Object.freeze([
  'authorization-value',
  'github-token',
  'jwt',
  'key-value',
  'private-key',
  'provider-api-key',
  'unscanned',
  'url-credential'
])

/** 見つけた範囲（`[start, end)`。値は持たない）。 */
export interface SecretMatch {
  readonly start: number
  readonly end: number
  readonly category: SecretCategory
}

/** 鍵の名前 ＋ 代入 の後ろにある値が、Secret としてありえる長さ。 */
const VALUE_MIN_LENGTH = 8
const VALUE_MAX_LENGTH = 4096

/** 1種類の文字しか無くても Secret として扱う長さ。 */
const MONOTONE_VALUE_MIN_LENGTH = 16

/*
  Private Key block。BEGIN から**対応する** END まで（印も含めて）1つとして扱う。
  `RSA` / `OPENSSH` / `EC` / `ENCRYPTED` / `PGP ... BLOCK` のどれも同じ形で通る。
*/
const PRIVATE_KEY_LABEL = String.raw`[A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?`
const PRIVATE_KEY_BLOCK = new RegExp(
  String.raw`-----BEGIN ${PRIVATE_KEY_LABEL}-----[\s\S]*?-----END ${PRIVATE_KEY_LABEL}-----`,
  'g'
)
const PRIVATE_KEY_BEGIN = new RegExp(String.raw`-----BEGIN ${PRIVATE_KEY_LABEL}-----`, 'g')

const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})/g

/*
  発行元が接頭辞で分かるもの。当たれば確実に Secret で、文脈を見る必要が無い。
  `sk-`（OpenAI 系）・`sk-ant-`（Anthropic）・`AKIA` / `ASIA`（AWS）・`AIza`（Google）・
  `xox?-`（Slack）・`glpat-`（GitLab）・`npm_`（npm）。
*/
const PROVIDER_API_KEY =
  /\b(?:sk-ant-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{35}|xox[abprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{30,})/g

/** JWT。`eyJ`（`{"` の base64）で始まる3つの部分が揃っているものだけ。 */
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g

/** `Authorization: Bearer …`。印（scheme）は残し、値だけを伏せる。 */
const AUTHORIZATION_VALUE = /\b(?:Bearer|Basic|Token)\s+([A-Za-z0-9._~+/=-]{12,})/gi

/** URL に埋め込まれた認証情報。利用者名と合わせて丸ごと伏せる（token が前にも後ろにも来る）。 */
const URL_CREDENTIAL = /\b[a-z][a-z0-9+.-]*:\/\/([^\s/@:'"<>]+:[^\s/@'"<>]*)@/gi

/*
  鍵の名前 ＋ 代入 ＋ 値。`"apiKey": "…"`（JSON）・`API_KEY=…`（.env）・`apiKey: '…'`（コード）を1つの形で読む。
  長い名前を先に並べる（`secret_key` を `secret` として途中まで読まない）。
*/
const KEY_VALUE_ASSIGNMENT =
  /(?<![A-Za-z0-9])(api[_-]?key|apikey|secret[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|_authtoken|private[_-]?key|passphrase|password|passwd|pwd|credentials|credential|secret|token)\b(["'`]?\s*[:=]\s*)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|`([^`\r\n]*)`|([^\s,;'"`\r\n]+))/gi

/** 雛形として書かれた値。 */
const PLACEHOLDER_VALUE =
  /^(?:x+|\*+|\.+|-+|_+|0+|n\/a|na|none|null|nil|undefined|true|false|changeme|change[_-]?me|placeholder|dummy|example|sample|test|todo|tbd|secret|password|passwd|pwd|token|apikey|api[_-]?key|redacted|your.*|my.*|some.*|insert.*|replace.*|fake.*|<.*>)$/i

/** 展開される参照（`${API_KEY}` / `$TOKEN` / `%TOKEN%` / `{{token}}`）。 */
const VALUE_REFERENCE = /\$\{|\{\{|\$\(|%\(|^\$[A-Za-z_]|^%[A-Za-z_][A-Za-z0-9_]*%$/

/** コードの式（`process.env.API_KEY` / `SECRET_KEY` / `getToken()`）。 */
const VALUE_MEMBER_PATH = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/
const VALUE_CONSTANT_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/
const VALUE_CALL = /^[A-Za-z_$][A-Za-z0-9_$.]*\(.*\)$/

/**
 * 文字列の中の Secret の位置を返す。
 *
 * 重なりは整理しない（secretMasking.ts がまとめて1つの範囲にする）。
 */
export function findSecretMatches(text: string): readonly SecretMatch[] {
  const matches: SecretMatch[] = []

  collectPrivateKeyBlocks(text, matches)
  collectWhole(text, GITHUB_TOKEN, 'github-token', matches)
  collectWhole(text, PROVIDER_API_KEY, 'provider-api-key', matches)
  collectWhole(text, JWT, 'jwt', matches)
  collectFirstGroup(text, AUTHORIZATION_VALUE, 'authorization-value', matches)
  collectFirstGroup(text, URL_CREDENTIAL, 'url-credential', matches)
  collectKeyValues(text, matches)

  return matches
}

/**
 * Private Key block。
 *
 * END が見つからない BEGIN は、**そこから末尾まで**を Secret として扱う。block の途中で
 * 切れた文字列（読み込みの上限で切った・ログが途切れた）でも、鍵の本体を1行も残さない。
 */
function collectPrivateKeyBlocks(text: string, matches: SecretMatch[]): void {
  const closed: SecretMatch[] = []

  for (const match of text.matchAll(PRIVATE_KEY_BLOCK)) {
    closed.push({ start: match.index, end: match.index + match[0].length, category: 'private-key' })
  }

  matches.push(...closed)

  for (const begin of text.matchAll(PRIVATE_KEY_BEGIN)) {
    const inClosedBlock = closed.some(
      (block) => begin.index >= block.start && begin.index < block.end
    )

    if (!inClosedBlock) {
      matches.push({ start: begin.index, end: text.length, category: 'private-key' })
    }
  }
}

function collectWhole(
  text: string,
  pattern: RegExp,
  category: SecretCategory,
  matches: SecretMatch[]
): void {
  for (const match of text.matchAll(pattern)) {
    matches.push({ start: match.index, end: match.index + match[0].length, category })
  }
}

/** 印（`Bearer` / `https://`）は残し、最初の捕獲群だけを伏せる。 */
function collectFirstGroup(
  text: string,
  pattern: RegExp,
  category: SecretCategory,
  matches: SecretMatch[]
): void {
  for (const match of text.matchAll(pattern)) {
    const value = match[1]

    if (value === undefined || value.length === 0) {
      continue
    }

    const start = match.index + match[0].lastIndexOf(value)

    matches.push({ start, end: start + value.length, category })
  }
}

function collectKeyValues(text: string, matches: SecretMatch[]): void {
  for (const match of text.matchAll(KEY_VALUE_ASSIGNMENT)) {
    const key = match[1] ?? ''
    const separator = match[2] ?? ''
    const quoted = match[3] ?? match[4] ?? match[5]
    const value = quoted ?? match[6] ?? ''

    if (!isPlausibleSecretValue(value)) {
      continue
    }

    // 引用符は残す（伏せたことは分かってよいが、引用の形は壊さない）。
    const start = match.index + key.length + separator.length + (quoted === undefined ? 0 : 1)

    matches.push({ start, end: start + value.length, category: 'key-value' })
  }
}

/** 鍵の名前の後ろにある値が、Secret としてありえるか。 */
function isPlausibleSecretValue(value: string): boolean {
  if (value.length < VALUE_MIN_LENGTH || value.length > VALUE_MAX_LENGTH) {
    return false
  }

  if (/\s/.test(value)) {
    return false
  }

  if (PLACEHOLDER_VALUE.test(value)) {
    return false
  }

  if (VALUE_REFERENCE.test(value)) {
    return false
  }

  if (VALUE_MEMBER_PATH.test(value) || VALUE_CONSTANT_NAME.test(value) || VALUE_CALL.test(value)) {
    return false
  }

  return characterClassCount(value) >= 2 || value.length >= MONOTONE_VALUE_MIN_LENGTH
}

/** 小文字・大文字・数字・それ以外のうち、いくつの種類が混じっているか。 */
function characterClassCount(value: string): number {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/]

  return classes.filter((pattern) => pattern.test(value)).length
}
