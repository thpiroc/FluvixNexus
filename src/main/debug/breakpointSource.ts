import { basename } from 'path'
import { normalizeWorkspaceRelativePath, resolveWorkspacePath } from '../files/workspacePath'
import type { DapSourceReference } from './dapBreakpoints'

/**
 * 相対位置と、Debug Adapter へ渡す `Source` の対応（fs / child_process 非依存・テスト対象）。
 *
 * main/lsp/documentUri.ts と**同じ立ち位置**にあり、守ることも同じになる。
 *
 * ```
 * Renderer   … "src/app.js"                （相対位置だけ）
 *    ↓ IPC
 * ここ       … D:\proj + "src/app.js" → { path: "D:\proj\src\app.js", name: "app.js" }
 *    ↓
 * Debug Adapter
 * ```
 *
 * ## 検証は Files ドメインと同じ関数を通す
 *
 * `..`・絶対パス・ドライブ相対・代替データストリーム・NUL を断つのは
 * main/files/workspacePath.ts の仕事で、ここは**別の検証を書き起こさない**
 * ── 書き起こすと、片方だけに穴が空く。通らなかった場合は null を返し、
 * 呼び出し側が要求ごと断る（main/ipc/handlers/debug.ts の PERMISSION_DENIED）。
 *
 * 検証は2段で、どちらもこの関数の中で閉じている。
 *
 * ```
 * 1段目 … パス文字列として Workspace の外を指していないか（normalize）
 * 2段目 … root と繋いだ結果が Workspace の中に収まるか（resolveWorkspacePath）
 * ```
 *
 * ## realpath は取らない
 *
 * ここも LSP の URI と同じで、**文字列としての判断だけ**にする。理由は2つ。
 *
 *   - **まだ存在しない行にも印を置ける必要がある。** breakpoint は編集中の
 *     ファイルに対して置くもので、保存前・作成直後・一時的に消えている状態でも
 *     操作できないと道具にならない。realpath はそこで例外になる
 *   - **この境界が守っているのは「Renderer から任意の場所を指せないこと」**に
 *     ほかならない（main/lsp/documentUri.ts と同じ理由）。adapter は
 *     デバッグ対象のプログラムを通じて Workspace の外のファイルも読むが、
 *     それはこの `Source` の有無とは関係が無い
 *
 * ファイルを実際に読み書きする経路（Files ドメイン）は、今までどおり realpath を取る。
 */

/**
 * Workspace の中の相対位置を、DAP の `Source` にする。
 *
 * 相対位置として扱えない・root 自身・Workspace の外を指す場合は null。
 * 渡すのは境界の外から届いたそのままの値でよい（正規化もここが行う）。
 */
export function resolveDebugBreakpointSource(
  rootPath: string,
  rawRelativePath: unknown
): DapSourceReference | null {
  const relativePath = normalizeWorkspaceRelativePath(rawRelativePath)

  // root そのもの（空文字）は文書ではない。
  if (relativePath === null || relativePath === '') {
    return null
  }

  const absolutePath = resolveWorkspacePath(rootPath, relativePath)

  if (absolutePath === null) {
    return null
  }

  return { path: absolutePath, name: basename(absolutePath) }
}

/**
 * 相対位置として受け取れる形か（`Source` を組み立てずに確かめたいとき）。
 *
 * 保存内容の読み直しで使う。保存ファイルは利用者が手で編集できる場所にあり、
 * **前の Workspace の内容が残っている**こともあるため、読み込んだ相対位置も
 * 境界の外から来た値として扱う。
 */
export function normalizeDebugBreakpointPath(rawRelativePath: unknown): string | null {
  const relativePath = normalizeWorkspaceRelativePath(rawRelativePath)

  return relativePath === null || relativePath === '' ? null : relativePath
}
