import {
  FILE_SEARCH_MAX_DEPTH,
  FILE_SEARCH_MAX_RESULTS,
  type FileEntry,
  type FileSearchLimit
} from '@shared/files'

/**
 * 検索の状態と、その状態を1行で言い表す文言（React にも DOM にも依存しない）。
 *
 * fileTreeModel.ts がツリーに対して担っているのと同じ立ち位置で、
 * **画面に出す判断をデータとして決める**のがここ。
 * useFileSearch.ts は状態を持ち、FileSearch.tsx は並べるだけになる。
 *
 * ## 状態を5つに分ける
 *
 * 「検索中 / 0 件 / 取り消した / 打ち切った / 失敗した」は、利用者にとって
 * **次の一手がそれぞれ違う**。0 件なら語を変える、打ち切りなら絞り込む、
 * 失敗ならもう一度試す ── ここを1つの「結果がありません」にまとめると、
 * 待てば出るのか、探し方が悪いのか、壊れているのかが画面から決まらなくなる。
 *
 * 取り消しを結果の状態として持っているのは、**途中まで見つけたものを消さない**ため。
 * 止めた時点の結果はそのまま使える（Main も見つけたぶんを返す）。
 */

export type FileSearchState =
  /** まだ何も探していない（検索語が空）。 */
  | { readonly status: 'idle' }
  /** 走っている最中。 */
  | { readonly status: 'searching'; readonly query: string }
  /** 最後まで見た。matches が空なら 0 件。 */
  | {
      readonly status: 'done'
      readonly query: string
      readonly matches: readonly FileEntry[]
      /** 上限に当たって全部は見ていないか。 */
      readonly truncated: boolean
      readonly limit: FileSearchLimit | null
    }
  /** 途中で止めた（利用者の操作）。そこまでに見つけたものは残す。 */
  | {
      readonly status: 'cancelled'
      readonly query: string
      readonly matches: readonly FileEntry[]
    }
  /** 探せなかった。 */
  | { readonly status: 'error'; readonly query: string; readonly message: string }

/** その状態で画面に出ている結果（結果を持たない状態では空）。 */
export function searchMatchesOf(state: FileSearchState): readonly FileEntry[] {
  return state.status === 'done' || state.status === 'cancelled' ? state.matches : []
}

/**
 * 打ち切りの理由の文言。
 *
 * **数を出す**のは、利用者が次に何をすればよいかが数で決まるため
 * （「500 件まで」と分かれば語を足す判断ができる）。
 * 数の正本は shared/files/search.ts で、Main と同じ値を見ている。
 */
export function describeFileSearchLimit(limit: FileSearchLimit): string {
  switch (limit) {
    case 'results':
      return `上限（${FILE_SEARCH_MAX_RESULTS} 件）まで表示しています。語を足すと絞り込めます`

    case 'scanned':
      return 'ファイルが多いため、途中で打ち切りました（見つからない場合は場所を絞ってください）'

    case 'time':
      return '時間がかかりすぎたため、途中で打ち切りました'

    case 'depth':
      return `深い階層（${FILE_SEARCH_MAX_DEPTH} 段より下）は検索していません`
  }
}

/**
 * 状態を1行で言い表す。
 *
 * 検索欄のすぐ下に出す文言で、**結果の一覧そのものとは別に持つ**
 * （0 件・取り消し・失敗は、並べる行が無い状態でも伝える必要がある）。
 */
export function summarizeFileSearch(state: FileSearchState): string | null {
  switch (state.status) {
    case 'idle':
      return null

    case 'searching':
      return '検索中…'

    case 'done': {
      if (state.matches.length === 0) {
        return '一致するファイルはありません'
      }

      const found = `${state.matches.length} 件`

      return state.limit === null ? found : `${found}・${describeFileSearchLimit(state.limit)}`
    }

    case 'cancelled':
      return state.matches.length === 0
        ? '検索を中止しました'
        : `検索を中止しました（${state.matches.length} 件まで）`

    case 'error':
      return state.message
  }
}
