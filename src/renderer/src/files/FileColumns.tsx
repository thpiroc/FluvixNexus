import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { WORKSPACE_ROOT_RELATIVE_PATH, type FileEntry } from '@shared/files'
import { useI18n } from '../i18n/context'
import { useWorkspaceFolder } from '../workspaceFolder/context'
import { FileDraftRow, FileNoteRow } from './FileRows'
import { resolveEntryIconId } from './fileIcon'
import { FileNameInput } from './FileNameInput'
import { buildFileColumns, columnDirectoryEntry } from './filesColumnsModel'
import { ChevronIcon, CloseIcon, FileTypeIcon } from './FileTreeIcons'
import type { FileTreeRow } from './fileTreeModel'
import type { FilesController } from './useFilesController'
import type { FilesLayoutController } from './useFilesLayout'
import './files.css'

/**
 * Workspace のファイルを横に並べる表示（カラム表示。Session 3-6-7）。
 *
 * DESIGN.md §3「Files パネルの表示切り替え」── パネルを画面下部などへ横長に
 * 置いたときのための見せ方で、フォルダ階層を左から右へ展開する
 * （Unity の Project ウィンドウ / macOS Finder のカラム表示に近い考え方）。
 *
 *   Project | src | renderer | files
 *
 * ## ツリーと同じものを見ている
 *
 * FileTree.tsx と対になる**もう1つの描き方**でしかない。受け取るのは同じ
 * controller（useFilesController.ts）で、
 *
 *   FileEntry / relativePath  … 同じ（shared/files）
 *   読み込み済みの中身        … 同じ `directories`（切り替えても読み直さない）
 *   Lazy Load                 … 同じ経路（開いたフォルダだけ読む）
 *   作成 / 改名 / 削除 / 移動 / コピー / ドラッグ&ドロップ … 同じ関数
 *   状況を伝える行・名前の入力欄 … 同じ部品（FileRows.tsx）
 *
 * を共有している。**カラム表示のために新しい Main 側の API も、新しい Files の
 * データモデルも足していない。**
 *
 * ## 縦のインデントの代わりに、列が深さを示す
 *
 * 1つのカラムにはその階層の直下だけが並ぶ（行の depth は 0 で揃う）。
 * 右のカラムとして開いているフォルダには、ツリーの「展開中」と同じ旗が立つ
 * （filesColumnsModel.ts）ので、行の側は表示方式を知らないままでいられる。
 *
 * ## スクロール
 *
 * 全体は横スクロール、カラムの中は縦スクロール。**深い階層を開いたときだけ**
 * 右端のカラムまで送る ── 表示が変わるたびに送ると、左のカラムを見ている最中に
 * 画面が動く。送るのは開いた場所が変わった瞬間の1回だけにしてある。
 *
 * ## 幅は掴んで変えられる（Session 3-6-8）
 *
 * カラムの境目を掴むと幅が変わり、**次の起動でも同じ幅**で出る（FilesViewProvider）。
 * 変わるのは全部の列で、列ごとには持たない ── 列は `activeDirectory` からの**導出**で
 * （§10.13）、選び直すたびに顔ぶれが変わる。列ごとの幅を持たせると、
 * その幅が「どの列のものだったか」を保てる場所がどこにも無い。
 *
 * 中身に合わせて自動で伸ばすことは相変わらずしない。深い階層へ入るたびに
 * 左のカラムの幅が変わり、さっき押した行の位置が動くため。
 *
 * ## ドラッグ&ドロップ
 *
 * 器（横に並べた枠）を1つ預けるだけで、判定は useFileDrag.ts のものがそのまま動く
 * ── 行の探し方（`.fx-file-row` と `data-relative-path`）は表示方式で変わらないため。
 * 変えたのは**余白の行き先**で、カラムの余白はそのカラムのフォルダになる
 * （`data-drop-surface`。dragDrop.ts）。
 */

interface FileColumnsProps {
  readonly controller: FilesController
  /** カラムの幅を持つ側（useFilesLayout.ts → FilesViewProvider.tsx）。 */
  readonly layout: FilesLayoutController
  /** 検索結果から指された場所（無ければ null。Session 3-6-4）。 */
  readonly revealTarget?: FileEntry | null
}

