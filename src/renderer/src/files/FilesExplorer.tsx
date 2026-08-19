import type { JSX } from 'react'
import type { FileEntry } from '@shared/files'
import type { WorkspaceFolder } from '@shared/workspace'
import { DeleteConfirm } from './DeleteConfirm'
import { FileColumns } from './FileColumns'
import { FileContextMenu } from './FileContextMenu'
import {
  ColumnsViewIcon,
  NewFileIcon,
  NewFolderIcon,
  RefreshIcon,
  SearchIcon,
  TreeViewIcon
} from './FileTreeIcons'
import { FileTree } from './FileTree'
import type { FilesLayoutMode } from './filesLayoutMode'
import { countLoadedEntries, resolveCreateTarget } from './fileTreeModel'
import type { FilesLayoutController } from './useFilesLayout'
import { useFilesController } from './useFilesController'
import './files.css'

/**
 * Files パネルの器（ツールバー・状態の帯・右クリックメニュー・削除の確認・
 * ドラッグ中の表示）と、表示方式の出し分け（Session 3-6-7）。
 *
 * ## 器は表示方式で変えない
 *
 * ツリーでもカラムでも、
 *   - 作成の入口（新規ファイル / 新規フォルダ）
 *   - 検索への入口（Session 3-6-4）
 *   - 再読み込み
 *   - 移動 / コピーの途中を伝える帯と、やめる手段
 *   - 失敗の帯
 *   - 右クリックメニュー・削除の確認・ドラッグ中の小さな表示
 * は同じものが同じ場所に出る。**変わるのは中身の並べ方だけ**にしてあるのは、
 * 表示方式を切り替えるたびに操作の場所を覚え直すことにならないため。
 *
 * ## どちらか一方だけを描く
 *
 * 検索（FilesView.tsx）は両方を持ったまま隠すが、ツリーとカラムは出す方だけを描く。
 * 状態は**すべて controller が持っている**（選択・展開・読み込み済み・開いている
 * カラム）ので、描き直しても失われるものが無い ── むしろ両方を描くと、
 * 同じ行が2つ DOM に出て、ドラッグの当たり判定（`.fx-file-row` を探す）が
 * 隠れている側の行を拾いうる。
 */

interface FilesExplorerProps {
  readonly workspace: WorkspaceFolder
  /** パネルの形と、利用者が選んだ表示方式（useFilesLayout.ts）。 */
  readonly layout: FilesLayoutController
  /** 検索結果から指された場所（無ければ null。Session 3-6-4）。 */
  readonly revealTarget?: FileEntry | null
  /** 検索モードへ切り替える（渡されなければツールバーに入口を出さない）。 */
  readonly onSearch?: () => void
}

