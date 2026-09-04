import { useCallback, useEffect, useRef, useState } from 'react'
import { FILE_SEARCH_ID_MAX_LENGTH } from '@shared/files'
import { fluvix } from '../api/fluvix'
import type { FileContentSearchState } from './fileContentSearchModel'

/**
 * 全文検索の状態を持ち、Main へ探しに行く（Session 3-6-5）。
 *
 * Renderer 側で `files:search-content` を呼ぶ唯一の場所。状態の意味づけは
 * fileContentSearchModel.ts（純粋）が持ち、ここが決めるのは
 * **いつ送るか / いつ止めるか**だけ ── useFileSearch.ts と同じ分担にしてある。
 *
 * ## useFileSearch.ts と1つにまとめていない
 *
 * 送る先・受け取る形・状態の型がすべて違うため、1つにすると「モードによって
 * 状態の型が変わる hook」になる。読む側（FileSearch.tsx）では結局どちらかに
 * 絞り込む必要があり、共有できるのは debounce の時間くらいしか残らない。
 *
 * **守りたい不変条件（同時に走るのは1本・新しい検索が古い検索を止める）は
 * Renderer 側の共有では守られない。** 守っているのは Main の
 * workspaceSearchSession.ts で、名前の検索と全文検索は**同じ管理**を通る
 * （main/ipc/handlers/files.ts）── モードを切り替えた瞬間に前のモードの検索が
 * 止まるのはそのため。取り消しのチャンネル（`files:cancel-search`）も共有している。
 *
 * ## 待ってから送る
 *
 * 全文検索は1件ずつ開いて読むため、名前の検索より1回が重い。待つ時間を
 * 長めに取ってあるのはそのためで（DEBOUNCE_MS）、打っている途中の語で
 * Workspace 全体を読み始めない。
 *
 * ## Workspace が変わったら捨てる
 *
 * この hook を持つ画面は Workspace の id を key にして作り直される（FilesPanel.tsx）。
 * 破棄のときに走っている検索を取り消す（useFileSearch.ts と同じ理由）。
 */

/**
 * 入力が止まってから送るまでの時間（ミリ秒）。
 *
 * 名前の検索（200ms）より長い。1回の重さが違う ── 打鍵ごとに Workspace 全体を
 * 読み始めると、実際に探したい語にたどり着く前にディスクを何度も舐めることになる。
 */
const DEBOUNCE_MS = 400

export interface FileContentSearchController {
  /** 入力欄の値（状態の query とは別。打っている途中は先に進む）。 */
  readonly query: string
  readonly state: FileContentSearchState
  /** 検索語を変える（少し待ってから検索が始まる）。 */
  readonly setQuery: (value: string) => void
  /** 待たずに今すぐ探す（Enter）。 */
  readonly searchNow: () => void
  /** 走っている検索を止める。 */
  readonly cancel: () => void
  /** 検索語も結果も捨てる。 */
  readonly clear: () => void
}

const IDLE: FileContentSearchState = { status: 'idle' }

export function useFileContentSearch(workspaceId: string): FileContentSearchController {
  const [query, setQueryValue] = useState('')
  const [state, setState] = useState<FileContentSearchState>(IDLE)

  /** 今待っている検索の識別子。待っていなければ null。 */
  const activeSearchIdRef = useRef<string | null>(null)
  /** 識別子の通し番号。 */
  const searchSeqRef = useRef(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const clearDebounce = useCallback((): void => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [])

  /**
   * 走っている検索を Main 側で止める。
   *
   * 応答（`'cancelled'`）は走っている invoke の側に返るため、ここでは待たない。
   * 識別子を添えるので、入れ違いで始まった新しい検索は止まらない。
   */
  const cancelActive = useCallback((): void => {
    const searchId = activeSearchIdRef.current

    if (searchId === null) {
      return
    }

    void fluvix.files.cancelSearch({ searchId })
  }, [])

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      clearDebounce()
      // Workspace の切り替え / Close。走っているものは捨てる。
      cancelActive()
    }
  }, [clearDebounce, cancelActive])

  const runSearch = useCallback(
    async (value: string): Promise<void> => {
      searchSeqRef.current += 1

      /*
        識別子は Workspace の id と通し番号の組（名前の検索と同じ作り方）。
        頭に `c` を付けて**同じ Workspace で同じ識別子が2つ出ない**ようにしてある
        ── 止める相手は Main 側で1本に絞られているため、
        名前の検索と番号がぶつかると、止めるつもりのない検索を止めうる。
      */
      const searchId = `c${workspaceId}#${searchSeqRef.current}`.slice(0, FILE_SEARCH_ID_MAX_LENGTH)

      activeSearchIdRef.current = searchId
      setState({ status: 'searching', query: value })

      const result = await fluvix.files.searchContent({ searchId, query: value })

      // 破棄された後・別の検索に置き換わった後に届いた応答は、そのまま捨てる。
      if (!mountedRef.current || activeSearchIdRef.current !== searchId) {
        return
      }

      activeSearchIdRef.current = null

      if (!result.ok) {
        // 文言ではなく失敗そのものを持つ（言い表すのは描くとき。fileContentSearchModel.ts）。
        setState({ status: 'error', query: value, error: result.error })
        return
      }

      // 要求を出した後・応答が届く前に Workspace が切り替わっていたら捨てる。
      if (result.data.workspaceId !== workspaceId || result.data.searchId !== searchId) {
        return
      }

      if (result.data.status === 'cancelled') {
        // 利用者が止めた場合。見つかっていたぶんはそのまま見せる。
        setState({
          status: 'cancelled',
          query: value,
          files: result.data.files,
          matchCount: result.data.matchCount
        })
        return
      }

      setState({
        status: 'done',
        query: value,
        files: result.data.files,
        matchCount: result.data.matchCount,
        truncated: result.data.truncated,
        limit: result.data.limit
      })
    },
    [workspaceId]
  )

  const setQuery = useCallback(
    (value: string): void => {
      setQueryValue(value)
      clearDebounce()

      // 空にしたら、走っているものを止めて何も出していない状態へ戻す。
      if (value === '') {
        cancelActive()
        activeSearchIdRef.current = null
        setState(IDLE)
        return
      }

      debounceRef.current = setTimeout(() => {
        debounceRef.current = null
        void runSearch(value)
      }, DEBOUNCE_MS)
    },
    [clearDebounce, cancelActive, runSearch]
  )

  /** 待たずに探す。打ち終えているのに待たされる、を起こさないための入口。 */
  const searchNow = useCallback((): void => {
    clearDebounce()

    if (query === '') {
      return
    }

    void runSearch(query)
  }, [clearDebounce, query, runSearch])

  const cancel = useCallback((): void => {
    clearDebounce()
    cancelActive()
  }, [clearDebounce, cancelActive])

  const clear = useCallback((): void => {
    setQuery('')
  }, [setQuery])

  return { query, state, setQuery, searchNow, cancel, clear }
}
