import { isAbsolute, relative, resolve } from 'path'
import { isWindows } from '../platform'
import {
  isInsideWorkspace,
  normalizeWorkspaceRelativePath,
  resolveWorkspacePath
} from '../files/workspacePath'

/**
 * 相対位置と、Language Server へ渡す URI の対応（fs / child_process 非依存・テスト対象）。
 *
 * ## ここが「Renderer は relativePath しか扱わない」の実体
 *
 * LSP は文書を **URI** で指す（`textDocument.uri`）。`file:` の URI は
 * 絶対パスそのものであり、Renderer には絶対パスが無い（ARCHITECTURE.md §9.2）。
 * したがって変換はどうしても Main で起きる ── その1箇所をここに閉じる。
 *
 * ```
 * Renderer   … "src/app.ts"                       （相対位置だけ）
 *    ↓ IPC
 * ここ       … D:\proj + "src/app.ts" → file:///D%3A/proj/src/app.ts
 *    ↓
 * Language Server
 * ```
 *
 * ## 外へ出る相対位置は、URI にならない
 *
 * 検証は Files ドメインと**同じ関数**を通す（main/files/workspacePath.ts）。
 * 別の検証を書き起こさないのは、片方だけに穴が空く形を作らないため
 * ── `..`・絶対パス・ドライブ相対を弾く規則は1つでよい。
 *
 * 通らなかった場合は null を返し、呼び出し側が要求ごと断る
 * （main/ipc/handlers/lsp.ts の PERMISSION_DENIED）。**黙って
 * Workspace 内に読み替えることはしない** ── 読み替えは、弾いたつもりが
 * 別の場所を指していたという一番危ない結末になる。
 *
 * ## symlink の先までは見ない
 *
 * `resolveWorkspacePath` は文字列としての判断で、realpath は取らない
 * （fs に触れないため）。Workspace の中に置かれた symlink が外を指していれば、
 * URI は Workspace の中を指したまま、実体は外にある。
 *
 * それでもここで realpath を取らないのは、**この境界が守っているものが
 * 「Renderer から任意の場所を指せないこと」**だからにほかならない。
 * Language Server は Workspace を丸ごと自分で読む（`rootUri` を渡している）ので、
 * 中身が読まれること自体はこの URI の有無と関係が無い。
 * ファイルを実際に開く経路（Files ドメイン）は、今までどおり realpath を取る。
 *
 * ## パーセント符号化は掛ける
 *
 * URI として組み立てる以上、`#` や `?` を含む名前をそのまま置くと
 * 区切りとして読まれる。要素ごとに `encodeURIComponent` を通すため、
 * ドライブレターの `:` も `%3A` になる ── これは VS Code
 * （`URI.file('d:/a').toString()` → `file:///d%3A/a`）と同じ形で、
 * 各サーバの URI 実装が受け取り慣れている表記にあたる。
 */

/** Windows のパス区切りを URI の区切りへ揃える。 */
function toSlashes(absolutePath: string): string {
  return absolutePath.replace(/\\/g, '/')
}

/** 要素ごとに符号化する（区切りの `/` は残す）。 */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/**
 * 絶対パスを `file:` URI にする。
 *
 * UNC（`\\server\share\...`）は authority を持つ形（`file://server/share/...`）に
 * なる。Workspace はネットワーク上のフォルダでもありうるため、
 * ここで分けておかないと `file:////server/...` という誰も読めない形になる。
 */
export function toFileUri(absolutePath: string): string {
  const path = toSlashes(absolutePath)

  if (path.startsWith('//')) {
    const rest = path.slice(2)
    const separator = rest.indexOf('/')
    const authority = separator < 0 ? rest : rest.slice(0, separator)
    const remainder = separator < 0 ? '/' : rest.slice(separator)

    return `file://${encodeURIComponent(authority)}${encodePath(remainder)}`
  }

  // ドライブ letter から始まる形（`D:/proj`）には、URI の先頭の `/` を足す。
  return `file://${encodePath(path.startsWith('/') ? path : `/${path}`)}`
}

/**
 * Workspace root の URI（`initialize` の `rootUri` と `workspaceFolders`）。
 *
 * サーバはこれを見て**どこまでを1つのプロジェクトとして解析するか**を決める。
 * 起動時に1度だけ決まり、後から動かせない ── だから Workspace が切り替われば
 * サーバを終わらせる（main/lsp/languageServers.ts）。
 */
export function toWorkspaceRootUri(rootPath: string): string {
  return toFileUri(rootPath)
}

/**
 * Workspace の中の相対位置を、文書の URI にする。
 *
 * 相対位置として扱えない・Workspace の外を指す場合は null。
 * 渡すのは境界の外から届いたそのままの値でよい（正規化もここが行う）。
 */
export function resolveWorkspaceDocumentUri(
  rootPath: string,
  rawRelativePath: unknown
): string | null {
  const relativePath = normalizeWorkspaceRelativePath(rawRelativePath)

  // root そのもの（空文字）は文書ではない。
  if (relativePath === null || relativePath === '') {
    return null
  }

  const absolutePath = resolveWorkspacePath(rootPath, relativePath)

  return absolutePath === null ? null : toFileUri(absolutePath)
}

