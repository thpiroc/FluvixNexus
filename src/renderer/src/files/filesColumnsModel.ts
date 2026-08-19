import { splitRelativePath, WORKSPACE_ROOT_RELATIVE_PATH, type FileEntry } from '@shared/files'
import {
  ancestorRelativePaths,
  directoryRows,
  type FileTreeDirectories,
  type FileTreeDraft,
  type FileTreeRow
} from './fileTreeModel'

/**
 * カラム表示の「列の並び」を導く層（React にも DOM にも依存しない。Session 3-6-7）。
 *
 * fileTreeModel.ts がツリーの行の並びを導いているのと同じ立ち位置で、
 * **表示の形をデータとして決める**のがここ。React 側（FileColumns.tsx）は
 * この結果を並べるだけになる。
 *
 * ## データモデルを増やさない
 *
 * ツリーとカラムで別の Files を持たない。読むのは同じ `directories`
 * （relativePath → そのフォルダの状態）で、1つのカラムの中身は
 * **ツリーと同じ `directoryRows()`** が作る ── 読み込み中・空・打ち切り・失敗・
 * 名前の入力中の見せ方は表示方式ではなくフォルダの状態が決めることなので、
 * ここに書き直すと表示方式ごとに差が生まれる（fileTreeModel.ts）。
 *
 * Lazy Load（Session 3-2）もそのまま乗る。カラムを開くことは
 * **そのフォルダを展開すること**として表され、読み込みは「展開されたのに
 * まだ中身を知らないフォルダを読む」という既存の1本の経路が拾う（useFileTree.ts）。
 * カラム表示のための読み込み経路は1つも足していない。
 *
 * ## 状態は「一番右のカラムが見せているフォルダ」1つだけ
 *
 * カラムの列を配列として持たない。持つのは `activeDirectory` ── そこから
 * root までの祖先をたどれば列の並びが決まる（`columnDirectories`）。
 *
 * この形にすると、「別のフォルダを選んだら、それより右の古いカラムは捨てる」が
 * **処理ではなく導出**になる。列を配列で持つと、選び直したときに右側を切り詰める
 * 処理が要り、切り詰め忘れると画面に古い階層が残る。
 */

/** カラム1枚。 */
export interface FilesColumn {
  /** React の key。1つのフォルダは1つのカラムにしか出ないため、位置で一意になる。 */
  readonly key: string
  /** このカラムが見せているフォルダ。root は空文字。 */
  readonly relativePath: string
  /** 見出しに出す名前（root は Workspace の表示名）。 */
  readonly name: string
  /** 並ぶ行。**ツリーと同じ形**（depth は 0 固定 ── 横に並べる分、深さは列が示す）。 */
  readonly rows: readonly FileTreeRow[]
  /** このカラムの中で、右のカラムとして開いている子フォルダ。一番右のカラムでは null。 */
  readonly openedChildRelativePath: string | null
}

/**
 * 左から順に、どのフォルダのカラムを出すか。
 *
 * `src/renderer/files` なら `['', 'src', 'src/renderer', 'src/renderer/files']`。
 * root（空文字）を必ず先頭に含めるのは、Workspace 直下がどの階層からでも
 * 左端に見えているようにするため（ツリーで root 行が常にあるのと同じ）。
 */
export function columnDirectories(activeDirectory: string): readonly string[] {
  const ancestors = ancestorRelativePaths(activeDirectory)

  return activeDirectory === WORKSPACE_ROOT_RELATIVE_PATH
    ? ancestors
    : [...ancestors, activeDirectory]
}

interface BuildFileColumnsInput {
  /** 左端のカラムの見出しに出す名前（Workspace の表示名）。 */
  readonly rootName: string
  readonly directories: FileTreeDirectories
  /** 一番右のカラムが見せているフォルダ。root は空文字。 */
  readonly activeDirectory: string
  /** 名前を入力している最中のもの。無ければ null。 */
  readonly draft?: FileTreeDraft | null
}

