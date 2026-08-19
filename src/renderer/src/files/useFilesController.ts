import { useCallback, useEffect, useRef, useState } from 'react'
import { WORKSPACE_ROOT_RELATIVE_PATH, type FileEntry, type FileEntryType } from '@shared/files'
import type { WorkspaceFolder } from '@shared/workspace'
import { useEditorContext } from '../editor/context'
import { canPasteInto, type FilesClipboard } from './clipboard'
import type { FilesDragMode } from './dragDrop'
import type { FileContextMenuTarget } from './FileContextMenu'
import { activeDirectoryFor, clampActiveDirectory, columnDirectories } from './filesColumnsModel'
import type { FilesLayoutMode } from './filesLayoutMode'
import { canMoveInto } from './moveTarget'
import { useFileActions, type FileActionsController } from './useFileActions'
import { useFileDrag, type FileDragController } from './useFileDrag'
import { useFileTree, type FileTreeController } from './useFileTree'

/**
 * Files パネルの中身の状態と操作を1か所に集める（Session 3-6-7）。
 *
 * ツリー（FileTree.tsx）とカラム（FileColumns.tsx）は**この controller の
 * 別々の描き方**でしかない。以前は同じ内容が FileTree.tsx の中にあったが、
 * 表示方式が2つになったので、
 *
 *   ここ                 … 状態と操作（何が起きるか）
 *   FileTree / FileColumns … 並べ方と当たり判定（どう見えるか）
 *   FilesExplorer.tsx     … 器（ツールバー・帯・メニュー・確認・ドラッグの表示）
 *
 * に分けてある。**表示方式ごとに操作を書かない**のが要点で、2箇所に書くと
 * 「カラムでは移動先が畳まれたままになる」「ツリーでは作成後に選択が移らない」
 * のような差が表示方式ごとに生まれる。
 *
 * ## Files のデータモデルは1つ
 *
 * 読むのは useFileTree.ts（`directories` / `expanded`）、書き換えるのは
 * useFileActions.ts。どちらも Session 3-2 / 3-3 / 3-6-1〜3 のままで、
 * カラム表示のために新しい Main 側の経路も、新しい Files の状態も足していない。
 *
 * カラム表示が足しているのは `activeDirectory`（一番右のカラムが見せている
 * フォルダ）1つだけ。列の並びはそこから導く（filesColumnsModel.ts）。
 *
 * ## Lazy Load はそのまま
 *
 * カラムを開くことは**そのフォルダを展開すること**として表す。読み込みは
 * 「展開されたのに中身を知らないフォルダを読む」という既存の1本の経路が拾う
 * （useFileTree.ts）。この形にしてあるため、
 *
 *   - Workspace 全体の先読みは起きない（開いたカラムの分だけ読む）
 *   - ツリーとカラムで**読み込み済みの中身が共有される**（同じ `directories`）
 *   - 表示方式を切り替えても読み直しにならない
 *
 * ## Workspace が変わったとき
 *
 * この hook は自分でリセットしない。FilesPanel が Workspace の id を key にして
 * 中身ごと作り直すため、選んでいた位置も、開いていたカラムも、移動 / コピーの
 * 途中の状態も React が破棄する（ARCHITECTURE.md §9.6）。
 * **表示方式（ツリー / カラム）だけは key の外側**にあり、パネルの見え方として
 * 残る（useFilesLayout.ts）── それは Workspace の持ち物ではないため。
 */

export interface FilesController {
  readonly workspace: WorkspaceFolder
  /** 読む側（行の並び・展開・選択・読み込み済みの中身）。 */
  readonly tree: FileTreeController
  /** 書き換える側（作成 / 改名 / 移動 / コピー / 削除）。 */
  readonly actions: FileActionsController
  /** 掴んで落とす（当たり判定と追跡）。 */
  readonly drag: FileDragController

  /** 一番右のカラムが見せているフォルダ（カラム表示。root は空文字）。 */
  readonly activeDirectory: string

