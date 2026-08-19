import {
  parentRelativePath,
  WORKSPACE_ROOT_RELATIVE_PATH,
  type FileEntry,
  type FileEntryType
} from '@shared/files'

/**
 * ファイルツリーの状態を「行の並び」へ畳む層（React にも DOM にも依存しない）。
 *
 * Workspace Shell で layout/ が担っている役どころと同じで、
 * **表示の形をデータとして決める**のがここ。React 側（useFileTree.ts / FileTree.tsx）は
 * この結果を並べるだけになる。
 *
 * ## 正本は Main 側にある
 *
 * ここが持つのは「今どこまで読んだか」の写しでしかない。フォルダの中身の正本は
 * ディスクにあり、それを見られるのは Main だけ（ARCHITECTURE.md §9）。
 * だから読み込み中・失敗も**状態として**持つ。ツリーの一部が読めていない、
 * あるいは読めなかったというのは、この画面では例外ではなく通常の状態のため。
 *
 * ## 木ではなく「フォルダ単位の表」で持つ
 *
 * 入れ子のオブジェクトで木を組み立てず、`relativePath → そのフォルダの状態` の表にしてある。
 * Lazy Load では読み込みの単位がフォルダ1つであり、木の途中を差し替える形にすると
 * 深い階層ほど更新のたびに親を作り直すことになる。表にしておけば、
 * 届いた応答はそのフォルダの欄を差し替えるだけで済む。
 *
 * 木の形（どこにぶら下がるか・階層の深さ）は、この表と「展開しているフォルダ」から
 * flattenFileTree() が毎回導く。
 */

/** そのフォルダを読んだ結果。 */
export type DirectoryState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready'
      readonly entries: readonly FileEntry[]
      /** 上限で打ち切られたか（shared/files/entry.ts）。 */
      readonly truncated: boolean
    }
  | { readonly status: 'error'; readonly reason: FileTreeErrorReason }

/**
 * 読めなかった理由。
 *
 * IpcErrorCode をそのまま持ち回らないのは、表示側が知りたいのが
 * 「消えたのか / 権限が無いのか / それ以外か」の3つだけだから。
 * 対応付けは filesError.ts が持つ。
 */
export type FileTreeErrorReason = 'not-found' | 'permission-denied' | 'unavailable'

/** relativePath → そのフォルダの状態。まだ読んでいないフォルダは載っていない。 */
export type FileTreeDirectories = ReadonlyMap<string, DirectoryState>

/**
 * 名前を入力している最中のもの。同時に1つだけ。
 *
 * 作成もリネームも**ツリーの中で名前を打つ**形にしてある。別のダイアログを開くと、
 * どのフォルダに対する操作なのかが画面から消え、深い階層ほど分かりにくくなる。
 *
 * 「1つだけ」にしているのは、複数の下書きを同時に持つ意味が無いのに、
 * 持てる形にすると「どれが今の入力欄か」を別に管理することになるため。
 */
export type FileTreeDraft =
  | {
      readonly kind: 'create'
      /** 作成先のフォルダ。行はこのフォルダの子として現れる。 */
      readonly parentRelativePath: string
      readonly entryType: FileEntryType
    }
  | {
      readonly kind: 'rename'
      /** 変更する対象。その行が入力欄に差し替わる。 */
      readonly relativePath: string
      /** 入力欄の初期値（今の名前）。 */
      readonly initialName: string
    }

/** ツリーに並ぶ1行。 */
export type FileTreeRow =
  | {
      readonly kind: 'entry'
      /** React の key であり、選択・フォーカスの識別子でもある（FileEntry.id）。 */
      readonly key: string
      /** 階層の深さ。root が 0。 */
      readonly depth: number
      readonly entry: FileEntry
      /** フォルダのとき、今開いているか。ファイルでは常に false。 */
      readonly expanded: boolean
    }
  | {
      readonly kind: 'note'
      readonly key: string
      readonly depth: number
      readonly variant: FileTreeNoteVariant
      /** この行が属するフォルダ。再試行はこの位置に対して行う。 */
      readonly relativePath: string
      /** variant が 'error' のときだけ入る。 */
      readonly reason: FileTreeErrorReason | null
    }
  /**
   * 新しいものの名前を打つための行。
   *
   * リネームには行を作らない（既存の行が入力欄に差し替わるだけなので、
   * 並びとしては何も増えない）。作成だけが「まだ無いものの場所」を要るため、
   * こちらだけ行として現れる。
   */
  | {
      readonly kind: 'draft'
      readonly key: string
      readonly depth: number
      readonly parentRelativePath: string
      readonly entryType: FileEntryType
    }

/** 行そのものではなく、そのフォルダの状況を伝える行。 */
export type FileTreeNoteVariant = 'loading' | 'empty' | 'truncated' | 'error'