export function FilesExplorer({
  workspace,
  layout,
  revealTarget = null,
  onSearch
}: FilesExplorerProps): JSX.Element {
  const controller = useFilesController({ workspace, mode: layout.mode, revealTarget })
  const { tree, actions, drag } = controller

  const createTarget = resolveCreateTarget(tree.selectedEntry)

  return (
    <div className="fx-files">
      {/*
        操作の入口。右クリックメニューだけだと、初めて触ったときに
        作成の手段があること自体が見えない。
      */}
      <div className="fx-files__toolbar">
        <button
          type="button"
          className="fx-files__tool"
          aria-label="新規ファイル"
          title={`新規ファイル（${createTarget === '' ? workspace.displayName : createTarget}）`}
          onClick={() => controller.startCreate(createTarget, 'file')}
        >
          <NewFileIcon />
        </button>

        <button
          type="button"
          className="fx-files__tool"
          aria-label="新規フォルダ"
          title={`新規フォルダ（${createTarget === '' ? workspace.displayName : createTarget}）`}
          onClick={() => controller.startCreate(createTarget, 'directory')}
        >
          <NewFolderIcon />
        </button>

        {/* 表示方式の切り替え（Session 3-6-7）。 */}
        <ViewModeSwitch layout={layout} />

        {/*
          検索モードへの入口（Session 3-6-4）。**探すのはツリーの中の別の見せ方**で、
          パネルは増えない（FilesView.tsx）。
        */}
        {onSearch !== undefined && (
          <button
            type="button"
            className="fx-files__tool"
            aria-label="プロジェクト全体を検索"
            title="プロジェクト全体を検索（ファイル名 / 全文）"
            onClick={onSearch}
          >
            <SearchIcon />
          </button>
        )}

        {/*
          再読み込み。外部のエディタなど、このアプリの外で変わった内容を取り込む手段。
          アプリ内の操作による変化は Main からの通知で自動的に反映される（useFileTree.ts）。
        */}
        <button
          type="button"
          className="fx-files__tool"
          aria-label="ファイルツリーを再読み込み"
          title="再読み込み"
          onClick={tree.reloadAll}
        >
          <RefreshIcon />
        </button>
      </div>

      {/*
        移動の途中であることを、中身の外に1行として出す。

        行き先を選ぶのは中身そのもの（右クリック / ドラッグ）なので、案内をその中に置くと
        選ぶ対象と混ざる。**何を動かしているか**と**やめる手段**だけをここに置き、
        操作の場所は変えない。
      */}
      {controller.pendingMove !== null && (
        <div
          className="fx-files__pending"
          role="status"
          data-move-source={controller.pendingMove.relativePath}
        >
          <span className="fx-files__pending-text">
            「{controller.pendingMove.name}
            」の移動先フォルダを右クリックして「ここへ移動」を選んでください
          </span>
          <button
            type="button"
            className="fx-files__pending-cancel"
            onClick={controller.cancelMove}
            disabled={actions.busy}
          >
            やめる
          </button>
        </div>
      )}

      {/*
        コピーの控えがあることを、移動と同じ形の1行として出す。
        置き場所も文言の作りも揃えてあるのは、利用者から見て同じ性質の状態
        （「次に貼り付け先 / 移動先を選ぶ」）だからにほかならない。
      */}
      {controller.clipboard !== null && (
        <div
          className="fx-files__pending"
          role="status"
          data-clipboard-source={controller.clipboard.entry.relativePath}
          data-clipboard-mode={controller.clipboard.mode}
        >
          <span className="fx-files__pending-text">
            「{controller.clipboard.entry.name}
            」をコピーしました。貼り付け先フォルダを右クリックして「ここに貼り付け」を選んでください
          </span>
          <button
            type="button"
            className="fx-files__pending-cancel"
            onClick={controller.clearClipboard}
            disabled={actions.busy}
          >
            やめる
          </button>
        </div>
      )}

      {/*
        とばしたものがあったこと。失敗ではないので alert にはしない。
        黙って欠けた複製ができる方が悪いので、成功していても出す。
      */}
      {controller.copyNotice !== null && (
        <div
          className="fx-files__pending"
          role="status"
          data-copy-skipped={controller.copyNotice.skippedCount}
        >
          <span className="fx-files__pending-text">
            「{controller.copyNotice.name}」をコピーしました（リンクなど{' '}
            {controller.copyNotice.skippedCount} 件は複製していません）
          </span>
          <button
            type="button"
            className="fx-files__pending-cancel"
            aria-label="コピーの結果を閉じる"
            onClick={controller.dismissCopyNotice}
          >
            閉じる
          </button>
        </div>
      )}

      {actions.error !== null && (
        <div className="fx-files__error" role="alert">
          <span className="fx-files__error-text">{actions.error}</span>
          <button
            type="button"
            className="fx-files__error-dismiss"
            aria-label="エラーを閉じる"
            onClick={actions.dismissError}
          >
            ×
          </button>
        </div>
      )}

      {layout.mode === 'columns' ? (
        <FileColumns controller={controller} layout={layout} revealTarget={revealTarget} />
      ) : (
        <FileTree controller={controller} revealTarget={revealTarget} />
      )}

      {/*
        ドラッグ中の小さな表示。

        **カーソルの位置は React の state に入れない**（useFileDrag.ts が直接書き込む）。
        pointermove ごとに state を書き換えると、数百行ごと再描画になる。

        `pointer-events: none` は見た目の都合ではなく、**当たり判定が成立するための条件**
        にあたる（この表示がカーソルの下に入ると、行を探せなくなる。files.css）。

        器の側に置いてあるのは、表示方式が変わっても運んでいるものの見せ方は
        変わらないため（ツリーとカラムで2つ持たない）。
      */}
      {drag.state !== null && (
        <div
          ref={drag.registerBadge}
          className="fx-file-drag"
          aria-hidden="true"
          data-mode={drag.state.mode}
          data-droppable={drag.state.destination !== null}
          data-source={drag.state.source.relativePath}
        >
          <span className="fx-file-drag__mode">
            {drag.state.mode === 'copy' ? 'コピー' : '移動'}
          </span>
          <span className="fx-file-drag__name">{drag.state.source.name}</span>
          {drag.state.mode === 'move' && <span className="fx-file-drag__hint">Ctrl でコピー</span>}
        </div>
      )}

      {controller.menu !== null && (
        <FileContextMenu
          target={controller.menu}
          pendingMove={controller.pendingMove}
          clipboard={controller.clipboard}
          onClose={controller.closeMenu}
          actions={{
            onOpen: controller.openEntry,
            onCreate: controller.startCreate,
            onRename: controller.startRename,
            onCopy: controller.startCopy,
            onPasteInto: (destinationRelativePath) =>
              void controller.pasteInto(destinationRelativePath),
            onClearClipboard: controller.clearClipboard,
            onStartMove: controller.startMove,
            onMoveInto: (destinationRelativePath) =>
              void controller.moveInto(destinationRelativePath),
            onCancelMove: controller.cancelMove,
            onDelete: controller.requestDelete,
            onReload: tree.reloadAll
          }}
        />
      )}

      {controller.pendingDelete !== null && (
        <DeleteConfirm
          entry={controller.pendingDelete}
          loadedChildCount={
            controller.pendingDelete.type === 'directory'
              ? countLoadedEntries(tree.directories, controller.pendingDelete.relativePath)
              : null
          }
          busy={actions.busy}
          onConfirm={() => void controller.confirmDelete()}
          onCancel={controller.cancelDelete}
        />
      )}
    </div>
  )
}

