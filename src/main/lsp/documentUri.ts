import { normalizeWorkspaceRelativePath, resolveWorkspacePath } from '../files/workspacePath'

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