  /** 移動しようとしているもの。決めていなければ null。 */
  readonly pendingMove: FileEntry | null
  /** コピーの控え。控えていなければ null。 */
  readonly clipboard: FilesClipboard | null
  /** 直前のコピーでとばした件数。とばしていなければ null。 */
  readonly copyNotice: { readonly name: string; readonly skippedCount: number } | null
  /** 開いている右クリックメニュー。 */
  readonly menu: FileContextMenuTarget | null
  /** 削除の確認を出している対象。 */
  readonly pendingDelete: FileEntry | null

  /** ドロップ先として案内しているフォルダ行（案内していなければ null）。 */
  readonly dropDirectory: string | null
  /** ドロップ先として案内している余白のフォルダ（案内していなければ null）。 */
  readonly dropSurface: string | null

  /** ツリーでの決定（フォルダは開閉、ファイルは Editor）。 */
  readonly activateInTree: (entry: FileEntry) => void
  /** カラムでの決定（フォルダは右のカラム、ファイルは Editor）。 */
  readonly activateInColumns: (entry: FileEntry) => void
  /** そのフォルダをカラムとして開く。 */
  readonly openDirectory: (relativePath: string) => void
  /** ファイルを Editor で開く（右クリックの「開く」）。 */
  readonly openEntry: (entry: FileEntry) => void

  readonly startCreate: (parentRelativePath: string, entryType: FileEntryType) => void
  readonly commitCreate: (
    parentRelativePath: string,
    entryType: FileEntryType,
    name: string
  ) => Promise<boolean>
  readonly startRename: (entry: FileEntry) => void
  readonly commitRename: (relativePath: string, name: string) => Promise<boolean>
  readonly requestDelete: (entry: FileEntry) => void
  readonly confirmDelete: () => Promise<void>
  readonly cancelDelete: () => void

  readonly startMove: (entry: FileEntry) => void
  readonly cancelMove: () => void
  readonly moveInto: (destinationRelativePath: string) => Promise<void>
  readonly startCopy: (entry: FileEntry) => void
  readonly clearClipboard: () => void
  readonly pasteInto: (destinationRelativePath: string) => Promise<void>
  readonly dismissCopyNotice: () => void

  readonly openMenu: (target: FileContextMenuTarget) => void
  readonly closeMenu: () => void
}

interface UseFilesControllerInput {
  readonly workspace: WorkspaceFolder
  /** 今出している表示方式（カラムの読み込みはこれが 'columns' のときだけ動く）。 */
  readonly mode: FilesLayoutMode
  /** 検索結果から指された場所（無ければ null。Session 3-6-4）。 */
  readonly revealTarget: FileEntry | null
}

