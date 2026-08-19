import {
  FILE_CONTENT_SEARCH_MAX_FILES,
  FILE_CONTENT_SEARCH_MAX_MATCHES,
  FILE_CONTENT_SEARCH_MAX_MATCHES_PER_FILE,
  FILE_SEARCH_MAX_DEPTH,
  parentRelativePath,
  type FileContentMatch,
  type FileContentMatchFile,
  type FileContentSearchLimit
} from '@shared/files'

/**
 * 全文検索の状態と、それを画面に並べる形（React にも DOM にも依存しない）。
 *
 * fileSearchModel.ts が名前の検索に対して担っているのと同じ立ち位置。
 * 状態の5分類（検索中 / 0 件 / 取り消し / 打ち切り / 失敗）もそのまま揃えてある ──
 * **利用者の次の一手が違うものは言い分ける**という判断は、探す対象が
 * 名前でも中身でも変わらない。
 *
 * ## 名前の検索と型を共有していない
 *
 * `FileSearchState` に「結果が FileEntry か FileContentMatchFile か」の分岐を
 * 足す形にしていない。結果の形が違うだけでなく、**言うことも違う**ため
 * （0 件の文言・打ち切りの理由・件数の数え方）。共有すると、どちらの検索でも
 * 「起きえない場合」を画面側で毎回書くことになる。
 *
 * ## 並べる形をここで決める
 *
 * 結果は Main からファイル単位で届く（shared/files/contentSearch.ts）。
 * それを **フォルダ → ファイル → 一致** の3段の行に展開するのがここ。
 *
 * ```
 * src                       ← folder
 *   App.tsx  3 件           ← file
 *     42:15  const example  ← match
 * ```
 *
 * fileTreeModel.ts が「状態 → 行の並び」を持っているのと同じ形で、
 * 描く側（FileContentResults.tsx）は並べるだけになる。**入れ子の DOM にしない**のは、
 * 上下キーでの移動が「配列の隣」で決まるようにするため（ツリーと同じ考え方）。
 */

export type FileContentSearchState =
  /** まだ何も探していない（検索語が空）。 */
  | { readonly status: 'idle' }
  /** 走っている最中。 */
  | { readonly status: 'searching'; readonly query: string }
  /** 最後まで見た。files が空なら 0 件。 */
  | {
      readonly status: 'done'
      readonly query: string
      readonly files: readonly FileContentMatchFile[]
      readonly matchCount: number
      /** 上限に当たって全部は見ていないか。 */
      readonly truncated: boolean
      readonly limit: FileContentSearchLimit | null
    }
  /** 途中で止めた（利用者の操作）。そこまでに見つけたものは残す。 */
  | {
      readonly status: 'cancelled'
      readonly query: string
      readonly files: readonly FileContentMatchFile[]
      readonly matchCount: number
    }
  /** 探せなかった。 */
  | { readonly status: 'error'; readonly query: string; readonly message: string }

/** その状態で画面に出ている結果（結果を持たない状態では空）。 */
export function contentSearchFilesOf(
  state: FileContentSearchState
): readonly FileContentMatchFile[] {
  return state.status === 'done' || state.status === 'cancelled' ? state.files : []
}

/* -------------------------------------------------------------- 行の並び */

/** 見出し（そのファイルたちを含むフォルダ）。押せない。 */
export interface FileContentFolderRow {
  readonly kind: 'folder'
  readonly id: string
  /** Workspace root からの相対位置（root 直下のファイルには付かない）。 */
  readonly label: string
}

/** ファイル1件。押すと最初の一致へ飛ぶ。 */
export interface FileContentFileRow {
  readonly kind: 'file'
  readonly id: string
  readonly relativePath: string
  readonly name: string
  readonly matchCount: number
  /** そのファイルの中で上限に当たったか。 */
  readonly truncated: boolean
  /** 最初の一致（押したときに飛ぶ先）。 */
  readonly first: FileContentMatch
}

/** 一致1件。押すとその行・桁へ飛ぶ。 */
export interface FileContentMatchRow {
  readonly kind: 'match'
  readonly id: string
  readonly relativePath: string
  readonly name: string
  readonly match: FileContentMatch
}

export type FileContentSearchRow = FileContentFolderRow | FileContentFileRow | FileContentMatchRow