/** 左から右へ並ぶカラムを作る。 */
export function buildFileColumns({
  rootName,
  directories,
  activeDirectory,
  draft = null
}: BuildFileColumnsInput): readonly FilesColumn[] {
  const path = columnDirectories(activeDirectory)

  return path.map((relativePath, index) => {
    const openedChildRelativePath = path[index + 1] ?? null

    return {
      key: `column:${relativePath}`,
      relativePath,
      name: columnName(relativePath, rootName),
      /*
        ツリーと同じ関数を通す。カラム表示だけの並べ方は持たない。
        「開いている」の意味だけがここで変わる ── ツリーでは展開中、
        カラムでは**右のカラムとして出ている**フォルダ。
      */
      rows: directoryRows({
        relativePath,
        depth: 0,
        directories,
        draft,
        isOpen: (entry) => entry.relativePath === openedChildRelativePath
      }),
      openedChildRelativePath
    }
  })
}

/**
 * そのカラムが見せているフォルダ自身を指すエントリ。
 *
 * カラムの見出しを右クリックしたときの対象になる（そのフォルダへの新規作成・
 * 貼り付け・ここへ移動）。ツリーでは**フォルダ行そのもの**がその役をしていて、
 * カラム表示ではその行が見出しに当たる ── 右クリックの経路
 * （FileContextMenu.tsx）を表示方式で分けないために、同じ形の値を作る。
 *
 * root の id と名前はツリーの root 行と一致する（`d:` + relativePath。
 * 名前は Workspace の表示名）。選択の帯が表示方式をまたいでも同じものを指す。
 */
export function columnDirectoryEntry(column: FilesColumn): FileEntry {
  return {
    id: `d:${column.relativePath}`,
    name: column.name,
    relativePath: column.relativePath,
    type: 'directory',
    extension: null
  }
}

/**
 * 今も辿れる一番深いフォルダ（消えたフォルダから右は捨てる）。
 *
 * カラムの途中のフォルダが（アプリの外も含めて）消えると、そこから右のカラムは
 * 行き止まりになる。読み直した結果が「見つからない」だったフォルダの手前で切って、
 * **開ける場所まで戻す**のがこの関数。
 *
 * 消えたことを `directories` の読み直し結果から知るのが要点で、削除の操作から
 * 直接カラムを畳まない ── アプリの外での削除も同じ経路（`files:changed` →
 * 読み直し）で届くため、ここを通せば入口が増えても畳み方は1つで済む。
 */
export function clampActiveDirectory(
  directories: FileTreeDirectories,
  activeDirectory: string
): string {
  const path = columnDirectories(activeDirectory)
  // root は常に残す（Workspace そのものが無くなる場合は Workspace 側の話になる）。
  let deepest = WORKSPACE_ROOT_RELATIVE_PATH

  for (const relativePath of path.slice(1)) {
    const state = directories.get(relativePath)

    if (state?.status === 'error' && state.reason === 'not-found') {
      break
    }

    deepest = relativePath
  }

  return deepest
}

/**
 * そのフォルダをカラムで開くときの `activeDirectory`。
 *
 * フォルダなら自分自身、ファイルならそれを含むフォルダ。ファイルを選んでも
 * 列の並びが変わらない（＝右に空のカラムが生えない）ようにするための読み替え。
 */
export function activeDirectoryFor(relativePath: string, type: 'file' | 'directory'): string {
  if (type === 'directory') {
    return relativePath
  }

  return splitRelativePath(relativePath)?.parent ?? WORKSPACE_ROOT_RELATIVE_PATH
}

function columnName(relativePath: string, rootName: string): string {
  if (relativePath === WORKSPACE_ROOT_RELATIVE_PATH) {
    return rootName
  }

  return splitRelativePath(relativePath)?.name ?? relativePath
}