export function FileColumns({
  controller,
  layout,
  revealTarget = null
}: FileColumnsProps): JSX.Element {
  const { t } = useI18n()
  const { workspace, tree, drag, dropDirectory, dropSurface, activeDirectory } = controller
  const { directories, selectedId, draft } = tree

  const { closeWorkspace, busy: workspaceBusy } = useWorkspaceFolder()

  const resize = useColumnResize(layout.columnWidth, layout.setColumnWidth)

  const columns = useMemo(
    () =>
      buildFileColumns({
        rootName: workspace.displayName,
        directories,
        activeDirectory,
        draft
      }),
    [workspace.displayName, directories, activeDirectory, draft]
  )

  /** 行とカラムの DOM（キーボードの移動と、右端まで送るために持つ）。 */
  const [rowElements] = useState(() => new Map<string, HTMLDivElement>())
  const [columnElements] = useState(() => new Map<string, HTMLDivElement>())

  const registerRow = useCallback(
    (key: string, element: HTMLDivElement | null): void => {
      if (element === null) {
        rowElements.delete(key)
        return
      }

      rowElements.set(key, element)
    },
    [rowElements]
  )

  const registerColumn = useCallback(
    (key: string, element: HTMLDivElement | null): void => {
      if (element === null) {
        columnElements.delete(key)
        return
      }

      columnElements.set(key, element)
    },
    [columnElements]
  )

  /*
    開いた場所が変わったら、一番右のカラムを見せる。

    **依存に入れているのは activeDirectory だけ。** 行が届くたび・選択が動くたびに
    送ると、左のカラムを見ている間に画面が横へ動く。深い階層を開いた直後に
    新しいカラムが画面の外にある、という場合だけを拾えばよい。
  */
  useEffect(() => {
    columnElements
      .get(`column:${activeDirectory}`)
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [activeDirectory, columnElements])

  /*
    検索結果から指された場所を、カラムの中でも見せる（Session 3-6-4）。
    列を伸ばすのは controller 側で、ここが持つのは画面の外にあれば送るところだけ。
  */
  useEffect(() => {
    if (revealTarget === null) {
      return
    }

    rowElements.get(revealTarget.id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [revealTarget, columns, rowElements])

  /** 移動先の行へ選択と focus を移す。行が無ければ何もしない。 */
  const moveTo = useCallback(
    (key: string | undefined): void => {
      if (key === undefined) {
        return
      }

      tree.select(key)
      rowElements.get(key)?.focus()
    },
    [tree, rowElements]
  )

  /**
   * キーボードでの移動。
   *
   * 上下は同じカラムの中、左右がカラムの移動になる（ツリーでは上下が階層をまたぎ、
   * 左右が開閉だった）。**それ以外は同じ** ── Enter / Space で決定、F2 で名前の変更、
   * Delete で削除。並べ方が変わっても操作の語彙は変えない。
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, columnIndex: number, rowIndex: number): void => {
      const column = columns[columnIndex]
      const row = column?.rows[rowIndex]

      if (column === undefined || row === undefined || row.kind !== 'entry') {
        return
      }

      const isDirectory = row.entry.type === 'directory'
      const isRoot = row.entry.relativePath === WORKSPACE_ROOT_RELATIVE_PATH

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          moveTo(findEntryKey(column.rows, rowIndex + 1, 1))
          return

        case 'ArrowUp':
          event.preventDefault()
          moveTo(findEntryKey(column.rows, rowIndex - 1, -1))
          return

        case 'Home':
          event.preventDefault()
          moveTo(findEntryKey(column.rows, 0, 1))
          return

        case 'End':
          event.preventDefault()
          moveTo(findEntryKey(column.rows, column.rows.length - 1, -1))
          return

        case 'ArrowRight':
          event.preventDefault()

          if (isDirectory && !row.expanded) {
            // まだ右に出ていないフォルダは、まず開く（中身が届いてから入る）。
            controller.openDirectory(row.entry.relativePath)
            return
          }

          moveTo(findEntryKey(columns[columnIndex + 1]?.rows ?? [], 0, 1))
          return

        case 'ArrowLeft':
          event.preventDefault()
          // 左のカラムで、このカラムを開いている行（＝このフォルダ）へ戻る。
          moveTo(columnIndex > 0 ? `d:${column.relativePath}` : undefined)
          return

        case 'Enter':
        case ' ':
          event.preventDefault()
          controller.activateInColumns(row.entry)
          return

        case 'F2':
          event.preventDefault()

          if (!isRoot) {
            controller.startRename(row.entry)
          }

          return

        case 'Delete':
          event.preventDefault()

          if (!isRoot) {
            controller.requestDelete(row.entry)
          }

          return

        default:
          return
      }
    },
    [columns, moveTo, controller]
  )

  /*
    Tab で入ってきたときに focus を受ける行（ツリーと同じ roving tabindex）。
    選択が今出ているカラムの中に無ければ、左端のカラムの先頭にしておく。
  */
  const focusableKey = columns.some((column) =>
    column.rows.some((row) => row.kind === 'entry' && row.key === selectedId)
  )
    ? selectedId
    : (columns[0]?.rows.find((row) => row.kind === 'entry')?.key ?? null)

  return (
    /*
      カラムを横に並べる器。ドラッグの当たり判定の範囲になる。

      **この器自身は行き先を持たない**（`data-drop-surface` を付けない）。
      カラムの外側の余白（右端など）はどのフォルダでもないため、そこを
      Workspace root にすると「指した場所と違う行き先」が生まれる ── ツリーで
      余白が root を受け持っていた役は、カラム表示では左端のカラムの余白が担う。
    */
    <div
      ref={drag.registerSurface}
      className="fx-files__columns"
      role="tree"
      aria-label={t('files.tree.columnsAriaLabel', { workspace: workspace.displayName })}
      data-drag-mode={drag.state?.mode}
      data-resizing={resize.active ? true : undefined}
      /*
        幅は CSS 変数1つで全部の列に効かせる。列ごとに style を書くと、
        掴んで動かしている間、列の数だけインラインスタイルが書き換わる。
      */
      style={{ '--fx-file-column-width': `${layout.columnWidth}px` } as CSSProperties}
    >
      {columns.map((column, columnIndex) => {
        const folder = columnDirectoryEntry(column)

        return (
          <div
            key={column.key}
            ref={(element) => registerColumn(column.key, element)}
            className="fx-file-column"
            data-relative-path={column.relativePath}
          >
            {/*
              カラムの見出し。**そのフォルダ自身の置き場所**でもあり、
              右クリックでツリーのフォルダ行と同じメニューが出る
              （新規作成・ここへ移動・ここに貼り付け）。
            */}
            <div
              className="fx-file-column__header"
              title={
                column.relativePath === WORKSPACE_ROOT_RELATIVE_PATH
                  ? workspace.rootPath
                  : column.relativePath
              }
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                controller.openMenu({ entry: folder, x: event.clientX, y: event.clientY })
              }}
            >
              <span className="fx-file-column__name">{column.name}</span>

              {/* Workspace を閉じる。ツリーの root 行と同じ扱いで、左端のカラムにだけ付く。 */}
              {column.relativePath === WORKSPACE_ROOT_RELATIVE_PATH && (
                <button
                  type="button"
                  className="fx-file-row__action"
                  aria-label={t('files.tree.closeWorkspace')}
                  title={t('files.tree.closeWorkspace')}
                  disabled={workspaceBusy}
                  onClick={(event) => {
                    event.stopPropagation()
                    closeWorkspace()
                  }}
                  onContextMenu={(event) => event.stopPropagation()}
                >
                  <CloseIcon />
                </button>
              )}
            </div>

            {/*
              カラムの中身。縦スクロールはここで完結する。
              **余白はこのカラムのフォルダへのドロップ先**（dragDrop.ts）。
            */}
            <div
              className="fx-file-column__body"
              data-drop-surface={column.relativePath}
              data-drop-here={dropSurface === column.relativePath ? drag.state?.mode : undefined}
            >
              {column.rows.map((row, rowIndex) => {
                if (row.kind === 'note') {
                  return <FileNoteRow key={row.key} row={row} onRetry={tree.reloadDirectory} />
                }

                if (row.kind === 'draft') {
                  return (
                    <FileDraftRow
                      key={row.key}
                      row={row}
                      onCommit={controller.commitCreate}
                      onCancel={tree.cancelDraft}
                    />
                  )
                }

                const renaming =
                  draft?.kind === 'rename' && draft.relativePath === row.entry.relativePath
                const isDirectory = row.entry.type === 'directory'

                return (
                  <div
                    key={row.key}
                    ref={(element) => registerRow(row.key, element)}
                    role="treeitem"
                    // 深さは列が示す（左端が1）。
                    aria-level={columnIndex + 1}
                    aria-selected={row.key === selectedId}
                    aria-expanded={isDirectory ? row.expanded : undefined}
                    tabIndex={row.key === focusableKey ? 0 : -1}
                    className="fx-file-row"
                    data-file-id={row.key}
                    data-type={row.entry.type}
                    // ドラッグの当たり判定がこの位置を読む（useFileDrag.ts）。
                    data-relative-path={row.entry.relativePath}
                    data-selected={row.key === selectedId}
                    // 右のカラムとして開いているフォルダ（ツリーの「展開中」と同じ旗）。
                    data-expanded={isDirectory ? row.expanded : undefined}
                    data-draft={renaming ? 'rename' : undefined}
                    data-moving={row.key === controller.pendingMove?.id ? true : undefined}
                    data-copying={row.key === controller.clipboard?.entry.id ? true : undefined}
                    data-dragging={row.key === drag.state?.source.id ? drag.state.mode : undefined}
                    data-drop={
                      row.entry.relativePath === dropDirectory ? drag.state?.mode : undefined
                    }
                    title={row.entry.relativePath}
                    onClick={() =>
                      !renaming && !drag.justDragged() && controller.activateInColumns(row.entry)
                    }
                    onPointerDown={(event) => !renaming && drag.beginDrag(row.entry, event)}
                    onKeyDown={(event) => handleKeyDown(event, columnIndex, rowIndex)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      tree.select(row.key)
                      controller.openMenu({
                        entry: row.entry,
                        x: event.clientX,
                        y: event.clientY
                      })
                    }}
                  >
                    {/*
                      種類別のアイコン（Session 3-6-6）。判定はツリーと同じ fileIcon.ts で、
                      フォルダは**右のカラムを開いている間だけ**開いた絵になる。
                    */}
                    <span className="fx-file-row__icon" aria-hidden="true">
                      <FileTypeIcon icon={resolveEntryIconId(row.entry, row.expanded)} />
                    </span>

                    {renaming ? (
                      <FileNameInput
                        initialName={draft.initialName}
                        ariaLabel={t('files.input.renameLabel', { name: draft.initialName })}
                        onCommit={(name) => controller.commitRename(draft.relativePath, name)}
                        onCancel={tree.cancelDraft}
                      />
                    ) : (
                      <span className="fx-file-row__name">{row.entry.name}</span>
                    )}

                    {/*
                      「この先がある」印。ツリーの展開の三角と同じ絵を、右端に置く
                      ── 開く先が下ではなく右にあることを、位置だけで示す。
                    */}
                    {isDirectory && (
                      <span className="fx-file-row__into" aria-hidden="true">
                        <ChevronIcon />
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/*
              幅を変える掴み手（Session 3-6-8）。境目の線をそのまま掴めるようにしたもので、
              Dock の掴み手（DockResizeHandle.tsx）と同じ作り ── 見た目は 1px の線のまま、
              掴める幅だけを広く取る。

              変わるのは**全部の列の幅**（列ごとには持たない。このファイルの冒頭）。
              どの列の境目を掴んでも同じ1つの値が動くため、`data-relative-path` は
              実機での確認のためだけに持たせてある。

              ドラッグ中のファイルをここへ落としたときは、そのカラムの余白へ落とした
              ものとして扱う（`data-drop-surface`）── 境目に重なった数 px だけ
              行き先が消えると、落とせたり落とせなかったりする帯ができる。
            */}
            <div
              className="fx-file-column__resize"
              role="separator"
              aria-orientation="vertical"
              aria-label={t('files.tree.columnWidth', { name: column.name })}
              data-active={resize.active ? true : undefined}
              data-relative-path={column.relativePath}
              data-drop-surface={column.relativePath}
              onPointerDown={resize.beginResize}
            />
          </div>
        )
      })}
    </div>
  )
}

/**
 * カラムの幅を掴んで変える（Session 3-6-8）。
 *
 * workspace の useSplitResize.ts と同じ作りで、
 *
 *   pointerdown … 掴んだ時点の幅と開始座標を覚える
 *   pointermove … **開始時の幅 + 累計移動量**を渡す（前回の結果へ足し込まない）
 *   pointerup   … そのまま確定する（移動のたびに反映済み）
 *   Escape / pointercancel / ウィンドウのフォーカス喪失 … 掴む前の幅へ戻す
 *
 * 累計で計算するのは、丸めと上下限での頭打ちが積み重ならないようにするため
 * ── 下限まで詰めた後にカーソルを戻せば、そのまま追従して広がる。
 *
 * 幅そのものは持たない。正本は FilesViewProvider（ディスクにも残る）で、
 * ここが持つのは**掴んでいる間だけの値**になる。
 */
interface ColumnResizeController {
  /** 掴んでいる間だけ true（カーソルと見た目に使う）。 */
  readonly active: boolean
  readonly beginResize: (event: ReactPointerEvent) => void
}

interface ColumnResizeGesture {
  readonly pointerId: number
  readonly originX: number
  /** 掴んだ時点の幅。キャンセルで戻す先でもある。 */
  readonly startWidth: number
}

function useColumnResize(width: number, setWidth: (width: number) => void): ColumnResizeController {
  const [active, setActive] = useState(false)
  const gesture = useRef<ColumnResizeGesture | null>(null)

  // window のリスナーは張り直さないため、最新の値と操作を ref 越しに見る。
  const latest = useRef({ width, setWidth })

  useEffect(() => {
    latest.current = { width, setWidth }
  }, [width, setWidth])

  const endGesture = useCallback((): void => {
    gesture.current = null
    setActive(false)
  }, [])

  const beginResize = useCallback((event: ReactPointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary || gesture.current !== null) {
      return
    }

    gesture.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      startWidth: latest.current.width
    }

    // 掴み手は数 px しかない。捕まえておかないと少し速く動かしただけで外れる。
    event.currentTarget.setPointerCapture(event.pointerId)
    // 掴み手の上でのドラッグが文字選択にならないようにする。
    event.preventDefault()
    /*
      行のドラッグ（useFileDrag.ts）へ伝えない。伝えると、幅を変えたつもりが
      ファイルの移動として始まる ── 掴み手は行の中ではなく列の縁にあるため、
      掴んだものが違えば行き先も違う。
    */
    event.stopPropagation()

    setActive(true)
  }, [])

  useEffect(() => {
    if (!active) {
      return
    }

    const handleMove = (event: PointerEvent): void => {
      const current = gesture.current

      if (current === null || event.pointerId !== current.pointerId) {
        return
      }

      latest.current.setWidth(current.startWidth + (event.clientX - current.originX))
    }

    const handleUp = (event: PointerEvent): void => {
      if (gesture.current === null || event.pointerId !== gesture.current.pointerId) {
        return
      }

      // 移動のたびに反映済みなので、確定は「やめるだけ」でよい。
      endGesture()
    }

    const cancel = (): void => {
      const current = gesture.current

      if (current !== null) {
        latest.current.setWidth(current.startWidth)
      }

      endGesture()
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        cancel()
      }
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [active, endGesture])

  return useMemo(() => ({ active, beginResize }), [active, beginResize])
}

/** index から向き（step）へ進みながら、最初に見つかった entry 行の key を返す。 */
function findEntryKey(
  rows: readonly FileTreeRow[],
  index: number,
  step: number
): string | undefined {
  for (let cursor = index; cursor >= 0 && cursor < rows.length; cursor += step) {
    const row = rows[cursor]

    if (row?.kind === 'entry') {
      return row.key
    }
  }

  return undefined
}
