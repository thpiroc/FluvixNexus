import type { JSX } from 'react'
import { useI18n } from '../../i18n/context'
import { useWorkspaceFolder } from '../../workspaceFolder/context'
import { getLayoutPresetDescription, getLayoutPresetTitle } from '../layout/presetLabels'
import { listLayoutPresets, type LayoutPresetId } from '../layout/presets'
import { getPanelTitle } from '../panels/panelLabels'
import { listPanelDefinitions } from '../panels/registry'
import type { PanelId } from '../panels/types'
import { DropdownMenu, type DropdownMenuItem } from '../../ui/DropdownMenu'

/**
 * Workspace の上部領域。
 *
 * Dock 対象の領域ではなく、Shell 自身の外枠。
 * ここに置くのは「レイアウトそのものを操作するもの」に限る（パネルの機能は各パネルの責務）。
 *
 *   Workspace … 開いているプロジェクトフォルダ（開く / 閉じる）と、その名前の表示
 *   View      … パネルの表示 / 非表示。閉じたパネルを見つけて戻せる唯一の入口
 *   Layout    … レイアウトプリセットの切り替え
 *   Settings  … アプリ全体の設定（Session 4-3B）
 *
 * Settings だけはレイアウトを何も変えない。それでもここに置いたのは、
 * 設定が Editor / Files / Terminal の3つにまたがっていて**どのパネルのものでもない**
 * ためで、Workspace を開く / 閉じるが既にここにあるのと同じ扱いになる
 * （上部バーはレイアウト専用の場所ではなく、アプリ全体に関わる入口の場所）。
 * 面そのものは Shell が出す（WorkspaceShell.tsx）── ここが持つのは入口だけ。
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
  /** Settings を開いているか（ボタンの見た目に出す）。 */
  readonly settingsOpen: boolean
  /** アプリ全体の設定を開く（Session 4-3B）。 */
  readonly onOpenSettings: () => void
  /** フィードバックの面を開いているか（ボタンの見た目に出す）。 */
  readonly feedbackOpen: boolean
  /** フィードバックの面を開く（フィードバック機能 v1）。 */
  readonly onOpenFeedback: () => void
}

export function WorkspaceTopBar({
  visiblePanelIds,
  presetId,
  modified,
  onTogglePanel,
  onApplyPreset,
  onResetLayout,
  settingsOpen,
  onOpenSettings,
  feedbackOpen,
  onOpenFeedback
}: WorkspaceTopBarProps): JSX.Element {
  const { status, workspace, busy, openFolder, closeWorkspace } = useWorkspaceFolder()
  const { t } = useI18n()

  /*
    「閉じる」は Workspace が開いているときだけ並べる。
    DropdownMenu に無効状態を持たせていないのは、押せない項目を並べるより
    「そのとき選べるものだけを出す」方が、メニューの意味が読み取りやすいため。
  */
  const workspaceItems: readonly DropdownMenuItem[] = [
    { key: 'open', label: t('workspace.openFolderEllipsis'), onSelect: openFolder },
    ...(workspace === null
      ? []
      : [{ key: 'close', label: t('workspace.closeWorkspace'), onSelect: closeWorkspace }])
  ]

  const panelItems: readonly DropdownMenuItem[] = listPanelDefinitions().map((definition) => ({
    key: definition.id,
    label: getPanelTitle(definition.id, t),
    state: visiblePanelIds.has(definition.id) ? 'checked' : 'unchecked',
    onSelect: () => onTogglePanel(definition.id)
  }))

  const presetItems: readonly DropdownMenuItem[] = listLayoutPresets().map((preset) => ({
    key: preset.id,
    label: getLayoutPresetTitle(preset.id, t),
    hint: getLayoutPresetDescription(preset.id, t),
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
        {status === 'loading' ? '' : (workspace?.displayName ?? t('workspace.noWorkspace'))}
      </span>

      <DropdownMenu label="Workspace" buttonClassName="fx-topbar__button" items={workspaceItems} />
      {busy && <span className="fx-topbar__slot">{t('workspace.busy')}</span>}

      <DropdownMenu
        label={t('workspace.viewMenu')}
        buttonClassName="fx-topbar__button"
        items={panelItems}
      />
      <DropdownMenu
        label={t('workspace.layoutMenu', { title: getLayoutPresetTitle(presetId, t) })}
        buttonClassName="fx-topbar__button"
        items={presetItems}
      />

      {/* 初期化ボタンが何のためにあるかを示す（プリセットのままなら押す意味が無い）。 */}
      {modified && <span className="fx-topbar__slot">{t('workspace.modified')}</span>}

      <span className="fx-topbar__spacer" />

      {/*
        アプリ全体の設定（Session 4-3B）。

        ## 上部バーに置く

        設定は Editor / Files / Terminal の3つにまたがるので、どのパネルの中にも
        置けない ── パネルに置くと、そのパネルを閉じた人から設定が消える。
        上部バーは「レイアウトそのものを操作するもの」の場所だが、Workspace を
        開く / 閉じるが既にここにあるとおり、**アプリ全体に関わる入口**も
        ここが引き受けている（レイアウト専用の場所ではない）。

        ## 右端に置く

        左から Workspace → View → Layout と、扱う範囲が狭いものから並んでいる。
        Settings はその並びに属さない（レイアウトを何も変えない）ので、
        「レイアウトを初期化」と同じく余白の向こう側に置く。

        フィードバック（v1）も同じ理由で Settings の隣に置く ── どのパネルの
        ものでもなく、レイアウトも変えない。面そのものは Shell が出す。
      */}
      <button
        type="button"
        className="fx-topbar__button"
        data-testid="topbar-feedback"
        data-open={feedbackOpen}
        onClick={onOpenFeedback}
        title={t('workspace.feedbackTitle')}
      >
        {t('workspace.feedbackButton')}
      </button>

      <button
        type="button"
        className="fx-topbar__button"
        data-testid="topbar-settings"
        data-open={settingsOpen}
        onClick={onOpenSettings}
        title={t('workspace.settingsTitle')}
      >
        {t('workspace.settingsButton')}
      </button>

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
        {t('workspace.resetLayout')}
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
