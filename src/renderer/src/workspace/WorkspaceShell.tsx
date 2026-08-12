import { useMemo, type CSSProperties, type JSX } from 'react'
import { usePanelDrag } from './dnd/usePanelDrag'
import { DOCK_SIZE_CONSTRAINTS } from './layout/constraints'
import { listVisiblePanelIds } from './layout/panelVisibility'
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

  // View メニューのチェック状態。レイアウトから導出するため、閉じ忘れ・出し忘れが起きない。
  const visiblePanelIds = useMemo(() => new Set(listVisiblePanelIds(layout)), [layout])

  // 保存済みレイアウトを読み終えるまでは枠だけを出す（数十 ms）。
  // Default を描いてから差し替えると、起動のたびに配置が飛んで見えるうえ、
  // その間に操作されると復元で上書きすることになる。
  if (!restored) {
    return <div className="fx-workspace" style={SIZE_VARIABLES} data-restoring="true" />
  }

  return (
    <div
      className="fx-workspace"
      style={SIZE_VARIABLES}
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
