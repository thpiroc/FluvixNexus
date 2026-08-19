import {
  FILES_RELATIVE_PATH_MAX_LENGTH,
  WORKSPACE_ROOT_RELATIVE_PATH,
  isAtOrUnder
} from '@shared/files'
import { isIgnoredRelativePath } from './ignoredDirectories'

/**
 * ファイル監視から届いたパスの扱い（fs にも Electron にも依存しない）。
 *
 * `workspacePath.ts` が「Renderer から来たパス文字列の判断」を持つのに対し、
 * こちらは **OS から来たパスの判断**を持つ。向きが逆なので分けてある。
 *
 *   workspacePath.ts … 相対位置 → 絶対パス（境界の外へ出さない）
 *   ここ             … 絶対パス → 相対位置（Renderer へ絶対パスを渡さない）
 *
 * 実際に監視するのは workspaceWatcher.ts で、この層は文字列の判断だけを持つ。
 */

/** OS のパスを、比較できる形（区切りは `/`）へ揃える。 */
function toPosixLike(value: string): string {
  return value.replaceAll('\\', '/')
}

/**
 * Windows では大文字小文字を区別しない。
 *
 * 監視から届くパスの表記は、`fs.watch` に渡した root の表記に引きずられる一方、
 * ディスク上の実際の表記とは限らない。区別すると、同じ場所を root の外と
 * 判定してしまう（workspacePath.ts の isInsideWorkspace と同じ判断）。
 */
function foldCase(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

/**
 * 監視から届いた絶対パスを、Workspace root からの相対位置へ落とす。
 *
 * **root の外を指すものは null。** 監視は root に対して張るため通常は起きないが、
 * ジャンクションの指し先や、OS が返す想定外の表記が混ざりうる。
 * ここを通さない経路を作らないことで、Renderer へ絶対パスも
 * Workspace の外の位置も渡らないことが保てる（ARCHITECTURE.md §9.2）。
 *
 * root 自身（＝空文字）も null にする。Workspace root そのものの変化は
 * 「中身が変わった」以上の意味を持たず、その中身は個別に届くため。
 */
export function toWorkspaceRelativeWatchPath(
  rootPath: string,
  absolutePath: string
): string | null {
  const root = toPosixLike(rootPath).replace(/\/+$/, '')
  const target = toPosixLike(absolutePath)

  const foldedRoot = foldCase(root)
  const foldedTarget = foldCase(target)

  // 前方一致は区切り文字まで含めて比べる（`D:/proj` と `D:/project` を混同しない）。
  if (!foldedTarget.startsWith(`${foldedRoot}/`)) {
    return null
  }

  const relativePath = target.slice(root.length + 1)

  if (relativePath === WORKSPACE_ROOT_RELATIVE_PATH) {
    return null
  }

  // 契約上の上限（entry.ts）を超えるものは、そもそも Renderer が扱えない。
  if (relativePath.length > FILES_RELATIVE_PATH_MAX_LENGTH) {
    return null
  }

  // 監視が返すパスに `..` が混ざることは無いが、通さない線はここでも引く。
  if (relativePath.split('/').some((segment) => segment === '..' || segment === '.')) {
    return null
  }

  return relativePath
}

/**
 * 監視の対象から外す位置か（どの階層に現れても外す）。
 *
 * **監視を「開発中に触るもの」に絞るための線。** 外さないと、`npm install` や
 * `git` の操作1回で数万件の変化が流れ、Renderer が読み直しに追われる。
 *
 * 規則そのものは ignoredDirectories.ts が持つ ── Session 3-6-4 で
 * プロジェクト全体検索が同じ判断を要るようになったため、共通の1箇所へ移した
 * （監視では届くのに検索には出ない、という食い違いを作らないため）。
 */
export function isIgnoredWatchPath(relativePath: string): boolean {
  return isIgnoredRelativePath(relativePath)
}

/**
 * 同じ通知の束の中で、他の変化に飲み込まれる位置を取り除く。
 *
 * フォルダが1つ消えると、その配下のファイルについても削除が届く。
 * すべて配ると、受け手（Files のツリー・Editor のタブ）が
 * **既に畳んだ場所に対して同じ判断を何度も繰り返す**ことになる。
 * 祖先が消えているなら、配下の1件ずつは意味を持たない。
 */
export function dropPathsUnderDeleted(
  paths: readonly string[],
  deletedPaths: readonly string[]
): readonly string[] {
  if (deletedPaths.length === 0) {
    return paths
  }

  return paths.filter(
    (path) => !deletedPaths.some((deleted) => deleted !== path && isAtOrUnder(deleted, path))
  )
}
