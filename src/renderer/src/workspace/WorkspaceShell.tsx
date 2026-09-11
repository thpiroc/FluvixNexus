import { useCallback, useMemo, useState, type CSSProperties, type JSX } from 'react'
import { useCommand } from '../commands/useCommand'
import { useWhenFlag } from '../keybindings/useWhenFlag'
import { SettingsOverlay } from '../settings/SettingsOverlay'
import { useWorkspaceFolder } from '../workspaceFolder/context'
import { usePanelDrag } from './dnd/usePanelDrag'
import { DOCK_SIZE_CONSTRAINTS } from './layout/constraints'
import { listVisiblePanelIds } from './layout/panelVisibility'
import type { PanelId } from './panels/types'
import { useSplitResize } from './resize/useSplitResize'
import { useWorkspaceLayout } from './useWorkspaceLayout'
import { DockNodeView, ROOT_NODE_STYLE } from './shell/DockNodeView'
import { WorkspaceStatusBar } from './shell/WorkspaceStatusBar'
import { WorkspaceTopBar } from './shell/WorkspaceTopBar'
import './workspace.css'

/**
 * Workspace Shell。
 *
 * アプリのメイン画面全体を組み立てる唯一の場所であり、Dockable UI の土台。
 *
 * 責務の分け方:
 *   Shell         … 領域の構成、パネルをどこに置くか、パネル共通の枠（タブ・本体の器）
 *   Panel         … 自分の中身だけ。自分がどこに置かれているかは知らない
 *   layout/       … レイアウトをデータとして表現し、操作する（React にも DOM にも依存しない）
 *   dnd/          … マウス操作を Dock 操作の引数に翻訳する（レイアウトは書き換えない）
 *   resize/       … ポインタの移動量をサイズ操作の引数に翻訳する（同上）
 *   persistence/  … 保存形式との変換と、いつ読み書きするか
 *
 * 参照は必ず上から下へ向かう。dnd / resize / persistence はいずれも layout/ を参照するが、
 * layout/ はそのどれも知らない。3つを束ねて state にするのは useWorkspaceLayout（この隣）で、
 * レイアウトを変える経路をそこ1本に保つのが Shell の役目になる。
 *
 * 画面の構成:
 *   ┌──────────────────────────────┐
 *   │ WorkspaceTopBar              │  Shell の外枠（Dock 対象外）
 *   ├──────────────────────────────┤
 *   │                              │
 *   │   レイアウトの木をそのまま描く   │  Dock 対象。領域の並びは木の形が決める
 *   │                              │
 *   ├──────────────────────────────┤
 *   │ WorkspaceStatusBar           │  Shell の外枠（Dock 対象外）
 *   └──────────────────────────────┘
 *
 * レイアウトの持ち主をここ1箇所に固定しているのは、マウス操作の結末が必ず
 * レイアウト側の操作（movePanel / resizeSplitBoundary）を通るようにするため。
 * この形にしておくと、入口が増えても（メニュー・ショートカット・レイアウトプリセット）
 * レイアウトを変える経路は1つのまま保てる。
 *
 * ドラッグ&ドロップとリサイズは互いを知らない。掴む対象が別（タブ / 境界の掴み手）で、
 * 同時に始まることが無いため、それぞれが独立した hook として並ぶ。
 *
 * パネルの表示 / 非表示もレイアウトの操作として扱う。「今どのパネルが出ているか」は
 * レイアウトから導出するだけで、可視状態のための別の状態を持たない
 * （layout/panelVisibility.ts）。
 *
 * レイアウトの保存 / 復元（Session 2-6）も同じ形に収まっている。保存されるのは
 * WorkspaceLayout そのものであり、Dock / ドラッグ&ドロップ / リサイズ / 表示管理 /
 * プリセットのどれも、保存のための特別な処理を持たない（persistence/）。
 *
 * 開いている Workspace（プロジェクトフォルダ）は Shell の持ち物ではない。
 * Shell の外側（App.tsx の WorkspaceFolderProvider）が持ち、必要なパネルが
 * useWorkspaceFolder() で読む。レイアウトは「どこに何を置くか」だけを扱い、
 * パネルが何を対象に動いているかには関わらない、という分担を保つため。
 *
 * STEP 2 の範囲外（STEP 3 以降）:
 *   - 各パネルの本機能（Files / Monaco Editor / Terminal / Git）
 *   - パネルの独立ウィンドウ化
 *   - タブのドラッグによる同一領域内での並べ替え
 *   - 利用者が組んだ配置を名前を付けて保存する（プリセットの自作）
 */
