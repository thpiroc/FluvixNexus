/**
 * ログファイルへ書く1行を作る（Session 7-1C。Electron / fs 非依存・テスト対象）。
 *
 * 配布版のログは**利用者から受け取って読むもの**で、利用者の手を離れて誰かに渡る。
 * そこで、ファイルへ書く行だけは次のものを伏せる（console の出力は開発時に手元で見るもので、加工しない）。
 *
 * ```
 * 絶対パス（ドライブ / UNC / POSIX）・file URI   → <path>      ユーザー名のフォルダ・Workspace の場所を残さない
 * URL に埋め込まれた認証情報（user:token@host）  → <redacted>@
 * GitHub の token・Bearer / Basic の値           → <redacted>
 * token= / password= / secret= / api_key= の値   → <redacted>
 * details の object                              → [object]    spawn の options や環境変数の表を丸ごと書かない
 * ```
 *
 * **伏せすぎは許し、伏せ漏れは許さない**側へ倒す（main/debug/stopInfo.ts の redactDebugPaths と同じ方針）。
 * パスは引用符・行末までを1つとして読む ── 空白を含むフォルダ名（`C:\Users\Taro Yamada`）の後半を
 * 残さないためで、パスの後ろに続く語まで巻き込むことは受け入れる。
 *
 * 1行に畳み（制御文字 → 空白）、上限で切る。ログを読む側に、行の区切りを偽装した行を見せない。
 */

export const REDACTED_LOG_PATH = '<path>'
export const REDACTED_LOG_SECRET = '<redacted>'

/** ファイルへ書く1行の本文の上限（文字数）。 */
export const LOG_FILE_LINE_MAX_LENGTH = 4000

/** 伏せる前に読む上限。巨大な stderr を正規表現へ丸ごと渡さない（切った位置のパスの断片も伏せる）。 */
const RAW_TEXT_READ_LIMIT = 16_000

// パスの続き。引用符・`<>|`・行末で止め、末尾の空白は巻き込まない（details の ` | ` 区切りを残す）。
const PATH_TAIL = String.raw`(?:[^'"\x60<>|\r\n]*[^\s'"\x60<>|])?`
const FILE_URI_PATTERN = /\bfile:\/\/[^\s'"<>]*/gi
const WINDOWS_DRIVE_PATH_PATTERN = new RegExp(
  String.raw`(?<![A-Za-z0-9])[A-Za-z]:[\\/]${PATH_TAIL}`,
  'g'
)
const WINDOWS_UNC_PATH_PATTERN = new RegExp(String.raw`\\\\[^\\/\s'"<>|]+[\\/]${PATH_TAIL}`, 'g')
const POSIX_ABSOLUTE_PATH_PATTERN = new RegExp(
  String.raw`(?<=^|[\s'"(=:,[])\/(?:[^\s'"<>|/]+\/)+${PATH_TAIL}`,
  'g'
)

const URL_USERINFO_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"<>]+@/gi
const GITHUB_TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g
const AUTHORIZATION_SCHEME_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi
const SECRET_ASSIGNMENT_PATTERN =
  /\b((?:access[_-]?)?token|password|passwd|secret|api[_-]?key)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi

export type LogFileLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogFileLineInput {
  readonly time: Date
  readonly level: LogFileLevel
  readonly scope: string
  readonly message: string
  readonly details: readonly unknown[]
}

/** `2026-09-15T12:34:56.789Z INFO  [scope] message | detail`（1行。改行は含まない）。 */
export function formatLogFileLine(input: LogFileLineInput): string {
  const body = [input.message, ...input.details.map(describeLogDetail)].join(' | ')

  return `${input.time.toISOString()} ${input.level.toUpperCase().padEnd(5)} [${sanitizeLogText(input.scope)}] ${sanitizeLogText(body)}`
}

/**
 * details の1つを文字列にする。
 *
 * Error は名前・code・message だけ（stack は書かない ── アプリの置き場所のパスが並ぶだけで、
 * 伏せると行番号も読めなくなる）。object は中身を辿らない。
 */
export function describeLogDetail(detail: unknown): string {
  if (detail instanceof Error) {
    const code = (detail as { readonly code?: unknown }).code
    const codeText =
      typeof code === 'string' || typeof code === 'number' ? ` (${String(code)})` : ''

    return `${detail.name}${codeText}: ${detail.message}`
  }

  switch (typeof detail) {
    case 'string':
      return detail
    case 'number':
    case 'boolean':
    case 'bigint':
    case 'undefined':
      return String(detail)
    case 'symbol':
      return '[symbol]'
    case 'function':
      return '[function]'
    default:
      return detail === null ? 'null' : '[object]'
  }
}

/** 伏せて、1行に畳んで、上限で切る。 */
export function sanitizeLogText(raw: string): string {
  const text = raw.length <= RAW_TEXT_READ_LIMIT ? raw : raw.slice(0, RAW_TEXT_READ_LIMIT)
  const collapsed = redactLogText(text).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')

  return collapsed.length <= LOG_FILE_LINE_MAX_LENGTH
    ? collapsed
    : `${collapsed.slice(0, LOG_FILE_LINE_MAX_LENGTH)}…`
}

export function redactLogText(text: string): string {
  /*
    認証情報を先に伏せる。URL の userinfo はパスの規則に当たらないが、token が `=` の後ろに
    `/` を含む形（Basic の base64）で来ると POSIX のパスとして半端に伏せられるため。
    パスは file URI → ドライブ → UNC → POSIX の順（stopInfo.ts と同じ理由で、ドライブを UNC より先に）。
  */
  return text
    .replace(URL_USERINFO_PATTERN, `$1${REDACTED_LOG_SECRET}@`)
    .replace(GITHUB_TOKEN_PATTERN, REDACTED_LOG_SECRET)
    .replace(AUTHORIZATION_SCHEME_PATTERN, `$1 ${REDACTED_LOG_SECRET}`)
    .replace(SECRET_ASSIGNMENT_PATTERN, `$1$2${REDACTED_LOG_SECRET}`)
    .replace(FILE_URI_PATTERN, REDACTED_LOG_PATH)
    .replace(WINDOWS_DRIVE_PATH_PATTERN, REDACTED_LOG_PATH)
    .replace(WINDOWS_UNC_PATH_PATTERN, REDACTED_LOG_PATH)
    .replace(POSIX_ABSOLUTE_PATH_PATTERN, REDACTED_LOG_PATH)
}
