import type { JSX } from 'react'
import { getLayoutPreset, listLayoutPresets, type LayoutPresetId } from '../layout/presets'
import { listPanelDefinitions } from '../panels/registry'
import type { PanelId } from '../panels/types'
import { WorkspaceMenu, type WorkspaceMenuItem } from './WorkspaceMenu'

/**
 * Workspace の上部領域。
 *
 * Dock 対象の領域ではなく、Shell 自身の外枠。
 * ここに置くのは「レイアウトそのものを操作するもの」に限る（パネルの機能は各パネルの責務）。
 *
 *   View   … パネルの表示 / 非表示。閉じたパネルを見つけて戻せる唯一の入口
 *   Layout … レイアウトプリセットの切り替え
 *
 * View メニューが**登録されているパネルすべて**を並べるのが要点。
 * レイアウトから外れても Panel Registry の定義は残るため、閉じたパネルもここに出続ける
 * （閉じる ≠ 定義を消す。layout/panelVisibility.ts）。
 *
 * 後続セッションでここに載るもの:
 *   - 自作レイアウトの保存（DESIGN.md §3）
 *   - ワークスペース（開いているフォルダ）の選択
 */

interface WorkspaceTopBarProps {
  /** 今レイアウトに置かれているパネル。View メニューのチェック状態になる。 */
  readonly visiblePanelIds: ReadonlySet<PanelId>
  readonly presetId: LayoutPresetId
  /** プリセットを適用してから配置を変えたか。 */
  readonly modified: boolean
  /** 表示中なら閉じ、閉じていれば既定の位置へ戻す。 */
  readonly onTogglePanel: (panelId: PanelId) => void
  readonly onApplyPreset: (presetId: LayoutPresetId) => void
  readonly onResetLayout: () => void
}

export function WorkspaceTopBar({
  visiblePanelIds,
  presetId,
  modified,
  onTogglePanel,
  onApplyPreset,
  onResetLayout
}: WorkspaceTopBarProps): JSX.Element {
  const panelItems: readonly WorkspaceMenuItem[] = listPanelDefinitions().map((definition) => ({
    key: definition.id,
    label: definition.title,
    state: visiblePanelIds.has(definition.id) ? 'checked' : 'unchecked',
    onSelect: () => onTogglePanel(definition.id)
  }))

  const presetItems: readonly WorkspaceMenuItem[] = listLayoutPresets().map((preset) => ({
    key: preset.id,
    label: preset.title,
    hint: preset.description,
    state: preset.id === presetId ? 'selected' : 'unselected',
    onSelect: () => onApplyPreset(preset.id)
  }))

  return (
    <header className="fx-topbar">
      <span className="fx-topbar__title">Fluvix Nexus</span>

      <WorkspaceMenu label="View" items={panelItems} />
      <WorkspaceMenu label={`Layout: ${getLayoutPreset(presetId).title}`} items={presetItems} />

      {/* 初期化ボタンが何のためにあるかを示す（プリセットのままなら押す意味が無い）。 */}
      {modified && <span className="fx-topbar__slot">変更あり</span>}

      <span className="fx-topbar__spacer" />

      {/*
        ドラッグ&ドロップ・リサイズで崩した配置の戻り先。
        今のプリセットを適用し直すだけで、独自の初期状態は持たない。
      */}
      <button
        type="button"
        className="fx-topbar__button"
        onClick={onResetLayout}
        disabled={!modified}
      >
        レイアウトを初期化
      </button>
    </header>
  )
}