/**
 * Workspace root を表す擬似エントリ。
 *
 * root だけ別の行として書き分けないのは、展開・選択・インデントの扱いを
 * 他のフォルダと同じ1本の道に通すため。名前は Workspace の表示名を使う
 * （ディスク上のフォルダ名とは限らない。将来「名前を付ける」が入る余地。§8.2）。
 */
function createRootEntry(rootName: string): FileEntry {
  return {
    id: `d:${WORKSPACE_ROOT_RELATIVE_PATH}`,
    name: rootName,
    relativePath: WORKSPACE_ROOT_RELATIVE_PATH,
    type: 'directory',
    extension: null
  }
}

interface FlattenFileTreeInput {
  /** root 行に出す名前（Workspace の表示名）。 */
  readonly rootName: string
  readonly directories: FileTreeDirectories
  /** 今開いているフォルダの relativePath。root は空文字。 */
  readonly expanded: ReadonlySet<string>
  /** 名前を入力している最中のもの。無ければ null。 */
  readonly draft?: FileTreeDraft | null
}

/**
 * 表示する行を上から順に作る。
 *
 * 展開されていないフォルダの中身は辿らない。読み込み済みでも同じで、
 * 「畳んだら見えない」を状態ではなくこの導出で表す。
 */
export function flattenFileTree({
  rootName,
  directories,
  expanded,
  draft = null
}: FlattenFileTreeInput): readonly FileTreeRow[] {
  const rows: FileTreeRow[] = []
  const root = createRootEntry(rootName)

  rows.push({
    kind: 'entry',
    key: root.id,
    depth: 0,
    entry: root,
    expanded: expanded.has(WORKSPACE_ROOT_RELATIVE_PATH)
  })

  if (expanded.has(WORKSPACE_ROOT_RELATIVE_PATH)) {
    appendDirectory(rows, WORKSPACE_ROOT_RELATIVE_PATH, 1, directories, expanded, draft)
  }

  return rows
}

function appendDirectory(
  rows: FileTreeRow[],
  relativePath: string,
  depth: number,
  directories: FileTreeDirectories,
  expanded: ReadonlySet<string>,
  draft: FileTreeDraft | null
): void {
  const own = directoryRows({
    relativePath,
    depth,
    directories,
    draft,
    isOpen: (entry) => expanded.has(entry.relativePath)
  })

  for (const row of own) {
    rows.push(row)

    // 開いているフォルダの中身は、その行のすぐ下へ続けて並べる（＝木の形）。
    if (row.kind === 'entry' && row.expanded) {
      appendDirectory(rows, row.entry.relativePath, depth + 1, directories, expanded, draft)
    }
  }
}

interface DirectoryRowsInput {
  /** 中身を並べるフォルダ。 */
  readonly relativePath: string
  /** 行に持たせる階層の深さ（カラム表示では常に 0）。 */
  readonly depth: number
  readonly directories: FileTreeDirectories
  /** 名前を入力している最中のもの。無ければ null。 */
  readonly draft: FileTreeDraft | null
  /**
   * そのフォルダ行を「開いている」として出すか。
   *
   * ツリーでは**展開中のフォルダ**、カラム表示では**右のカラムとして開いている
   * フォルダ**にあたる（Session 3-6-7）。どちらも「この行の先が今見えている」という
   * 同じ意味で、違うのは見えている場所（下 / 右）だけなので、行の側は1つの旗で足りる。
   */
  readonly isOpen: (entry: FileEntry) => boolean
}

/**
 * **フォルダ1つの中身を行の並びへ畳む**（子フォルダの中までは辿らない）。
 *
 * ツリー（上の appendDirectory）とカラム表示（filesColumnsModel.ts）が
 * **同じ関数を通る**ようにするために切り出してある。読み込み中・空・打ち切り・失敗・
 * 名前の入力中をどう見せるかは表示方式ではなくフォルダの状態が決めることなので、
 * 2箇所に書くと「カラムでは空のフォルダに何も出ない」といった差が表示方式ごとに生まれる。
 *
 * 違うのは**並べた後に何をするか**だけ ── ツリーは開いているフォルダの中身を
 * すぐ下へ続け、カラムは右隣のカラムとして出す。
 */
