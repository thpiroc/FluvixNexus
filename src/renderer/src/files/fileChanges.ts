import { isAtOrUnder, parentRelativePath, type WorkspaceFileChange } from '@shared/files'
import type { FileTreeDirectories } from './fileTreeModel'

/**
 * ディスク側の変化を、ファイルツリーの状態へ落とす（React にも DOM にも依存しない）。
 *
 * `files:changed`（Main → Renderer のイベント）を受けて何をするかを、
 * 純粋関数として切り出してある。useFileTree.ts が決めるのは「いつ呼ぶか」だけ。
 *
 * ## ツリー全体を読み直さない
 *
 * Session 3-2 の Lazy Load（ARCHITECTURE.md §9.4）は、作成・改名・削除が
 * 入っても崩さない。1件の変化で読み直すのは**その親フォルダ1つ**だけで、
 * 読み込み済みの他のフォルダはそのまま残る。
 * `node_modules` を展開した状態でファイルを1つ作っただけで、
 * 数千件を読み直すことにならないようにするため。
 *
 * ## 読み直しは「忘れる」ことで起こす
 *
 * 読み込み済みの表からその欄を消すだけで、useFileTree.ts の
 * 「展開されているのに中身を知らないフォルダを読む」という既存の経路が拾う。
 * 変更のための読み込み経路を別に作らないので、要求の重複や取り消しの扱いも
 * 従来のまま1本で済む。
 *
 * ## 中身の変更（modified）では読み直さない
 *
 * ファイル変更監視（Session 3-5）が加わり、アプリの外での変更もこの経路に届く。
 * そのうち `modified` は**ツリーの形を変えない** ── Files パネルが持っているのは
 * 「どこに何があるか」であって中身ではない（ARCHITECTURE.md §9.2）。
 * ここで読み直すと、外部のビルドツールがファイルを書き換えるたびに
 * 親フォルダを読み直すことになり、Lazy Load の意味が薄れる。
 *
 * 中身を持っているのは Editor（Monaco の Model）だけなので、
 * `modified` を受け取るのはそちらだけになる。
 */

/** 変化1件が起きた場所（複数ありうる）。ツリーに関係しない変化は空。 */
function changedPaths(change: WorkspaceFileChange): readonly string[] {
  if (change.kind === 'modified') {
    // 中身が変わっただけ。並びも位置も変わらない（上のコメント）。
    return []
  }

  return change.kind === 'renamed'
    ? [change.fromRelativePath, change.toRelativePath]
    : [change.relativePath]
}

/**
 * 読み直すべきフォルダ。
 *
 * 変化した位置そのものではなく**その親**（中身の並びが変わるのは親の方）。
 *
 * `renamed` は元の場所と行き先の両方を数える。改名（`files:rename`）では
 * どちらも同じフォルダなので1つに畳まれ、移動（`files:move`）では
 * 別のフォルダになるので2つ読み直す ── **受け手はその区別を持たない。**
 * 位置が変わったことだけが分かれば、読み直す相手は同じ規則で決まる。
 */
export function directoriesToReload(changes: readonly WorkspaceFileChange[]): readonly string[] {
  const directories = new Set<string>()

  for (const change of changes) {
    for (const path of changedPaths(change)) {
      const parent = parentRelativePath(path)

      if (parent !== null) {
        directories.add(parent)
      }
    }
  }

  return [...directories]
}

/**
 * 消えた / 別の場所へ移った位置。
 *
 * フォルダが対象なら、その配下に読み込み済み・展開済みのものが残る。
 * それらを畳むための起点として返す。
 */
export function removedPaths(changes: readonly WorkspaceFileChange[]): readonly string[] {
  const removed: string[] = []

  for (const change of changes) {
    if (change.kind === 'deleted') {
      removed.push(change.relativePath)
    } else if (change.kind === 'renamed') {
      removed.push(change.fromRelativePath)
    }
  }

  return removed
}

/**
 * 変化を、読み込み済みの表へ反映する。
 *
 * 読み直すフォルダの欄を消し、消えた位置の配下もまとめて消す。
 * 変化が今の表に一切関係しなければ、元のオブジェクトをそのまま返す
 * （layout/ の操作関数と同じ約束。無駄な再描画を作らない）。
 */
export function applyChangesToDirectories(
  directories: FileTreeDirectories,
  changes: readonly WorkspaceFileChange[]
): FileTreeDirectories {
  const reload = directoriesToReload(changes)
  const removed = removedPaths(changes)

  const shouldForget = (relativePath: string): boolean =>
    reload.includes(relativePath) || removed.some((ancestor) => isAtOrUnder(ancestor, relativePath))

  const doomed = [...directories.keys()].filter(shouldForget)

  if (doomed.length === 0) {
    return directories
  }

  const next = new Map(directories)

  for (const relativePath of doomed) {
    next.delete(relativePath)
  }

  return next
}

/**
 * 変化を、展開しているフォルダの集合へ反映する。
 *
 * 消えた / 移ったフォルダの配下を展開状態から外す。残しておいても
 * flattenFileTree はもう辿らないが、**同じ名前のフォルダが後から作られたときに
 * 勝手に開いた状態で現れる**。位置と展開状態が結び付いている以上、
 * 位置が無くなった時点で外す方が素直。
 *
 * 改名の行き先は展開しない。改名の前に開いていたかどうかを引き継ぐ判断は
 * ここでは持たず、利用者が開き直す（読み込み済みの中身も消えているため、
 * 引き継ぐと「開いているのに読み込み中」から始まることになる）。
 */
export function applyChangesToExpanded(
  expanded: ReadonlySet<string>,
  changes: readonly WorkspaceFileChange[]
): ReadonlySet<string> {
  const removed = removedPaths(changes)

  if (removed.length === 0) {
    return expanded
  }

  const doomed = [...expanded].filter((relativePath) =>
    removed.some((ancestor) => isAtOrUnder(ancestor, relativePath))
  )

  if (doomed.length === 0) {
    return expanded
  }

  const next = new Set(expanded)

  for (const relativePath of doomed) {
    next.delete(relativePath)
  }

  return next
}
