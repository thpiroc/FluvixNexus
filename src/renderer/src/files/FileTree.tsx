import { useCallback, useEffect, useState, type JSX, type KeyboardEvent } from 'react'
import { WORKSPACE_ROOT_RELATIVE_PATH, type FileEntry } from '@shared/files'
import { useWorkspaceFolder } from '../workspaceFolder/context'
import { FileDraftRow, FileNoteRow, type FileRowStyle } from './FileRows'
import { resolveEntryIconId } from './fileIcon'
import { FileNameInput } from './FileNameInput'
import { ChevronIcon, CloseIcon, FileTypeIcon } from './FileTreeIcons'
import type { FileTreeRow } from './fileTreeModel'
import type { FilesController } from './useFilesController'
import './files.css'

/**
 * Workspace のファイルツリー（縦に並べる表示）。
 *
 * ## 何をどこで決めるか
 *
 * 状態と操作は useFilesController.ts が持ち、行の並びは fileTreeModel.ts が決める。
 * 器（ツールバー・帯・右クリックメニュー・削除の確認・ドラッグ中の表示）は
 * FilesExplorer.tsx にある。**このファイルが持つのは「縦に並べること」と
 * 「キーボードで辿ること」だけ**で、どのフォルダをいつ読むかも、
 * 押した結果何が起きるかも知らない。
 *
 * 横に並べる表示（FileColumns.tsx。Session 3-6-7）はこのファイルと対になる
 * もう1つの描き方で、**同じ controller を受け取る。** データも操作も共有していて、
 * 違うのは並べ方と、フォルダを押したときの見せ方（下に開く / 右に開く）だけになる。
 *
 * ## 見た目の約束
 *
 * - **横に溢れさせない。** ファイル名は長くなりうるが、パネルの幅は利用者が自由に変えられる。
 *   名前を省略して収める（全体は title 属性で読める）。深い階層でも名前の場所が
 *   無くならないよう、インデントの上限を CSS 側で決めてある。
 * - **階層はインデントで示す。** 罫線を引かないのは、パネルが細くなるほど
 *   罫線とインデントで名前の幅を食い合うため。
 *
 * ## キーボード
 *
 * ARIA の tree パターンに沿って、行そのものを focus の対象にする（roving tabindex）。
 * 上下で移動、右で開く / 中へ、左で閉じる / 親へ、Enter / Space で決定。
 * 加えて F2 で名前の変更、Delete で削除（どちらもツリー UI の慣習）。
 * ツリーは行数が多くなるため、全行を Tab の対象にはしない。
 *
 * 移動とコピーは行き先を選ぶ操作なので、キーボードだけの経路は持たせていない
 * （右クリック → 「移動…」/「コピー」→ 行き先のフォルダを右クリック →
 * 「ここへ移動」/「ここに貼り付け」）。Ctrl+C / Ctrl+V を割り当てていないのは、
 * **その2つが OS のクリップボードを指す約束**として広く通っているためで、
 * ここで扱っているのは Files パネルの中だけの控えになる（clipboard.ts）。
 * ただし**やめる手段はキーボードにも置く** ── Escape でどちらもやめられる
 * （登録は useFilesController.ts）。
 *
 * ## ドラッグ&ドロップ（Session 3-6-3）
 *
 * 行を掴んでフォルダ行 / ツリーの余白へ落とすと移動、Ctrl を押しながらならコピー。
 * **新しいファイル操作は1つも足していない** ── 呼ぶ先は右クリックの経路と同じで、
 * 落とせるかの判断も Session 3-6-1 / 3-6-2 のものをそのまま使う（dragDrop.ts）。
 *
 * 掴めない行（Workspace root）と落とせない場所（ファイル行）では、
 * ドロップできるように見える表示を出さない。
 */

interface FileTreeProps {
  readonly controller: FilesController
  /**
   * ツリーの中で場所を見せてほしい対象（無ければ null）。
   *
   * 検索結果を押したときに親から届く（Session 3-6-4）。祖先を開いて選ぶのは
   * controller の仕事で、ここが持つのは**画面の外にあれば送る**ところだけ。
   */
  readonly revealTarget?: FileEntry | null
}

