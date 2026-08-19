import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WORKSPACE_ROOT_RELATIVE_PATH, type FileEntry, type FileEntryType } from '@shared/files'
import { fluvix } from '../api/fluvix'
import { applyChangesToDirectories, applyChangesToExpanded } from './fileChanges'
import { toFileTreeErrorReason } from './filesError'
import {
  ancestorRelativePaths,
  findEntryById,
  flattenFileTree,
  resolveCreateTarget,
  toggleExpanded,
  type DirectoryState,
  type FileTreeDirectories,
  type FileTreeDraft,
  type FileTreeRow
} from './fileTreeModel'

/**
 * ファイルツリーの状態を持ち、足りない分を Main へ取りに行く。
 *
 * Renderer 側でフォルダの列挙（`files:read-directory`）を呼ぶ唯一の場所。
 * 判断そのものは fileTreeModel.ts / fileChanges.ts の純粋関数が持ち、
 * ここが決めるのは **いつ読むか**だけ。
 *
 * files ドメインの IPC を呼ぶ場所は用途ごとに分かれている。
 *   このファイル        … フォルダの列挙と、変化を受けた読み直し
 *   files/useFileActions … 作成 / 改名 / 削除
 *   editor/useEditorTabs … ファイルの中身
 *
 * ## 読むのは「展開されたのに、まだ中身を知らないフォルダ」だけ
 *
 * 展開の操作と読み込みを直接つながずに、`expanded` と `directories` の差から
 * 導いている。この形にすると、
 *   - 展開の入口が増えても（キーボード操作・作成時の自動展開）読み込みの経路は1本のまま
 *   - 再読み込みは「読み込み済みを捨てる」だけで済み、どこを読み直すかを別に持たなくてよい
 * となり、状態の食い違いが起きる隙が減る。
 *
 * **作成 / 改名 / 削除の後もこの経路に乗せる。** Main からの `files:changed` を受けて
 * 変わったフォルダの欄を捨てるだけで、上の effect が読み直す。
 * ツリー全体を読み直さないため、Session 3-2 の Lazy Load はそのまま保たれる。
 *
 * ## Workspace が変わったときの破棄は呼び出し側が行う
 *
 * この hook は自分でリセットしない。FilesPanel が Workspace の id を key にして
 * ツリーごと作り直す（＝以前の Workspace の状態は React が破棄する）。
 * 「切り替わったら消す」処理を書くより、消し忘れが構造的に起きない。
 */

interface UseFileTreeInput {
  /** 今開いている Workspace の id。応答・通知が別の Workspace のものでないかの照合に使う。 */
  readonly workspaceId: string
  /** root 行に出す名前。 */
  readonly rootName: string
}

export interface FileTreeController {
  readonly rows: readonly FileTreeRow[]
  /** 選択中の行（FileEntry.id）。 */
  readonly selectedId: string | null
  /** 選択中のもの。今並んでいる行から導く（別に状態を持たない）。 */
  readonly selectedEntry: FileEntry | null
  /** 読み込み済みのフォルダの表。削除の確認文で「中身があるか」を見るのに使う。 */
  readonly directories: FileTreeDirectories
  /** 名前を入力している最中のもの。無ければ null。 */
  readonly draft: FileTreeDraft | null
  /** 展開・折りたたみ。 */
  readonly toggleDirectory: (relativePath: string) => void
  /** そのフォルダを開く（既に開いていれば何もしない）。作成時に作成先を見せるのに使う。 */
  readonly expandDirectory: (relativePath: string) => void
  /**
   * その位置をツリーの中で見せる（祖先を開いて選ぶ）。
   *
   * 検索結果を押したときの経路（Session 3-6-4）。**対象がフォルダでも中は開かない**
   * ── 選んだのは「その場所」であって、中を見る操作は別（fileTreeModel.ts）。
   */
  readonly revealEntry: (entry: FileEntry) => void
  /** 選択（フォルダ・ファイルとも）。 */
  readonly select: (id: string) => void
  /** 新しいものの名前の入力を始める。 */
  readonly startCreate: (parentRelativePath: string, entryType: FileEntryType) => void
  /** 名前の変更の入力を始める。 */
  readonly startRename: (entry: FileEntry) => void
  /** 入力をやめる。 */
  readonly cancelDraft: () => void
  /** そのフォルダを読み直す（失敗した行の再試行）。 */
  readonly reloadDirectory: (relativePath: string) => void
  /** 開いているフォルダをすべて読み直す。 */
  readonly reloadAll: () => void
}

