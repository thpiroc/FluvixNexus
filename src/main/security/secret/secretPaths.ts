/**
 * Secret ファイルかどうかを**名前だけ**で決める（Security Core v1 の STEP3）。
 *
 * 中身は見ない。中身から Secret を見つけるのは secretPatterns.ts の仕事で、
 * この2つは**必ず分けておく** ── `.env.example` は Secret ファイルではない（読んでよい）
 * が、うっかり本物の値が書かれていれば、その値は Mask される。名前で許した瞬間に
 * 中身も素通しになる作りにはしない（DESIGN.md §6.4）。
 *
 * ```
 * secret-file    Agent は読まない・書かない（decideSecurityAction が deny）
 * template-file  読んでよい雛形（中身は必ず Mask を通す）
 * ordinary-file  普通のファイル（中身は必ず Mask を通す）
 * ```
 *
 * ## 判定できないものは Secret 側
 *
 * 文字列でない・空・NUL を含む、はすべて `secret-file` にする。名前が読めないものを
 * 「たぶん普通のファイル」に倒すと、判定の失敗がそのまま読み取りの許可になる。
 *
 * ## 雛形の印（`.example` / `.sample` / `.template`）
 *
 * 利用者から求められた最低限に留める。`.dist` / `.defaults` / `.tpl` なども実在するが、
 * **印を増やすことは Secret ファイルを普通のファイルへ落とす方向**にしか働かないため、
 * 必要になった時点で1つずつ足す（この module と secretPaths.test.ts の両方を書き換える）。
 *
 * 印が効くのは `.env` 系と `credential` / `secret` を名前に持つものだけで、
 * **鍵そのもの（`.pem`・`.key`・`id_rsa`・`.ssh/`）には効かない。** 鍵の雛形という
 * ものはまず無く、`example.pem` の中身が本物であることの方がありそうなため。
 *
 * ## 普通のソースコードを、名前だけで Secret ファイルにしない（2026-09-23 決定）
 *
 * `credential` / `secret` / `private key` という語は、**資格情報のファイルとして妥当な
 * 形式**（`.json`・`.yaml`・`.ini` …、または拡張子が無いもの）に付いているときだけ
 * Secret ファイルの理由にする。
 *
 * ```
 * credentials.json / secrets.yaml / aws-credentials / .git-credentials  → secret-file
 * src/auth/credentials.ts / src/security/secret.ts / secrets.test.ts    → ordinary-file
 * ```
 *
 * ソースコードを名前だけで拒むと、Agent が読めない普通のファイルが増える一方で、
 * **中身の Secret は1つも減らない。** ソースコードの中に本物の値が書かれている場合は、
 * ファイルごと拒むのではなく Content Detection が値だけを Mask する（secretPatterns.ts）。
 */

/** 名前から見た種別。 */
export type SecretPathVerdict = 'secret-file' | 'template-file' | 'ordinary-file'

/** 雛形の印。前（`example.env`）にも後ろ（`.env.example`）にも付く形を見る。 */
const TEMPLATE_MARKERS: readonly string[] = Object.freeze(['example', 'sample', 'template'])

/** 雛形の印の後ろに付いてよい、形式だけを表す拡張子（`credentials.example.json`）。 */
const TEMPLATE_TAIL_EXTENSIONS: ReadonlySet<string> = new Set([
  'json',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'cfg',
  'properties',
  'xml',
  'txt',
  'md'
])

/**
 * この名前のフォルダの中は、すべて Secret として扱う。
 *
 * 鍵の置き場そのもの。中に何が入っていても Agent には渡さない。
 */
const SECRET_DIRECTORIES: ReadonlySet<string> = new Set(['.ssh', '.gnupg'])

/** `credential` / `secret` を区切り文字で挟んだ語として持つ名前（`client_secret.json` など）。 */
const SECRET_NAME_TOKENS: ReadonlySet<string> = new Set([
  'credential',
  'credentials',
  'secret',
  'secrets'
])

/**
 * 資格情報のファイルとして妥当な形式。
 *
 * `credential` / `secret` / `private key` という語は、**この形式か、拡張子が無いとき**
 * だけ Secret ファイルの理由になる。ここにソースコードの拡張子（`.ts`・`.js`・`.py` …）は
 * 入れない ── 入れた瞬間に `src/auth/credentials.ts` が読めなくなる。
 */
const CREDENTIAL_DATA_EXTENSIONS: ReadonlySet<string> = new Set([
  'json',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'cfg',
  'properties',
  'xml',
  'csv',
  'plist',
  'txt',
  'env'
])

/** そのままの名前で Secret にあたるもの。 */
const SECRET_FILE_NAMES: ReadonlySet<string> = new Set([
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ecdsa_sk',
  'id_ed25519',
  'id_ed25519_sk',
  '.netrc',
  '_netrc',
  '.pgpass',
  '.htpasswd',
  '.pypirc'
])