/**
 * 表示方式のボタン（ツリー / カラム）。
 *
 * **押した時点で「選んだ」ことになる**（以降リサイズでは変わらない。
 * filesLayoutMode.ts）。今出ている方をもう一度押すと、パネルの形に合わせる状態へ戻る
 * ── 戻す手段を別のボタンとして足さないのは、ツールバーに増やすほどの頻度の操作では
 * ないため。今どちらの決まり方をしているかは、ボタンの説明（title）に出る。
 */
function ViewModeSwitch({ layout }: { readonly layout: FilesLayoutController }): JSX.Element {
  return (
    <div
      className="fx-files__view-group"
      role="group"
      aria-label="Files の表示方式"
      data-preference={layout.preference.kind}
    >
      <ViewModeButton layout={layout} mode="tree" label="ツリー表示" icon={<TreeViewIcon />} />
      <ViewModeButton
        layout={layout}
        mode="columns"
        label="カラム表示"
        icon={<ColumnsViewIcon />}
      />
    </div>
  )
}

function ViewModeButton({
  layout,
  mode,
  label,
  icon
}: {
  readonly layout: FilesLayoutController
  readonly mode: FilesLayoutMode
  readonly label: string
  readonly icon: JSX.Element
}): JSX.Element {
  const active = layout.mode === mode
  const chosen = layout.preference.kind === 'explicit'

  return (
    <button
      type="button"
      className="fx-files__view-button"
      aria-label={label}
      aria-pressed={active}
      data-active={active}
      data-mode={mode}
      title={
        active && chosen
          ? `${label}（選択中。もう一度押すとパネルの形に合わせます）`
          : `${label}へ切り替え`
      }
      onClick={() => (active && chosen ? layout.followPanelShape() : layout.chooseMode(mode))}
    >
      {icon}
    </button>
  )
}