/* ------------------------------------------------------------------ 逆向き */

/**
 * サーバが指した URI を、Workspace の中の相対位置へ落とす（Session 5-3）。
 *
 * ## こちらの向きは「境界の外から入ってくる」
 *
 * 送る側（`resolveWorkspaceDocumentUri`）が扱うのは**自分で組み立てた値**だが、
 * こちらは**別のプロセスが言ってきた文字列**になる。診断（`publishDiagnostics`）は
 * サーバが好きな URI に対して送れるため、次のどれもが実際に届きうる。
 *
 * ```
 * Workspace の中のファイル … 通す（相対位置にする）
 * Workspace の外の絶対パス … 断る（別ドライブ・ホーム・親フォルダ）
 * file: 以外の scheme      … 断る（`untitled:` `git:` `deno:` など）
 * 相対位置に落とせない形   … 断る（別ホストの UNC・壊れた符号化）
 * ```
 *
 * **断ったものは Renderer に見えない。** Renderer が受け取るイベントには
 * 相対位置しか載らず（shared/ipc/events/lsp.ts）、その相対位置は必ず
 * この関数を通っている ── 「Renderer は Workspace の中しか指せない」という線が、
 * 出ていく側だけでなく**入ってくる側でも**保たれる。
 *
 * ## 実体は見ない
 *
 * ここも文字列の判断だけで、realpath は取らない（送る側と同じ理由。上記）。
 * 診断は**表示のための位置**であって、この経路からファイルが読み書きされることは
 * 無い ── 実際に開くのは Files ドメインで、そちらは今までどおり実体を確かめる。
 *
 * ## 出口でもう一度、送る側の規則に通す
 *
 * 組み立てた相対位置を `normalizeWorkspaceRelativePath` に通してから返す。
 * 二重に見えるが、**Renderer へ渡る文字列が満たすべき条件を1箇所で決める**
 * ことになる ── 入口が増えても、外へ出る形は同じ関数が保証する。
 */
export function toWorkspaceRelativePath(rootPath: string, rawUri: unknown): string | null {
  const absolutePath = fileUriToPath(rawUri)

  if (absolutePath === null) {
    return null
  }

  if (!isInsideWorkspace(rootPath, absolutePath)) {
    return null
  }

  const relativePath = relative(resolve(rootPath), absolutePath)

  // root 自身（空文字）は文書ではない。`..` で始まる形は境界の判定と食い違う。
  if (relativePath === '' || relativePath.startsWith('..')) {
    return null
  }

  // 送る側と同じ規則を通してから返す（上記）。
  return normalizeWorkspaceRelativePath(relativePath.replace(/\\/g, '/'))
}

/**
 * `file:` URI を絶対パスへ戻す。読めなければ null。
 *
 * `decodeURIComponent` は壊れた並び（`%zz`）で例外を投げるため、要素ごとに
 * 受け止める ── **相手のプロセスが送ってきた文字列で Main を落とさない。**
 */
function fileUriToPath(rawUri: unknown): string | null {
  if (typeof rawUri !== 'string' || rawUri.length === 0 || rawUri.includes('\0')) {
    return null
  }

  /*
    `?` と `#` を含むものは断る。ファイルの位置ではなく query / fragment を
    持つ URI で、`untitled:` などと同じく「ディスク上の1ファイル」を指していない。
    名前の中の `#` は `%23` として届くので、そちらは通る。
  */
  if (rawUri.includes('?') || rawUri.includes('#')) {
    return null
  }

  const match = /^file:\/\/([^/]*)(\/.*)$/i.exec(rawUri)

  if (match === null) {
    return null
  }

  const authority = decodeSegment(match[1] ?? '')
  const path = decodePath(match[2] ?? '')

  if (authority === null || path === null) {
    return null
  }

  if (authority !== '' && authority.toLowerCase() !== 'localhost') {
    /*
      UNC（`file://server/share/…`）。Windows でだけ実際の位置を持つ。
      それ以外の環境では指しているものが分からないので断る。
    */
    return isWindows ? resolve(`\\\\${authority}${path.replace(/\//g, '\\')}`) : null
  }

  /*
    `file:///D:/proj/a.ts` の path は `/D:/proj/a.ts`。先頭の `/` を落とすと
    Windows の絶対パスになる ── POSIX ではそのままが絶対パスなので落とさない。
  */
  const candidate = /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path

  return isAbsolute(candidate) ? resolve(candidate) : null
}

function decodePath(path: string): string | null {
  const segments: string[] = []

  for (const segment of path.split('/')) {
    const decoded = decodeSegment(segment)

    if (decoded === null) {
      return null
    }

    segments.push(decoded)
  }

  return segments.join('/')
}

function decodeSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment)

    /*
      符号化を解いた結果に区切りや NUL が現れる形は断る（`%2F` で階層をまたぐ・
      `%00` で名前を切る）。解いた後の文字列は名前としてしか使わない。
    */
    return decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')
      ? null
      : decoded
  } catch {
    // `%zz` のような壊れた並び。
    return null
  }
}