/**
 * 結果を行の並びへ展開する。
 *
 * フォルダの見出しは**連続する同じフォルダに対して1つ**だけ出す。Main は
 * 幅優先で走査して返す（main/files/searchWorkspaceFileContents.ts）ため、
 * 同じフォルダのファイルは必ず隣り合う。
 *
 * root 直下のファイルには見出しを出さない。相対位置が空文字であり、
 * `/` のような印を置いても「他とどう違う場所にあるか」を伝えないため
 * （名前の検索で場所を出さないのと同じ判断。FileSearch.tsx）。
 */
export function toFileContentSearchRows(
  files: readonly FileContentMatchFile[]
): readonly FileContentSearchRow[] {
  const rows: FileContentSearchRow[] = []
  let currentFolder: string | null = null

  for (const file of files) {
    const folder = parentRelativePath(file.relativePath) ?? ''

    if (folder !== currentFolder) {
      currentFolder = folder

      if (folder !== '') {
        rows.push({ kind: 'folder', id: `folder:${folder}`, label: folder })
      }
    }

    const first = file.matches[0]

    // 一致を持たないファイルは Main から返らないが、境界を越えてきた値として素直に信じない。
    if (first === undefined) {
      continue
    }

    rows.push({
      kind: 'file',
      id: `file:${file.relativePath}`,
      relativePath: file.relativePath,
      name: file.name,
      matchCount: file.matches.length,
      truncated: file.truncated,
      first
    })

    for (const match of file.matches) {
      rows.push({
        kind: 'match',
        // 同じ行に複数の一致があるため、桁まで含めて初めて一意になる。
        id: `match:${file.relativePath}:${match.line}:${match.column}`,
        relativePath: file.relativePath,
        name: file.name,
        match
      })
    }
  }

  return rows
}

/** 押せる行（上下キーで移動する対象）。見出しは飛ばす。 */
export function isFocusableContentRow(
  row: FileContentSearchRow
): row is FileContentFileRow | FileContentMatchRow {
  return row.kind !== 'folder'
}

/* ------------------------------------------------------------ 文言 */

/**
 * 打ち切りの理由の文言。
 *
 * 名前の検索（fileSearchModel.ts）と同じく**数を出す**。
 * 数の正本は shared/files/contentSearch.ts で、Main と同じ値を見ている。
 */
export function describeFileContentSearchLimit(limit: FileContentSearchLimit): string {
  switch (limit) {
    case 'matches':
      return `上限（${FILE_CONTENT_SEARCH_MAX_MATCHES} 件）まで表示しています。語を足すと絞り込めます`

    case 'files':
      return `ファイルが多いため、${FILE_CONTENT_SEARCH_MAX_FILES} 件まで読んで打ち切りました`

    case 'scanned':
      return 'ファイルが多いため、途中で打ち切りました（見つからない場合は場所を絞ってください）'

    case 'time':
      return '時間がかかりすぎたため、途中で打ち切りました'

    case 'depth':
      return `深い階層（${FILE_SEARCH_MAX_DEPTH} 段より下）は検索していません`

    case 'file-matches':
      return `1ファイルにつき ${FILE_CONTENT_SEARCH_MAX_MATCHES_PER_FILE} 件までを表示しています`
  }
}

/** 「3 件（2 ファイル）」。何件がどれだけのファイルに散っているかで、次の一手が変わる。 */
function describeFound(matchCount: number, fileCount: number): string {
  return `${matchCount} 件（${fileCount} ファイル）`
}

/**
 * 状態を1行で言い表す。
 *
 * 検索欄のすぐ下に出す文言で、結果の一覧とは別に持つ
 * （0 件・取り消し・失敗は、並べる行が無い状態でも伝える必要がある）。
 */
export function summarizeFileContentSearch(state: FileContentSearchState): string | null {
  switch (state.status) {
    case 'idle':
      return null

    case 'searching':
      return '検索中…'

    case 'done': {
      if (state.matchCount === 0) {
        // 「ファイルが無い」ではない ── 探したのは中身なので、そこを言い分ける。
        return '一致するテキストはありません'
      }

      const found = describeFound(state.matchCount, state.files.length)

      return state.limit === null
        ? found
        : `${found}・${describeFileContentSearchLimit(state.limit)}`
    }

    case 'cancelled':
      return state.matchCount === 0
        ? '検索を中止しました'
        : `検索を中止しました（${describeFound(state.matchCount, state.files.length)}まで）`

    case 'error':
      return state.message
  }
}
