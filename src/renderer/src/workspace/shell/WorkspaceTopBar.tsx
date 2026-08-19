import type { JSX } from 'react'
import { useWorkspaceFolder } from '../../workspaceFolder/context'
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
 *   Workspace … 開いているプロジェクトフォルダ（開く / 閉じる）と、その名前の表示
 *   View      … パネルの表示 / 非表示。閉じたパネルを見つけて戻せる唯一の入口
 *   Layout    … レイアウトプリセットの切り替え
 *
 * View メニューが**登録されているパネルすべて**を並べるのが要点。
 * レイアウトから外れても Panel Registry の定義は残るため、閉じたパネルもここに出続ける
 * （閉じる ≠ 定義を消す。layout/panelVisibility.ts）。
 *
 * Workspace だけは Shell の状態ではなく、外側の Context（workspaceFolder/）から読む。
 * どのパネルからも同じ値が要るためで、ここは表示と操作の入口を置いているだけ。
 *
 * 後続セッションでここに載るもの:
 *   - 自作レイアウトの保存（DESIGN.md §3）
 *   - 最近開いた Workspace の一覧
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
  const { status, workspace, busy, openFolder, closeWorkspace } = useWorkspaceFolder()

  /*
    「閉じる」は Workspace が開いているときだけ並べる。
    WorkspaceMenu に無効状態を持たせていないのは、押せない項目を並べるより
    「そのとき選べるものだけを出す」方が、メニューの意味が読み取りやすいため。
  */
  const workspaceItems: readonly WorkspaceMenuItem[] = [
    { key: 'open', label: 'フォルダを開く…', onSelect: openFolder },
    ...(workspace === null
      ? []
      : [{ key: 'close', label: 'Workspace を閉じる', onSelect: closeWorkspace }])
  ]

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

      {/*
        取得中は「未選択」と区別が付かないため、まだ名前を出さない。
        先に「未選択」を出すと、復元された瞬間に文言が入れ替わって見える。
      */}
      <span
        className="fx-topbar__workspace"
        data-workspace-state={workspaceState(status, workspace !== null)}
        title={workspace?.rootPath}
      >
        {status === 'loading' ? '' : (workspace?.displayName ?? 'Workspace 未選択')}
      </span>

      <WorkspaceMenu label="Workspace" items={workspaceItems} />
      {busy && <span className="fx-topbar__slot">処理中…</span>}

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

/** 表示上の状態を1つの属性にまとめる（CSS と、起動確認の手掛かりを兼ねる）。 */
function workspaceState(
  status: 'loading' | 'ready',
  hasWorkspace: boolean
): 'loading' | 'open' | 'none' {
  if (status === 'loading') {
    return 'loading'
  }

  return hasWorkspace ? 'open' : 'none'
}
