/**
 * MCP サーバーへ渡す環境変数を組み立てる（MCP 共通。Electron / fs 非依存・テスト対象）。
 *
 * ## 許可したものだけを渡す
 *
 * MCP サーバーは第三者が書いたプログラムで、ネットワークにつながり、秘密情報を扱う。
 * 親（このアプリ）の環境をそのまま渡すと、利用者が別の用途で設定した秘密情報
 * （`GITHUB_TOKEN`・AI サービスの API キー・クラウドの認証情報など）まで、
 * そのサーバーが読めるようになる。
 *
 * そこで「落とすものを挙げる」のではなく**「渡してよいものを挙げる」**形にしてある。
 * 挙げていない変数は、名前が何であれ渡らない ── 新しい秘密情報の変数が増えても、
 * 一覧を直し忘れて漏れることが無い。
 *
 * ```
 * 共通の許可（MCP_SERVER_BASE_VARIABLES） … OS とプロセスが動くのに要るもの・
 *                                              ネットワークの経路（プロキシ・証明書）
 * サーバーごとの許可（inheritedVariables）  … 定義が明示したものだけ（登録したサーバーは無し）
 * サーバーの設定（providedVariables）       … 利用者が登録した環境変数の値（秘密の値を含む）
 * ```
 *
 * ## それでも通さないもの
 *
 * - このアプリ自身の設定（`FLUVIX_` で始まるもの） … サーバーごとの許可に書いても通さない
 * - サーバーが設定として読む変数（reservedVariables） … 親の値は通さず、登録した値だけにする。
 *   `BASE_URL`（API の接続先の上書き）のように、ありふれた名前が設定として
 *   読まれることがある
 *
 * 比べるときは大文字に揃える ── Windows の環境変数は大文字小文字を区別しない。
 */

/**
 * どのサーバーにも渡す変数。値は利用者の PC のものをそのまま渡す。
 *
 * プロキシの変数は資格情報を含みうる（`http://user:pass@proxy`）が、渡さないと
 * 社内ネットワークなどでサーバーが外へ出られない。利用者がネットワークの経路として
 * 設定したものなので、通す側に倒す。
 */
export const MCP_SERVER_BASE_VARIABLES: readonly string[] = [
  // Windows: OS とプロセスの基本
  'SYSTEMROOT',
  'WINDIR',
  'SYSTEMDRIVE',
  'COMSPEC',
  'PATHEXT',
  'OS',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
  // Windows: 利用者のフォルダ（Node の os.homedir() / os.tmpdir() が読む）
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'COMMONPROGRAMW6432',
  // どの OS でも
  'PATH',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  // ネットワークの経路（プロキシ・証明書）
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR'
]

/** このアプリ自身の設定の接頭辞（利用者が置いた資格情報を含みうる）。どのサーバーにも渡さない。 */
const APP_VARIABLE_PREFIX = 'FLUVIX_'

/** サーバー1つ分の、環境変数についての宣言。 */
export interface McpServerEnvironmentProfile {
  /**
   * サーバーが設定として読む変数。親の環境に同じ名前があっても引き継がない。
   */
  readonly reservedVariables: readonly string[]
  /**
   * 定義が渡す値。名前は `reservedVariables` に含まれていなければならない
   * ── 宣言していない名前を書けると、親の値との取り違えを守れなくなる。
   */
  readonly providedVariables: Readonly<Record<string, string>>
  /**
   * 共通の許可に加えて、親から引き継ぐ変数（そのサーバーが動くのに要るもの）。
   * `FLUVIX_` で始まるもの・`reservedVariables` にあるものは書けない。
   */
  readonly inheritedVariables?: readonly string[]
}

export function createMcpServerEnvironment(
  parentEnv: Readonly<Record<string, string | undefined>>,
  profile: McpServerEnvironmentProfile
): Record<string, string> {
  const upper = (names: readonly string[]): Set<string> =>
    new Set(names.map((name) => name.toUpperCase()))

  const reserved = upper(profile.reservedVariables)
  const inherited = upper(profile.inheritedVariables ?? [])

  // ここで投げるのは表の書き間違い（利用者の操作では起きない）。値は文に含めない。
  for (const name of Object.keys(profile.providedVariables)) {
    if (!reserved.has(name.toUpperCase())) {
      throw new Error(`MCP server variable "${name}" is provided without being reserved.`)
    }
  }

  for (const name of inherited) {
    if (name.startsWith(APP_VARIABLE_PREFIX) || reserved.has(name)) {
      throw new Error(`MCP server variable "${name}" cannot be inherited from the app.`)
    }
  }

  const allowed = new Set([...upper(MCP_SERVER_BASE_VARIABLES), ...inherited])
  const env: Record<string, string> = {}

  for (const [name, value] of Object.entries(parentEnv)) {
    const key = name.toUpperCase()

    if (
      typeof value !== 'string' ||
      !allowed.has(key) ||
      reserved.has(key) ||
      key.startsWith(APP_VARIABLE_PREFIX)
    ) {
      continue
    }

    env[name] = value
  }

  return { ...env, ...profile.providedVariables }
}
