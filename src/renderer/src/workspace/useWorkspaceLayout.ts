import { useCallback, useMemo, useState } from 'react'
import { closePanelInLayout, openPanelInLayout } from './layout/panelVisibility'
import {
  activatePanelInLayout,
  movePanel as movePanelInLayout,
  type DockTarget
} from './layout/operations'
import { DEFAULT_LAYOUT_PRESET_ID, getLayoutPreset, type LayoutPresetId } from './layout/presets'
import { resizeSplitBoundary } from './layout/resize'
import { findLayoutProblems } from './layout/tree'
import type { DockNodeId, WorkspaceLayout } from './layout/types'
import type { PanelId } from './panels/types'
import { isSameLayout } from './persistence/layoutDocument'
import { useLayoutPersistence } from './persistence/useLayoutPersistence'

/**
 * Workspace のレイアウト状態を保持する。
 *
 * レイアウトの持ち主を Shell の1箇所に固定するための hook。
 * 判断そのものは operations.ts / panelVisibility.ts の純粋関数に任せ、
 * ここは「状態をどう持つか」だけを扱う。
 *
 * **layout/ の中ではなく WorkspaceShell の隣に置いている。** layout/ は React にも DOM にも
 * 依存しないデータ層で、下位の層（dnd / resize / persistence）から一方向に参照されるだけの
 * 位置に居る。この hook は React に依存し、しかも layout/ と persistence/ の両方を束ねるため、
 * layout/ の中に置くと「データ層が保存の都合を知っている」形になり、
 * layout/ ↔ persistence/ の参照が往復する。束ねる役は Shell 側の責務として外に出す。
 *
 * 持つのはレイアウトと、それが**どのプリセットから始まったか**の2つ。
 * パネルの表示 / 非表示は状態として持たない（レイアウトに居るかどうかがそのまま答え。
 * panelVisibility.ts）。持ってしまうと2つの正本ができ、必ずずれる。
 *
 * 保存 / 復元（Session 2-6）もこの内側で完結させる。レイアウトの持ち主が1箇所である以上、
 * 「変わったら保存する」「起動時に読み込む」を差し込める場所もここしかない。
 * 判断は persistence/ 側にあり、この hook は state との受け渡しだけを持つ。
 *
 * 後続セッションでの拡張:
 *   - パネルが増えて prop の受け渡しが深くなったら Context に載せ替える
 *     （公開しているのが下の interface だけなので、利用側の書き換えは要らない）
 */
export interface WorkspaceLayoutController {
  readonly layout: WorkspaceLayout
  /** 今の配置の元になっているレイアウトプリセット。 */
  readonly presetId: LayoutPresetId
  /** プリセットを適用してから配置を変えたか（初期化ボタンの必要性を示すため）。 */
  readonly modified: boolean
  /**
   * 保存済みレイアウトの読み込みが済んだか。
   *
   * false の間の layout は「まだ前回の配置を反映していない Default」であり、
   * 描画すると起動のたびに配置が飛んで見える（persistence/useLayoutPersistence.ts）。
   */
  readonly restored: boolean
  /** 領域内のタブを切り替える。 */
  readonly activatePanel: (groupId: DockNodeId, panelId: PanelId) => void
  /** パネルを別の領域へ移す（タブとして / 分割して）。 */
  readonly movePanel: (panelId: PanelId, target: DockTarget) => void
  /**
   * パネルを開く。
   *
   * 閉じていたものは既定の位置へ戻り、既に出ているものはタブが手前に出るだけ
   * （配置ルールは panelVisibility.ts）。
   */
  readonly openPanel: (panelId: PanelId) => void
  /**
   * パネルを閉じる。
   *
   * レイアウトから外すだけで、Panel Registry の定義には触れない。
   * 空になった領域は自動で片付く。
   */
  readonly closePanel: (panelId: PanelId) => void
  /**
   * split の中の境界を動かす（掴み手のドラッグ）。
   *
   * startSizes はドラッグ開始時に測った両側の実サイズ、delta は開始位置からの累計移動量。
   * 途中の値ではなく開始時の値を基準にするのは、丸めと下限での頭打ちが積み重ならないようにするため。
   */
  readonly resizeSplit: (
    splitId: DockNodeId,
    index: number,
    startSizes: readonly [number, number],
    delta: number
  ) => void
  /**
   * レイアウトを丸ごと差し替える。
   *
   * 用途はリサイズのキャンセル（開始前の状態へ戻す）。
   * 保存したレイアウトの読み込みは、プリセットも一緒に戻す必要があるため
   * この経路ではなく hook の内側（restore）で行う。
   */
  readonly replaceLayout: (layout: WorkspaceLayout) => void
  /** レイアウトプリセットを適用する。今の配置は捨てられる。 */
  readonly applyPreset: (presetId: LayoutPresetId) => void
  /** 今のプリセットの配置へ戻す（＝レイアウトの初期化）。 */
  readonly resetLayout: () => void
}