/** 鍵・資格情報の入れ物にあたる拡張子。`.pub`（公開鍵）は入れない。 */
const SECRET_EXTENSIONS: ReadonlySet<string> = new Set([
  'pem',
  'key',
  'p12',
  'pfx',
  'pkcs12',
  'jks',
  'keystore',
  'ppk'
])

/**
 * `private_key` / `private-key` / `privatekey`。
 *
 * これ自体は理由にならない（`src/crypto/privateKey.ts` は普通のソースコード）。
 * 資格情報の形式と組んだときだけ Secret ファイルにする（isCredentialDataName）。
 */
const PRIVATE_KEY_NAME = /private[^a-z0-9]?key/

/**
 * 相対パス1件を、名前だけで分類する。
 *
 * `relativePath` は Workspace root からの相対位置（`/` 区切り）を想定するが、`\` でも
 * 同じように読む。大文字小文字は区別しない（Windows でも Linux でも同じ結論を出す
 * ため ── `.ENV` を読めるプラットフォームがあってはならない）。
 */
export function classifySecretPath(relativePath: unknown): SecretPathVerdict {
  if (typeof relativePath !== 'string' || relativePath.includes('\0')) {
    return 'secret-file'
  }

  const segments = relativePath.split(/[/\\]/).filter((segment) => segment.trim().length > 0)

  if (segments.length === 0) {
    // 空（Workspace root 自身）はファイルではない。ここへ来ること自体が想定外。
    return 'secret-file'
  }

  const lowered = segments.map((segment) => segment.toLowerCase())

  if (lowered.some((segment) => SECRET_DIRECTORIES.has(segment))) {
    return 'secret-file'
  }

  const name = lowered[lowered.length - 1]

  // 鍵そのものは、雛形の印があっても Secret のまま。
  if (isKeyMaterialName(name)) {
    return 'secret-file'
  }

  if (isEnvFamilyName(name) || isCredentialDataName(name)) {
    return hasTemplateMarker(name) ? 'template-file' : 'secret-file'
  }

  return hasTemplateMarker(name) ? 'template-file' : 'ordinary-file'
}

/**
 * 資格情報のファイルとして妥当な名前か。
 *
 * `credential` / `secret` / `private key` という語**と**、資格情報の形式（または
 * 拡張子が無いこと）の両方が揃ったときだけ真。片方だけでは、普通のソースコードを
 * 名前で拒むことになる。
 */
function isCredentialDataName(name: string): boolean {
  if (!hasSecretToken(name) && !PRIVATE_KEY_NAME.test(name)) {
    return false
  }

  const lastDot = name.lastIndexOf('.')

  // 拡張子が無い（`credentials`）・先頭のドットだけ（`.git-credentials`）も資格情報の形。
  return lastDot <= 0 || CREDENTIAL_DATA_EXTENSIONS.has(name.slice(lastDot + 1))
}

function isKeyMaterialName(name: string): boolean {
  // 公開鍵は鍵材料ではない（`id_rsa.pub` は配って構わないもの）。
  if (name.endsWith('.pub')) {
    return false
  }

  if (SECRET_FILE_NAMES.has(name) || SECRET_FILE_NAMES.has(stemOf(name))) {
    return true
  }

  const lastDot = name.lastIndexOf('.')

  // 先頭のドットは「隠しファイル」の印で、拡張子ではない（`.key` は拡張子を持たない）。
  return lastDot > 0 && SECRET_EXTENSIONS.has(name.slice(lastDot + 1))
}

/** 最初の拡張子を落とした名前（`id_rsa.sample` → `id_rsa`。先頭のドットは残す）。 */
function stemOf(name: string): string {
  const firstDot = name.indexOf('.', 1)

  return firstDot < 0 ? name : name.slice(0, firstDot)
}

/** `.env` / `.env.local` / `production.env`。 */
function isEnvFamilyName(name: string): boolean {
  return name === '.env' || name.startsWith('.env.') || name.endsWith('.env')
}

/** 区切り文字で切った語に `credential` / `secret` があるか（`secretsmanager.ts` は当たらない）。 */
function hasSecretToken(name: string): boolean {
  return name.split(/[^a-z0-9]+/).some((token) => token.length > 0 && SECRET_NAME_TOKENS.has(token))
}

/**
 * 雛形の印が付いているか。
 *
 * 印は**名前の端**にあるものだけを読む（`credentials.example.json` のように後ろへ
 * 形式の拡張子が付く形だけ、間に挟まっていても読む）。`.env.example.local` のように
 * 印の後ろに別の名前が続くものは、**雛形を写して本物にしたもの**でありうるため
 * 雛形として扱わない。
 */
function hasTemplateMarker(name: string): boolean {
  const lastDot = name.lastIndexOf('.')
  const tailIsFormat = lastDot > 0 && TEMPLATE_TAIL_EXTENSIONS.has(name.slice(lastDot + 1))

  return TEMPLATE_MARKERS.some(
    (marker) =>
      name.startsWith(`${marker}.`) ||
      name.endsWith(`.${marker}`) ||
      (tailIsFormat && name.slice(0, lastDot).endsWith(`.${marker}`))
  )
}
