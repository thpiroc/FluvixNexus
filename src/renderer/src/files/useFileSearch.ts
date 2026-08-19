import { useCallback, useEffect, useRef, useState } from 'react'
import { FILE_SEARCH_ID_MAX_LENGTH } from '@shared/files'
import { fluvix } from '../api/fluvix'
import { describeFileSearchError } from './filesError'
import type { FileSearchState } from './fileSearchModel'

/**
 * プロジェクト全体検索の状態を持ち、Main へ探しに行く（Session 3-6-4）。
 *
 * Renderer 側で `files:search` を呼ぶ唯一の場所。状態の意味づけは
 * fileSearchModel.ts（純粋）が持ち、ここが決めるのは **いつ送るか / いつ止めるか**だけ
 * ── useFileTree.ts が「いつ読むか」だけを持っているのと同じ分担にしてある。
 *
 * ## Renderer は Workspace を歩かない
 *
 * 列挙（`files:read-directory`）を繰り返して自前で再帰する経路をここに作らない。
 * 走査は Main が持ち（main/files/searchWorkspaceFiles.ts）、Renderer が知るのは
 * 検索語と、返ってきた相対位置だけになる。**上限も取り消しも Main 側が正本**で、
 * ここはその結末を状態として持つに留める。
 *
 * ## 打つたびに探し、古い検索は捨てる
 *
 * 入力が止まってから送る（DEBOUNCE_MS）。それでも要求は前後しうるため、
 * **自分が今待っている検索の識別子**を控え、違うものの応答は捨てる
 * （useFileTree.ts がフォルダごとに要求番号を持っているのと同じ考え方）。
 *
 * Main 側でも新しい検索が古い検索を止める（workspaceSearchSession.ts）。
 * 片方だけでは足りない ── Main 側だけだと**古い応答が新しい結果を上書き**しうるし、
 * Renderer 側だけだと**捨てる結果のためにディスクを舐め続ける**ことになる。
 *
 * ## Workspace が変わったら捨てる
 *
 * この hook を持つ画面は Workspace の id を key にして作り直される（FilesPanel.tsx）。
 * 破棄のときに走っている検索を取り消す ── Main 側も Workspace の切り替えで
 * 捨てるが（ipc/handlers/files.ts）、**閉じる操作と検索が前後した場合**に
 * 取り消しを送る側が居なくなる形を作らない。
 */

/** 入力が止まってから送るまでの時間（ミリ秒）。 */
const DEBOUNCE_MS = 200

export interface FileSearchController {
  /** 入力欄の値（状態の query とは別。打っている途中は先に進む）。 */
  readonly query: string
  readonly state: FileSearchState
  /** 検索語を変える（少し待ってから検索が始まる）。 */
  readonly setQuery: (value: string) => void
  /** 待たずに今すぐ探す（Enter）。 */
  readonly searchNow: () => void
  /** 走っている検索を止める。 */
  readonly cancel: () => void
  /** 検索語も結果も捨てる。 */
  readonly clear: () => void
}

const IDLE: FileSearchState = { status: 'idle' }

export function useFileSearch(workspaceId: string): FileSearchController {
  const [query, setQueryValue] = useState('')
  const [state, setState] = useState<FileSearchState>(IDLE)

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
   * 識別子を添えるので、**入れ違いで始まった新しい検索は止まらない**。
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
        識別子は Workspace の id と通し番号の組。長さの上限（契約）に収まる形にしてある。
        Workspace を跨いで同じ識別子が出ないため、切り替えの前後で
        取り消しの相手を間違えない。
      */
      const searchId = `${workspaceId}#${searchSeqRef.current}`.slice(0, FILE_SEARCH_ID_MAX_LENGTH)

      activeSearchIdRef.current = searchId
      setState({ status: 'searching', query: value })

      const result = await fluvix.files.search({ searchId, query: value })

      // 破棄された後・別の検索に置き換わった後に届いた応答は、そのまま捨てる。
      if (!mountedRef.current || activeSearchIdRef.current !== searchId) {
        return
      }

      activeSearchIdRef.current = null

      if (!result.ok) {
        setState({ status: 'error', query: value, message: describeFileSearchError(result.error) })
        return
      }

      /*
        要求を出した後・応答が届く前に Workspace が切り替わった場合、結果は
        新しい Workspace のものになっている（列挙と同じ照合。useFileTree.ts）。
      */
      if (result.data.workspaceId !== workspaceId || result.data.searchId !== searchId) {
        return
      }

      if (result.data.status === 'cancelled') {
        // 利用者が止めた場合。見つかっていたぶんはそのまま見せる。
        setState({ status: 'cancelled', query: value, matches: result.data.matches })
        return
      }

      setState({
        status: 'done',
        query: value,
        matches: result.data.matches,
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