interface WorkspaceLayoutState {
  readonly layout: WorkspaceLayout
  readonly presetId: LayoutPresetId
  /**
   * プリセットを適用した直後のレイアウト。
   *
   * 「変更されたか」を持ち回らずに済ませるための基準。操作関数は変化が無ければ
   * 元のオブジェクトをそのまま返すため、参照が同じであることが未変更と同義になる
   * （リサイズをキャンセルして元へ戻った場合も、参照が戻るので未変更に戻る）。
   */
  readonly presetLayout: WorkspaceLayout
}

export function useWorkspaceLayout(): WorkspaceLayoutController {
  const [state, setState] = useState<WorkspaceLayoutState>(() =>
    presetState(DEFAULT_LAYOUT_PRESET_ID)
  )

  const update = useCallback((change: (current: WorkspaceLayoutState) => WorkspaceLayout): void => {
    setState((current) => {
      const layout = checked(change(current))

      return layout === current.layout ? current : { ...current, layout }
    })
  }, [])

  const activatePanel = useCallback(
    (groupId: DockNodeId, panelId: PanelId): void => {
      update((current) => activatePanelInLayout(current.layout, groupId, panelId))
    },
    [update]
  )

  const movePanel = useCallback(
    (panelId: PanelId, target: DockTarget): void => {
      update((current) => movePanelInLayout(current.layout, panelId, target))
    },
    [update]
  )

  const openPanel = useCallback(
    (panelId: PanelId): void => {
      // 戻り先はプリセットを設計図として決める（layout/panelVisibility.ts）。
      update((current) =>
        openPanelInLayout(current.layout, panelId, getLayoutPreset(current.presetId).createLayout())
      )
    },
    [update]
  )

  const closePanel = useCallback(
    (panelId: PanelId): void => {
      update((current) => closePanelInLayout(current.layout, panelId))
    },
    [update]
  )

  const resizeSplit = useCallback(
    (
      splitId: DockNodeId,
      index: number,
      startSizes: readonly [number, number],
      delta: number
    ): void => {
      update((current) => resizeSplitBoundary(current.layout, splitId, index, startSizes, delta))
    },
    [update]
  )

  const replaceLayout = useCallback(
    (next: WorkspaceLayout): void => {
      update(() => next)
    },
    [update]
  )

  const applyPreset = useCallback((presetId: LayoutPresetId): void => {
    setState(presetState(presetId))
  }, [])

  const resetLayout = useCallback((): void => {
    // 画面だけでなく保存済みレイアウトも Default に戻る。state が変わることで
    // 通常の保存経路（useLayoutPersistence）がそのまま書き換えるため、
    // 「初期化」のための専用の保存処理は要らない。
    setState((current) => presetState(current.presetId))
  }, [])

  /**
   * 保存されていたレイアウトを採用する（起動時に1度だけ）。
   *
   * presetLayout をプリセットから作り直すのは、`modified` の基準がプリセットの配置だから。
   * 保存されていた配置がプリセットと同じ形なら**プリセット側のオブジェクトを採る**。
   * `modified` は参照の一致で判定しているため（下の useMemo）、こうしないと
   * 「レイアウトを初期化 → 再起動」しただけで変更ありに見えてしまう。
   */
  const restore = useCallback((layout: WorkspaceLayout, presetId: LayoutPresetId): void => {
    setState(() => {
      const presetLayout = checked(getLayoutPreset(presetId).createLayout())

      return {
        layout: isSameLayout(layout, presetLayout) ? presetLayout : checked(layout),
        presetId,
        presetLayout
      }
    })
  }, [])

  const { restored } = useLayoutPersistence({
    layout: state.layout,
    presetId: state.presetId,
    onRestore: restore
  })

  return useMemo(
    () => ({
      layout: state.layout,
      presetId: state.presetId,
      modified: state.layout !== state.presetLayout,
      restored,
      activatePanel,
      movePanel,
      openPanel,
      closePanel,
      resizeSplit,
      replaceLayout,
      applyPreset,
      resetLayout
    }),
    [
      state,
      restored,
      activatePanel,
      movePanel,
      openPanel,
      closePanel,
      resizeSplit,
      replaceLayout,
      applyPreset,
      resetLayout
    ]
  )
}

/** プリセットを適用した直後の状態。適用は「今の配置を捨てて作り直す」操作。 */
function presetState(presetId: LayoutPresetId): WorkspaceLayoutState {
  const layout = checked(getLayoutPreset(presetId).createLayout())

  return { layout, presetId, presetLayout: layout }
}

/**
 * 開発ビルドでのみ、操作の結果が正規形から外れていないかを見る。
 *
 * レイアウトの破綻は「操作した瞬間」ではなく、その後の操作や保存・復元で表面化する。
 * 壊れた状態を作った操作そのものを指したいので、状態に入れる直前で検査する。
 * プリセットの適用も同じ経路に通す（プリセットの定義ミスも同じ形で表に出る）。
 * 配布ビルドでは Vite が定数畳み込みで丸ごと落とす。
 */
function checked(layout: WorkspaceLayout): WorkspaceLayout {
  if (import.meta.env.DEV) {
    const problems = findLayoutProblems(layout)

    if (problems.length > 0) {
      console.error('[workspace] レイアウトが不正な状態になりました', problems)
    }
  }

  return layout
}