export function directoryRows({
  relativePath,
  depth,
  directories,
  draft,
  isOpen
}: DirectoryRowsInput): readonly FileTreeRow[] {
  const rows: FileTreeRow[] = []

  /*
    入力中の行は、そのフォルダの中身より先に置く。

    読み込み中・失敗・空のいずれの場合でも出す。作成先のフォルダが
    まだ読めていない・空である、というのは名前を打てない理由にならない
    （むしろ空のフォルダにこそ最初の1件を作りたい）。
  */
  if (draft?.kind === 'create' && draft.parentRelativePath === relativePath) {
    rows.push({
      kind: 'draft',
      key: `draft:${draft.entryType}:${relativePath}`,
      depth,
      parentRelativePath: relativePath,
      entryType: draft.entryType
    })
  }

  const state = directories.get(relativePath)

  // まだ要求が出ていない段階（展開した直後の1フレーム）も読み込み中として見せる。
  // 何も出さないと、展開したのに反応が無いように見える。
  if (state === undefined || state.status === 'loading') {
    rows.push(note(relativePath, depth, 'loading', null))
    return rows
  }

  if (state.status === 'error') {
    rows.push(note(relativePath, depth, 'error', state.reason))
    return rows
  }

  if (state.entries.length === 0) {
    // 入力中の行が既に出ているなら「空のフォルダ」は出さない（空には見えないため）。
    if (draft?.kind !== 'create' || draft.parentRelativePath !== relativePath) {
      rows.push(note(relativePath, depth, 'empty', null))
    }

    return rows
  }

  for (const entry of state.entries) {
    rows.push({
      kind: 'entry',
      key: entry.id,
      depth,
      entry,
      expanded: entry.type === 'directory' && isOpen(entry)
    })
  }

  if (state.truncated) {
    rows.push(note(relativePath, depth, 'truncated', null))
  }

  return rows
}

function note(
  relativePath: string,
  depth: number,
  variant: FileTreeNoteVariant,
  reason: FileTreeErrorReason | null
): FileTreeRow {
  return {
    kind: 'note',
    // フォルダごとに1行しか出ないため、位置と種類だけで一意になる。
    key: `note:${variant}:${relativePath}`,
    depth,
    variant,
    relativePath,
    reason
  }
}

/**
 * 展開状態を切り替えた新しい集合を返す。
 *
 * 畳んでも子フォルダの展開状態は消さない。畳む前の形のまま開き直せる方が、
 * 深い階層を行き来するときに操作をやり直さずに済む。
 * 読み込み済みの中身（directories）を捨てないのも同じ理由。
 */
export function toggleExpanded(
  expanded: ReadonlySet<string>,
  relativePath: string
): ReadonlySet<string> {
  const next = new Set(expanded)

  if (!next.delete(relativePath)) {
    next.add(relativePath)
  }

  return next
}

/** 今並んでいる行の中から、その id のものを探す。 */
export function findEntryById(rows: readonly FileTreeRow[], id: string | null): FileEntry | null {
  if (id === null) {
    return null
  }

  for (const row of rows) {
    if (row.kind === 'entry' && row.key === id) {
      return row.entry
    }
  }

  return null
}

/**
 * 「今どのフォルダに対して作るか」。
 *
 * 選んでいるものがフォルダならそこ、ファイルならそれを含むフォルダ、
 * 何も選んでいなければ Workspace root。
 *
 * ツリー上の1点から作成先を導いているのは、**選択とは別に「作成先」を状態として
 * 持たない**ため。持つと、選び直したときに追従させる処理が要り、
 * 追従し損ねると画面で選んでいる場所と実際の作成先がずれる。
 */
export function resolveCreateTarget(entry: FileEntry | null): string {
  if (entry === null) {
    return WORKSPACE_ROOT_RELATIVE_PATH
  }

  if (entry.type === 'directory') {
    return entry.relativePath
  }

  return parentRelativePath(entry.relativePath) ?? WORKSPACE_ROOT_RELATIVE_PATH
}

/**
 * その位置を画面に出すために開いておく必要のあるフォルダ（root から順に）。
 *
 * 検索結果を押したときに、その場所をツリーの中で見せるのに使う（Session 3-6-4）。
 * `a/b/c.txt` なら `['', 'a', 'a/b']` ── **対象そのものは含まない**
 * （フォルダを選んだからといって、中まで開く操作にはしない）。
 *
 * root（空文字）を必ず含めるのは、root が畳まれている状態でも
 * 「開いてから辿る」で1本の処理になるため（例外を作らない）。
 */
export function ancestorRelativePaths(relativePath: string): readonly string[] {
  const ancestors: string[] = [WORKSPACE_ROOT_RELATIVE_PATH]
  const segments = relativePath.split('/').filter((segment) => segment !== '')

  // 最後の要素は対象そのものなので含めない。
  for (let index = 0; index < segments.length - 1; index += 1) {
    ancestors.push(segments.slice(0, index + 1).join('/'))
  }

  return ancestors
}

/** そのフォルダが空だと分かっているか（読み込み済みで 0 件）。読んでいなければ null。 */
export function countLoadedEntries(
  directories: FileTreeDirectories,
  relativePath: string
): number | null {
  const state = directories.get(relativePath)

  return state?.status === 'ready' ? state.entries.length : null
}