export function useFilesController({
  workspace,
  mode,
  revealTarget
}: UseFilesControllerInput): FilesController {
  const tree = useFileTree({ workspaceId: workspace.id, rootName: workspace.displayName })
  const actions = useFileActions()
  const { openFile } = useEditorContext()

  const [menu, setMenu] = useState<FileContextMenuTarget | null>(null)
  /** 削除の確認を出している対象。出していなければ null。 */
  const [pendingDelete, setPendingDelete] = useState<FileEntry | null>(null)
  /**
   * 移動しようとしているもの。決めていなければ null。
   *
   * 移動は2手（動かすものを決める → 行き先のフォルダを選ぶ）に分けてあり、
   * その途中の状態がこれにあたる（FileContextMenu.tsx）。
   *
   * **ツリーの状態ではない。** だから useFileTree ではなくここが持つ ── 移動先を
   * 選ぶ前に別の Workspace へ切り替われば、中身ごと作り直されて自然に消える。
   */
  const [pendingMove, setPendingMove] = useState<FileEntry | null>(null)
  /**
   * コピーの控え。控えていなければ null（clipboard.ts）。
   *
   * pendingMove とまったく同じ扱いにしてある。
   * **OS のクリップボードには載せない**（Renderer は絶対パスを持たない）。
   */
  const [clipboard, setClipboard] = useState<FilesClipboard | null>(null)
  /**
   * 直前のコピーでとばした件数（リンクなど）。とばしていなければ null。
   *
   * 失敗ではないので actions.error には載せず、別に持つ。
   * **成功しても中身が欠けている**ことは、黙っているより伝える方がよい。
   */
  const [copyNotice, setCopyNotice] = useState<{ name: string; skippedCount: number } | null>(null)

  /**
   * 一番右のカラムが見せているフォルダ（カラム表示。Session 3-6-7）。
   *
   * **カラム表示が足している唯一の状態。** 列の並びはここから導く
   * （filesColumnsModel.ts）ので、「別のフォルダを選んだら右側を捨てる」のための
   * 処理を持たない。ツリーの展開状態（`expanded`）とは別に持つのは、
   * 「どこまで開いているか」と「どの1本を横に並べているか」が別のことだから。
   */
  const [activeDirectory, setActiveDirectory] = useState<string>(WORKSPACE_ROOT_RELATIVE_PATH)

  const { expandDirectory, select, revealEntry, selectedEntry } = tree

  /**
   * そのフォルダをカラムとして開く。
   *
   * **展開もする。** カラムを開くことをツリーの展開として表しておくと、
   *   - 読み込みが既存の1本の経路に乗る（Lazy Load。useFileTree.ts）
   *   - ツリーへ切り替えたときに、同じ場所が開いた状態で見える
   * の2つが同時に成り立つ。
   */
  const openDirectory = useCallback(
    (relativePath: string): void => {
      setActiveDirectory(relativePath)
      expandDirectory(relativePath)
    },
    [expandDirectory]
  )

  /*
    カラムに出ているフォルダは、開いた状態を保つ。

    読み込みの依頼は「展開されているのに中身を知らないフォルダを読む」という
    既存の経路しかない（useFileTree.ts）ため、途中のフォルダが変化の通知で
    畳まれた場合（fileChanges.ts）に、そのカラムが読み込み中のまま止まらないように
    ここで開き直す。**カラム表示のときだけ**動かすのは、ツリーで畳んだフォルダを
    横から開き直さないため。
  */
  useEffect(() => {
    if (mode !== 'columns') {
      return
    }

    for (const relativePath of columnDirectories(activeDirectory)) {
      expandDirectory(relativePath)
    }
  }, [mode, activeDirectory, tree.directories, expandDirectory])

  /*
    ツリーからカラムへ切り替えたとき、見ていた場所を引き継ぐ。

    ツリーの「展開しているフォルダ」は枝分かれした集合で、カラムの列は
    root から1本の道。**集合から道は決まらない**ので、選んでいるものを起点にする
    （フォルダならそこ、ファイルならそれを含むフォルダ）。

    逆向き（カラム → ツリー）に同じ処理が要らないのは、カラムを開くことが
    そのままツリーの展開になっているため（上の openDirectory）── 切り替えた時点で
    同じ場所が開いて見える。

    切り替えた瞬間だけ動かす。毎回の描画で選択に追従させると、左のカラムで
    ファイルを選び直すたびに右のカラムが畳まれ、**見比べる**ことができなくなる。
  */
  const previousModeRef = useRef(mode)

  useEffect(() => {
    const changed = previousModeRef.current !== mode
    previousModeRef.current = mode

    if (!changed || mode !== 'columns' || selectedEntry === null) {
      return
    }

    setActiveDirectory(activeDirectoryFor(selectedEntry.relativePath, selectedEntry.type))
  }, [mode, selectedEntry])

  /*
    消えたフォルダから右のカラムは捨てる。

    削除の操作から直接畳まず、**読み直した結果**（`directories`）から決める
    ── アプリの外での削除も同じ経路で届くため、入口が増えても畳み方は1つで済む。
  */
  useEffect(() => {
    const clamped = clampActiveDirectory(tree.directories, activeDirectory)

    if (clamped !== activeDirectory) {
      setActiveDirectory(clamped)
    }
  }, [tree.directories, activeDirectory])

  /*
    検索結果から指された場所を見せる（Session 3-6-4）。

    ツリーは祖先を開いて選び、カラムはその位置を含むフォルダまで列を伸ばす。
    **どちらも読み込みは既存の経路（展開 → 読む）が拾う。**
  */
  useEffect(() => {
    if (revealTarget === null) {
      return
    }

    revealEntry(revealTarget)
    setActiveDirectory(activeDirectoryFor(revealTarget.relativePath, revealTarget.type))
  }, [revealTarget, revealEntry])

  /* ------------------------------------------------------------ 開く */

  const openEntry = useCallback(
    (entry: FileEntry): void => {
      openFile({ relativePath: entry.relativePath, name: entry.name })
    },
    [openFile]
  )

  /**
   * 行のどこを押しても同じ結果にする。
   *
   * **表示方式で違うのはフォルダを押したときだけ** ── ツリーは開閉し、
   * カラムは右隣のカラムとして出す。ファイルはどちらも同じ `openFile` を通る
   * （editor/context.ts）。Files が Editor を知っている範囲はこの1つだけ。
   */
  const activateInTree = useCallback(
    (entry: FileEntry): void => {
      select(entry.id)

      if (entry.type === 'directory') {
        tree.toggleDirectory(entry.relativePath)
        return
      }

      openEntry(entry)
    },
    [select, tree, openEntry]
  )

  const activateInColumns = useCallback(
    (entry: FileEntry): void => {
      select(entry.id)

      if (entry.type === 'directory') {
        openDirectory(entry.relativePath)
        return
      }

      openEntry(entry)
    },
    [select, openDirectory, openEntry]
  )

  /* -------------------------------------------------- 作成 / 改名 / 削除 */

  const startCreate = useCallback(
    (parentRelativePath: string, entryType: FileEntryType): void => {
      actions.dismissError()
      tree.startCreate(parentRelativePath, entryType)

      /*
        カラム表示では、作成先のフォルダのカラムが出ていないと入力欄が見えない
        （ツリーで作成先を展開しているのと同じ扱い。useFileTree.ts の startCreate）。
      */
      setActiveDirectory(parentRelativePath)
    },
    [actions, tree]
  )

  /*
    確定できたかを返す。**入力欄はこの答えで自分の状態を戻す**（FileNameInput.tsx）ため、
    失敗の経路でも必ず false が返ること（＝返し忘れないこと）が要点になる。
  */
  const commitCreate = useCallback(
    async (
      parentRelativePath: string,
      entryType: FileEntryType,
      name: string
    ): Promise<boolean> => {
      const entry = await actions.create({ parentRelativePath, name, type: entryType })

      // 失敗したら入力欄を閉じない。打ち直せば済むのに閉じると、
      // 名前を最初から入れ直すことになる（理由はエラー行に出ている）。
      if (entry === null) {
        return false
      }

      tree.cancelDraft()
      // 作ったものを選んでおく。続けて開く / 名前を変えるのがそのまま行える。
      select(entry.id)
      return true
    },
    [actions, tree, select]
  )

  const startRename = useCallback(
    (entry: FileEntry): void => {
      actions.dismissError()
      tree.startRename(entry)
    },
    [actions, tree]
  )

  const commitRename = useCallback(
    async (relativePath: string, name: string): Promise<boolean> => {
      const entry = await actions.rename({ relativePath, name })

      if (entry === null) {
        return false
      }

      tree.cancelDraft()
      select(entry.id)
      return true
    },
    [actions, tree, select]
  )

  const requestDelete = useCallback(
    (entry: FileEntry): void => {
      actions.dismissError()
      setPendingDelete(entry)
    },
    [actions]
  )

  const confirmDelete = useCallback(async (): Promise<void> => {
    if (pendingDelete === null) {
      return
    }

    const removed = await actions.remove({ relativePath: pendingDelete.relativePath })

    // 失敗しても確認を出したままにしない。理由はエラー行に出る。
    setPendingDelete(null)

    if (removed && tree.selectedId === pendingDelete.id) {
      // 消したものを選んだままにしない（行はもう無い）。
      select(`d:${WORKSPACE_ROOT_RELATIVE_PATH}`)
    }
  }, [pendingDelete, actions, tree.selectedId, select])

  const cancelDelete = useCallback((): void => {
    setPendingDelete(null)
  }, [])

  /* ------------------------------------------------------------ 移動 */

  const startMove = useCallback(
    (entry: FileEntry): void => {
      actions.dismissError()
      // 名前を打っている最中に移動を始めたら、入力は捨てる（両方は受け付けない）。
      tree.cancelDraft()
      // 「次に何かする」状態は一度に1つだけ持つ（下の startCopy と同じ理由）。
      setClipboard(null)
      setPendingMove(entry)
    },
    [actions, tree]
  )

  const cancelMove = useCallback((): void => {
    setPendingMove(null)
  }, [])

  /**
   * そのフォルダへ動かす（成功したかを返す）。
   *
   * **右クリックの2手・ドラッグ&ドロップ・ツリー・カラムの共通の出口。**
   * 入口が増えても、動かすこと自体は1箇所にしか書かない ── 2箇所に書くと
   * 「カラムでは行き先が開かない」のような差が入口ごとに生まれる。
   */
  const performMove = useCallback(
    async (source: FileEntry, destinationRelativePath: string): Promise<boolean> => {
      if (!canMoveInto(source, destinationRelativePath)) {
        return false
      }

      const entry = await actions.move({
        relativePath: source.relativePath,
        toParentRelativePath: destinationRelativePath
      })

      if (entry === null) {
        return false
      }

      /*
        動かした先が畳まれていると、どこへ行ったのかが画面から分からない。

        **カラム表示でも同じことをする。** あちらで「畳まれている」にあたるのは
        行き先のカラムが出ていない状態で、そのときは動かしたものが画面のどこにも
        現れない（列は1本の道しか出せないため。filesColumnsModel.ts）。
        ツリーで展開するのと同じ理由で、行き先を一番右のカラムにする。
      */
      expandDirectory(destinationRelativePath)
      setActiveDirectory(destinationRelativePath)
      select(entry.id)

      return true
    },
    [actions, expandDirectory, select]
  )

  /**
   * 決めておいたものを、そのフォルダへ動かす。
   *
   * **成功したときだけ移動の状態を解く。** 失敗の中身は「行き先に同名のものがあった」
   * 「使用中だった」で、どちらも**別のフォルダを選び直せば通る**。
   */
  const moveInto = useCallback(
    async (destinationRelativePath: string): Promise<void> => {
      if (pendingMove === null) {
        return
      }

      if (await performMove(pendingMove, destinationRelativePath)) {
        setPendingMove(null)
      }
    },
    [pendingMove, performMove]
  )

  /* ---------------------------------------------------------- コピー */

  /**
   * コピーするものを控える（この時点では何も起きない）。
   *
   * **「次に何かする」状態は一度に1つだけ持つ。** 移動の途中でコピーを始めたら
   * 移動の方は解く（逆も同じ。startMove）。
   */
  const startCopy = useCallback(
    (entry: FileEntry): void => {
      actions.dismissError()
      setCopyNotice(null)
      // 名前を打っている最中に始めたら、入力は捨てる（移動と同じ）。
      tree.cancelDraft()
      setPendingMove(null)
      setClipboard({ mode: 'copy', entry })
    },
    [actions, tree]
  )

  const clearClipboard = useCallback((): void => {
    setClipboard(null)
  }, [])

  const dismissCopyNotice = useCallback((): void => {
    setCopyNotice(null)
  }, [])

  /** そのフォルダへ複製する（成功したかを返す）。performMove と同じ立ち位置。 */
  const performCopy = useCallback(
    async (source: FileEntry, destinationRelativePath: string): Promise<boolean> => {
      setCopyNotice(null)

      const result = await actions.copy({
        relativePath: source.relativePath,
        toParentRelativePath: destinationRelativePath
      })

      if (result === null) {
        return false
      }

      // 複製できずにとばしたものがあれば、成功していても伝える。
      if (result.skippedCount > 0) {
        setCopyNotice({ name: result.entry.name, skippedCount: result.skippedCount })
      }

      // 貼り付け先が畳まれていると、何ができたのかが画面から分からない（移動と同じ）。
      expandDirectory(destinationRelativePath)
      setActiveDirectory(destinationRelativePath)
      select(result.entry.id)

      return true
    },
    [actions, expandDirectory, select]
  )

  /**
   * 控えておいたものを、そのフォルダへ貼り付ける。
   *
   * **成功しても控えを捨てない。** コピー元はそのまま残るため、続けて別のフォルダへ
   * 貼り付けるのは素直な操作になる。
   */
  const pasteInto = useCallback(
    async (destinationRelativePath: string): Promise<void> => {
      if (clipboard === null || !canPasteInto(clipboard, destinationRelativePath)) {
        return
      }

      // cut は UI から載らない（Session 3-6-3 で決めた。clipboard.ts）。
      if (clipboard.mode !== 'copy') {
        return
      }

      await performCopy(clipboard.entry, destinationRelativePath)
    },
    [clipboard, performCopy]
  )

  /* ------------------------------------------ ドラッグ&ドロップ */

  /**
   * 掴んで落とす経路（Session 3-6-3）。
   *
   * **ここが持つのは行き先を受け取ってから先だけ。** 掴み方・当たり判定・Ctrl の追跡は
   * useFileDrag.ts、落せるかの判断は dragDrop.ts で、動かす / 複製するのは
   * 右クリックと同じ performMove / performCopy。
   * **カラム表示でも同じ hook をそのまま使う** ── 変わるのは器の DOM だけで、
   * 行の探し方（`.fx-file-row` と `data-relative-path`）は表示方式で変わらない。
   */
  const drag = useFileDrag({
    onDrop: (source, destinationRelativePath, dragMode: FilesDragMode) => {
      if (dragMode === 'copy') {
        void performCopy(source, destinationRelativePath)

        return
      }

      void performMove(source, destinationRelativePath)
    }
  })

  /**
   * ドロップ先として案内しているフォルダ行（案内していなければ null）。
   *
   * **落とせないときは null になる**（dragDrop.ts が destination を返さない）ため、
   * ハイライトを出す条件と実際に落とせる条件は同じ1つの値から出ている。
   */
  const dropDirectory =
    drag.state !== null && drag.state.destination !== null && drag.state.zone?.kind === 'directory'
      ? drag.state.destination
      : null

  /** 余白へ落とせる状態のとき、その余白が受け持つフォルダ（ツリーなら root）。 */
  const dropSurface =
    drag.state !== null && drag.state.destination !== null && drag.state.zone?.kind === 'surface'
      ? drag.state.destination
      : null

  /*
    Escape で移動 / コピーをやめる（Files のどこに focus があっても効く）。

    右クリックメニューが開いている間は登録しない（あちらも Escape で閉じるため）。
    ドラッグ中も同じ理由で登録しない ── ドラッグの Escape はそのドラッグを
    やめるためのもの（useFileDrag.ts が自分の Escape を持つ）。
  */
  useEffect(() => {
    if (menu !== null || drag.state !== null || (pendingMove === null && clipboard === null)) {
      return
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setPendingMove(null)
        setClipboard(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pendingMove, clipboard, menu, drag.state])

  const openMenu = useCallback((target: FileContextMenuTarget): void => {
    setMenu(target)
  }, [])

  const closeMenu = useCallback((): void => {
    setMenu(null)
  }, [])

  return {
    workspace,
    tree,
    actions,
    drag,
    activeDirectory,
    pendingMove,
    clipboard,
    copyNotice,
    menu,
    pendingDelete,
    dropDirectory,
    dropSurface,
    activateInTree,
    activateInColumns,
    openDirectory,
    openEntry,
    startCreate,
    commitCreate,
    startRename,
    commitRename,
    requestDelete,
    confirmDelete,
    cancelDelete,
    startMove,
    cancelMove,
    moveInto,
    startCopy,
    clearClipboard,
    pasteInto,
    dismissCopyNotice,
    openMenu,
    closeMenu
  }
}