/** 起動直後は root だけを開いた状態にする（Workspace 直下がすぐ見える）。 */
const INITIAL_EXPANDED: ReadonlySet<string> = new Set([WORKSPACE_ROOT_RELATIVE_PATH])
const EMPTY_DIRECTORIES: FileTreeDirectories = new Map()

export function useFileTree({ workspaceId, rootName }: UseFileTreeInput): FileTreeController {
  const [directories, setDirectories] = useState<FileTreeDirectories>(EMPTY_DIRECTORIES)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(INITIAL_EXPANDED)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<FileTreeDraft | null>(null)

  /**
   * 要求ごとの通し番号と、フォルダごとの「今有効な要求」。
   *
   * 応答は要求した順に返るとは限らず、読み直しを挟めば古い応答が後から届く。
   * 届いた時点で自分が最新かを確かめられるよう、フォルダ単位で持つ。
   *
   * **世代をツリー全体で1つにしない。** 1つにすると、あるフォルダの再試行が、
   * 別のフォルダの飛んでいる途中の要求まで無効にしてしまう
   * （そのフォルダは読み込み中のまま止まり、誰も読み直さない）。
   */
  const requestSeqRef = useRef(0)
  const activeRequestsRef = useRef(new Map<string, number>())
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  const applyState = useCallback((relativePath: string, state: DirectoryState): void => {
    setDirectories((previous) => {
      const next = new Map(previous)
      next.set(relativePath, state)
      return next
    })
  }, [])

  const load = useCallback(
    async (relativePath: string): Promise<void> => {
      requestSeqRef.current += 1
      const request = requestSeqRef.current
      activeRequestsRef.current.set(relativePath, request)

      const result = await fluvix.files.readDirectory({ relativePath })

      // 破棄された後・読み直しの後に届いた応答は、そのまま捨てる。
      if (!mountedRef.current || activeRequestsRef.current.get(relativePath) !== request) {
        return
      }

      if (!result.ok) {
        applyState(relativePath, {
          status: 'error',
          reason: toFileTreeErrorReason(result.error.code)
        })
        return
      }

      /*
        要求を出した後・応答が届く前に Workspace が切り替わった場合、
        中身は新しい Workspace のものになっている。今出しているツリーへ混ぜない。
        （切り替え自体は Provider 経由でこの後すぐ届き、ツリーごと作り直される）
      */
      if (result.data.workspaceId !== workspaceId) {
        return
      }

      applyState(relativePath, {
        status: 'ready',
        entries: result.data.entries,
        truncated: result.data.truncated
      })
    },
    [applyState, workspaceId]
  )

  // 展開されているのに中身を知らないフォルダを読む。
  useEffect(() => {
    const pending = [...expanded].filter((relativePath) => !directories.has(relativePath))

    if (pending.length === 0) {
      return
    }

    // 先に読み込み中として置く。これが無いと、この effect が
    // 応答が届くまで繰り返し走って同じ要求を何度も出す。
    setDirectories((previous) => {
      const next = new Map(previous)

      for (const relativePath of pending) {
        next.set(relativePath, { status: 'loading' })
      }

      return next
    })

    for (const relativePath of pending) {
      void load(relativePath)
    }
  }, [expanded, directories, load])

  /*
    ディスク側の変化への追従（Main → Renderer のイベント）。

    作成 / 改名 / 削除を行った当人（useFileActions.ts）から直接受け取らないのが要点。
    こうしておくと、後続のファイル変更監視（外部のエディタでの変更）も
    まったく同じ経路に乗り、ツリーの更新の書き方が1つで済む。

    **変わったフォルダの欄を消すだけ。** 読み直しは上の effect が拾う
    （fileChanges.ts）。読み込み済みでも展開もしていないフォルダの欄は消えるだけで、
    次に開かれたときに読まれる。
  */
  useEffect(() => {
    return fluvix.files.onChanged((event) => {
      if (event.workspaceId !== workspaceId) {
        return
      }

      setDirectories((previous) => applyChangesToDirectories(previous, event.changes))
      setExpanded((previous) => applyChangesToExpanded(previous, event.changes))
    })
  }, [workspaceId])

  const toggleDirectory = useCallback((relativePath: string): void => {
    setExpanded((previous) => toggleExpanded(previous, relativePath))
  }, [])

  const expandDirectory = useCallback((relativePath: string): void => {
    setExpanded((previous) => {
      if (previous.has(relativePath)) {
        return previous
      }

      const next = new Set(previous)
      next.add(relativePath)
      return next
    })
  }, [])

  const select = useCallback((id: string): void => {
    setSelectedId(id)
  }, [])

  /*
    検索結果から「そこを見せる」経路（Session 3-6-4）。

    **読み込みを直接始めない。** 祖先を開けば、上の effect が
    「展開されたのに中身を知らないフォルダ」として読む ── 深い場所を見せるために
    別の読み込み経路を作らないことで、Lazy Load の形がそのまま保たれる。
  */
  const revealEntry = useCallback((entry: FileEntry): void => {
    setExpanded((previous) => {
      const next = new Set(previous)

      for (const ancestor of ancestorRelativePaths(entry.relativePath)) {
        next.add(ancestor)
      }

      return next
    })

    setSelectedId(entry.id)
  }, [])

  const startCreate = useCallback(
    (parentRelativePath: string, entryType: FileEntryType): void => {
      // 作成先が畳まれていると、入力欄がどこにも現れない。
      expandDirectory(parentRelativePath)
      setDraft({ kind: 'create', parentRelativePath, entryType })
    },
    [expandDirectory]
  )

  const startRename = useCallback((entry: FileEntry): void => {
    setDraft({ kind: 'rename', relativePath: entry.relativePath, initialName: entry.name })
  }, [])

  const cancelDraft = useCallback((): void => {
    setDraft(null)
  }, [])

  /*
    読み直しに専用の処理は要らない。読み込み済みを忘れれば、上の effect が
    「展開されているのに中身を知らないフォルダ」として読み直す。
    そのとき新しい要求番号が振られるため、飛んでいる途中の古い応答は捨てられる。
  */
  const reloadDirectory = useCallback((relativePath: string): void => {
    setDirectories((previous) => {
      const next = new Map(previous)
      next.delete(relativePath)
      return next
    })
  }, [])

  const reloadAll = useCallback((): void => {
    // 展開状態は保つ。読み直すたびにツリーが畳まれると、
    // 見ていた場所を毎回開き直すことになる。
    setDirectories(EMPTY_DIRECTORIES)
  }, [])

  const rows = useMemo(
    () => flattenFileTree({ rootName, directories, expanded, draft }),
    [rootName, directories, expanded, draft]
  )

  const selectedEntry = useMemo(() => findEntryById(rows, selectedId), [rows, selectedId])

  return {
    rows,
    selectedId,
    selectedEntry,
    directories,
    draft,
    toggleDirectory,
    expandDirectory,
    select,
    revealEntry,
    startCreate,
    startRename,
    cancelDraft,
    reloadDirectory,
    reloadAll
  }
}

/** 選択から作成先のフォルダを導く（fileTreeModel.ts の判断をそのまま使う）。 */
export { resolveCreateTarget }