export function FileTree({ controller, revealTarget = null }: FileTreeProps): JSX.Element {
  const { workspace, tree, drag, dropDirectory, dropSurface } = controller
  const { rows, selectedId, draft } = tree

  /*
    Workspace を閉じる操作は Session 3-1 のものをそのまま使う（新しい経路を作らない）。
    保存内容（lastWorkspace）の解除も Main 側のその処理が持っている。
  */
  const { closeWorkspace, busy: workspaceBusy } = useWorkspaceFolder()

  /** 行の DOM。キーボードで移動したときに focus を移すために持つ。 */
  const [rowElements] = useState(() => new Map<string, HTMLDivElement>())

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

  /*
    見せる対象が画面の外にあれば、そこまで送る。

    行はまだ読み込まれていないことがあるため、**行の並びが変わるたびに試す**
    （届いた時点で1回スクロールし、以降は同じ位置なので動かない）。
  */
  useEffect(() => {
    if (revealTarget === null) {
      return
    }

    rowElements.get(revealTarget.id)?.scrollIntoView({ block: 'nearest' })
  }, [revealTarget, rows, rowElements])

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

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, index: number): void => {
      const row = rows[index]

      if (row === undefined || row.kind !== 'entry') {
        return
      }

      const isDirectory = row.entry.type === 'directory'
      const isRoot = row.entry.relativePath === WORKSPACE_ROOT_RELATIVE_PATH

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          moveTo(findEntryKey(rows, index + 1, 1))
          return

        case 'ArrowUp':
          event.preventDefault()
          moveTo(findEntryKey(rows, index - 1, -1))
          return

        case 'Home':
          event.preventDefault()
          moveTo(findEntryKey(rows, 0, 1))
          return

        case 'End':
          event.preventDefault()
          moveTo(findEntryKey(rows, rows.length - 1, -1))
          return

        case 'ArrowRight':
          event.preventDefault()

          if (isDirectory && !row.expanded) {
            tree.toggleDirectory(row.entry.relativePath)
            return
          }

          // 既に開いているなら中へ。閉じた瞬間の行はまだ無いため、開く操作とは分ける。
          moveTo(findEntryKey(rows, index + 1, 1))
          return

        case 'ArrowLeft':
          event.preventDefault()

          if (isDirectory && row.expanded) {
            tree.toggleDirectory(row.entry.relativePath)
            return
          }

          moveTo(findParentKey(rows, index))
          return

        case 'Enter':
        case ' ':
          event.preventDefault()
          controller.activateInTree(row.entry)
          return

        case 'F2':
          event.preventDefault()

          // Workspace root は Files パネルの操作範囲の外（FileContextMenu.tsx）。
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
    [rows, moveTo, tree, controller]
  )

  /*
    Tab で入ってきたときに focus を受ける行。
    選択が無い（起動直後）なら先頭の行にしておく。
  */
  const focusableKey = rows.some((row) => row.kind === 'entry' && row.key === selectedId)
    ? selectedId
    : (rows[0]?.key ?? null)

  return (
    /*
      ツリーの器。ドラッグの当たり判定の範囲であり、**余白そのものが
      Workspace root へのドロップ先**になる（`data-drop-surface`）。
      枠の内側にハイライトを描くだけなので、案内のための要素は1つも重ねていない
      ── 重ねると、その要素が当たり判定を奪う（files.css）。
    */
    <div
      ref={drag.registerSurface}
      className="fx-files__tree"
      role="tree"
      aria-label={`${workspace.displayName} のファイル`}
      data-drop-surface={WORKSPACE_ROOT_RELATIVE_PATH}
      data-drop-here={dropSurface !== null ? drag.state?.mode : undefined}
      data-drag-mode={drag.state?.mode}
    >
      {rows.map((row, index) => {
        if (row.kind === 'note') {
          return <FileNoteRow key={row.key} row={row} onRetry={tree.reloadDirectory} />
        }

        if (row.kind === 'draft') {
          return (
            <FileDraftRow
              key={row.key}
              row={row}
              twisty
              onCommit={controller.commitCreate}
              onCancel={tree.cancelDraft}
            />
          )
        }

        const renaming = draft?.kind === 'rename' && draft.relativePath === row.entry.relativePath

        return (
          <div
            key={row.key}
            ref={(element) => registerRow(row.key, element)}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-selected={row.key === selectedId}
            aria-expanded={row.entry.type === 'directory' ? row.expanded : undefined}
            tabIndex={row.key === focusableKey ? 0 : -1}
            className="fx-file-row"
            data-file-id={row.key}
            data-type={row.entry.type}
            /*
              ドラッグの当たり判定がこの位置を読む（useFileDrag.ts）。
              title に入っている値は root 行だけ絶対パスになるため、
              行き先を決める値としては使えない。
            */
            data-relative-path={row.entry.relativePath}
            data-selected={row.key === selectedId}
            data-expanded={row.entry.type === 'directory' ? row.expanded : undefined}
            data-draft={renaming ? 'rename' : undefined}
            // 動かそうとしている当人。行き先を選んでいる間、どれが動くのかを行の側にも出す。
            data-moving={row.key === controller.pendingMove?.id ? true : undefined}
            /*
              コピーしようとしている当人。**移動のように薄くしない**
              ── 元はそこに残るので、消えるように見せると嘘になる（files.css）。
            */
            data-copying={row.key === controller.clipboard?.entry.id ? true : undefined}
            /*
              今掴んでいる行。**移動 / コピーの印は上の2つと同じものを使う**
              （移動は薄く、コピーは点線の下線）。
            */
            data-dragging={row.key === drag.state?.source.id ? drag.state.mode : undefined}
            /*
              ここへ落とせる、という案内。落とせないときは値が入らない
              （dropDirectory が null になる）ので、**落とせるように見える表示は出ない。**
            */
            data-drop={row.entry.relativePath === dropDirectory ? drag.state?.mode : undefined}
            // 全体はここで読めるようにする（名前は幅に合わせて省略される）。
            title={
              row.entry.relativePath === WORKSPACE_ROOT_RELATIVE_PATH
                ? workspace.rootPath
                : row.entry.relativePath
            }
            style={{ '--fx-file-depth': row.depth } as FileRowStyle}
            /*
              ドラッグの後にも click は続く。見なければ**ドロップと同時に
              ファイルが開く / フォルダが開閉する**ことになる（useFileDrag.ts）。
            */
            onClick={() => !renaming && !drag.justDragged() && controller.activateInTree(row.entry)}
            /*
              掴む入口。名前を打っている行では始めない ── 入力欄の中で
              ポインタを掴むと、文字の選択ができなくなる。
            */
            onPointerDown={(event) => !renaming && drag.beginDrag(row.entry, event)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()

              // 右クリックした行を選んでおく。メニューの対象と選択がずれて見えないようにする。
              tree.select(row.key)
              controller.openMenu({ entry: row.entry, x: event.clientX, y: event.clientY })
            }}
          >
            <span className="fx-file-row__twisty" aria-hidden="true">
              {row.entry.type === 'directory' && <ChevronIcon />}
            </span>

            {/*
              種類別のアイコン（Session 3-6-6）。判定は fileIcon.ts の1箇所だけで、
              検索結果もカラム表示も同じ関数を呼ぶ。フォルダは展開状態でも絵が変わるため、
              `row.expanded` をそのまま渡す。
            */}
            <span className="fx-file-row__icon" aria-hidden="true">
              <FileTypeIcon icon={resolveEntryIconId(row.entry, row.expanded)} />
            </span>

            {renaming ? (
              <FileNameInput
                initialName={draft.initialName}
                ariaLabel={`${draft.initialName} の新しい名前`}
                onCommit={(name) => controller.commitRename(draft.relativePath, name)}
                onCancel={tree.cancelDraft}
              />
            ) : (
              <span className="fx-file-row__name">{row.entry.name}</span>
            )}

            {/*
              Workspace を閉じる。root 行にだけ付く。

              閉じるのは「開いているフォルダ」であって、フォルダそのものではない。
              同じ行に並ぶ削除（コンテキストメニュー）と紛らわしくならないよう、
              root 行には削除を出していない（FileContextMenu.tsx）。

              処理は Session 3-1 の Workspace Close をそのまま呼ぶ。ツリーの破棄も
              Editor のタブの破棄も、Workspace が未選択になった結果として起きる
              （ARCHITECTURE.md §9.6 / §10.3）ため、ここに後片付けは書かない。
            */}
            {row.entry.relativePath === WORKSPACE_ROOT_RELATIVE_PATH && (
              <button
                type="button"
                className="fx-file-row__action"
                aria-label="Workspace を閉じる"
                title="Workspace を閉じる"
                disabled={workspaceBusy}
                // 行の選択・開閉に伝えない（押した意図は閉じることだけ）。
                onClick={(event) => {
                  event.stopPropagation()
                  closeWorkspace()
                }}
                // Enter / Space が行のキーボード操作にも届くと、閉じると同時に
                // root を畳む操作にもなる。
                onKeyDown={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.stopPropagation()}
              >
                <CloseIcon />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
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

/** 1つ上の階層で自分を含んでいる行（＝親フォルダ）の key。 */
function findParentKey(rows: readonly FileTreeRow[], index: number): string | undefined {
  const current = rows[index]

  if (current === undefined) {
    return undefined
  }

  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const row = rows[cursor]

    if (row?.kind === 'entry' && row.depth < current.depth) {
      return row.key
    }
  }

  return undefined
}