export function WorkspaceShell(): JSX.Element {
  const {
    layout,
    presetId,
    modified,
    restored,
    activatePanel,
    movePanel,
    openPanel,
    closePanel,
    resizeSplit,
    replaceLayout,
    applyPreset,
    resetLayout
  } = useWorkspaceLayout()
  const drag = usePanelDrag({ layout, movePanel })
  const resize = useSplitResize({ layout, resizeSplit, replaceLayout })

  // 開いている Workspace の取得状況。Shell 自身は Workspace を使わないが、
  // 「画面の準備がどこまで進んだか」を1箇所で見えるようにしておく
  // （レイアウトの復元と同じく、確認スクリプトが待てる目印になる）。
  const { status: workspaceStatus, workspace, openFolder, closeWorkspace } = useWorkspaceFolder()

  // View メニューのチェック状態。レイアウトから導出するため、閉じ忘れ・出し忘れが起きない。
  const visiblePanelIds = useMemo(() => new Set(listVisiblePanelIds(layout)), [layout])

  /*
    Settings（アプリ全体の設定）が開いているか（Session 4-3B）。

    ## なぜ Shell が持つか

    面はウィンドウ全体を覆い、レイアウトの外にある ── Dock の対象ではないので
    レイアウトの木には現れず、`layout` から導出できない（パネルの表示 / 非表示が
    レイアウトから導出できるのとは別のもの）。開く入口は上部バーにあり、
    出す先は Shell 全体なので、その2つを知っている**ここ**が持つ。

    保存もしない。次の起動で Settings が開いたまま出ることに意味が無い
    （レイアウトと違い、これは「今している操作」であって配置ではない）。
  */
  const [settingsOpen, setSettingsOpen] = useState(false)

  const openSettings = useCallback((): void => setSettingsOpen(true), [])
  const closeSettings = useCallback((): void => setSettingsOpen(false), [])

  /*
    ------------------------------------------------ command（Session 4-7A）

    Shell が名乗るのは「レイアウトを変えるもの」と「Shell が持っている面」
    ── どちらもここにしか持ち主が居ない（`useWorkspaceLayout` の返り値と
    `settingsOpen` は、この関数の中にしか存在しない）。

    Workspace を開く / 閉じるだけは外側の Context のものだが、**上部バーの
    入口がここにある**のと同じ理由でここが名乗る（WorkspaceTopBar.tsx の
    「上部バーはアプリ全体に関わる入口の場所」）。

    打鍵は1つも書かない。どの打鍵で呼ばれるかは keybindings/defaults.ts の
    担当で、割り当ての無い command（`workspace.closeFolder` /
    `view.togglePanel.editor` / `view.resetLayout` / `settings.close`）も
    同じように登録しておく ── 将来の Settings の一覧では
    「未割り当ての操作」として並び、そこで打鍵を付けられるようになる。
  */
  const togglePanel = useCallback(
    (panelId: PanelId): void => {
      // 上部バーの View メニューとまったく同じ判断（下の `onTogglePanel`）。
      if (visiblePanelIds.has(panelId)) {
        closePanel(panelId)
        return
      }

      openPanel(panelId)
    },
    [visiblePanelIds, openPanel, closePanel]
  )

  useCommand('workspace.openFolder', openFolder)
  useCommand(
    'workspace.closeFolder',
    useCallback((): void => {
      // 開いていなければ何もしない（打鍵側に条件を付けても、他の入口が増えうる）。
      if (workspace !== null) {
        closeWorkspace()
      }
    }, [workspace, closeWorkspace])
  )
  useCommand(
    'view.togglePanel.files',
    useCallback(() => togglePanel('files'), [togglePanel])
  )
  useCommand(
    'view.togglePanel.editor',
    useCallback(() => togglePanel('editor'), [togglePanel])
  )
  useCommand(
    'view.togglePanel.terminal',
    useCallback(() => togglePanel('terminal'), [togglePanel])
  )
  useCommand(
    'view.togglePanel.git',
    useCallback(() => togglePanel('git'), [togglePanel])
  )
  useCommand(
    'view.togglePanel.debug',
    useCallback(() => togglePanel('debug'), [togglePanel])
  )
  useCommand('view.resetLayout', resetLayout)
  useCommand('settings.open', openSettings)
  useCommand('settings.close', closeSettings)

  /*
    面が出ていることを打鍵の層へ申告する（keybindings/useWhenFlag.ts）。

    `settingsOpen` を外側の Provider へ持ち上げないための仕組み ── この面は
    レイアウトの木の外にあり、開く入口も出す先も Shell にしか無い、という
    上の判断を変えずに済む。
  */
  useWhenFlag('settingsOpen', settingsOpen)

  // 保存済みレイアウトを読み終えるまでは枠だけを出す（数十 ms）。
  // Default を描いてから差し替えると、起動のたびに配置が飛んで見えるうえ、
  // その間に操作されると復元で上書きすることになる。
  if (!restored) {
    return (
      <div
        className="fx-workspace"
        style={SIZE_VARIABLES}
        data-restoring="true"
        data-workspace-status={workspaceStatus}
      />
    )
  }

  return (
    <div
      className="fx-workspace"
      style={SIZE_VARIABLES}
      data-workspace-status={workspaceStatus}
      data-dragging={drag.state !== null}
      // リサイズ中は、カーソルが掴み手から外れても形を保つ（画面全体に掛ける）。
      data-resizing={resize.state?.boundary.direction ?? 'none'}
    >
      <WorkspaceTopBar
        visiblePanelIds={visiblePanelIds}
        presetId={presetId}
        modified={modified}
        onTogglePanel={(panelId) =>
          visiblePanelIds.has(panelId) ? closePanel(panelId) : openPanel(panelId)
        }
        onApplyPreset={applyPreset}
        onResetLayout={resetLayout}
        settingsOpen={settingsOpen}
        onOpenSettings={openSettings}
      />

      <div className="fx-workspace__main">
        <DockNodeView
          node={layout.root}
          style={ROOT_NODE_STYLE}
          onActivatePanel={activatePanel}
          onClosePanel={closePanel}
          drag={drag}
          resize={resize}
        />
      </div>

      <WorkspaceStatusBar />

      {/*
        アプリ全体の設定（Session 4-3B）。

        レイアウトの木の**外**に置く ── Dock の対象ではなく、上部バーも
        ステータスバーも覆う（settings/SettingsOverlay.tsx）。値は1つも
        持っておらず、Shell より外側の Context（Editor / Files / Terminal）から
        読んで、既存の setter へ返すだけになる。
      */}
      {settingsOpen && <SettingsOverlay onClose={closeSettings} />}
    </div>
  )
}

/**
 * 掴み手の太さを CSS 側へ渡す。
 *
 * この値は見た目（CSS）とリサイズの可動範囲の計算（layout/constraints.ts）の両方で要る。
 * 2箇所に書くとずれるため、正本を TypeScript 側に置いてカスタムプロパティとして流す。
 * 色や間隔と違い「レイアウトの制約でもある値」なので、theme.css ではなくこちらが持つ。
 */
const SIZE_VARIABLES = {
  '--fx-dock-handle-thickness': `${DOCK_SIZE_CONSTRAINTS.handleThickness}px`
} as CSSProperties
