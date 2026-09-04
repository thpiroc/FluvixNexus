import { useCallback, type CSSProperties, type JSX } from 'react'
import { useI18n } from '../../i18n/context'
import type { PanelDragController } from '../dnd/usePanelDrag'
import { resolveActivePanelId } from '../layout/tree'
import type { DockGroupNode, DockNodeId } from '../layout/types'
import { getPanelDefinition } from '../panels/registry'
import type { PanelId } from '../panels/types'
import { DockGuideOverlay } from './DockGuideOverlay'
import { PanelGroup } from './PanelGroup'

/**
 * Dock 可能な1領域（レイアウトの木の葉）。
 *
 * レイアウトデータ（DockGroupNode）を受け取って描画するだけの層で、自分で状態を持たない。
 * Dock / Split / リサイズはすべてレイアウト側の操作として実装し、
 * このコンポーネントは「結果として今どうなっているか」を描くことに徹する。
 *
 * 自分がどの位置（左 / 中央 / 下）にあるかは知らない。位置は木の形から決まるものであり、
 * 領域自身の性質ではないため。並びと大きさは親の split が style として渡す。
 *
 * ドラッグ&ドロップに対しては、自分の DOM 要素を当たり判定用に預ける（registerDockArea）ところと、
 * ドラッグ中にガイドを描くところだけを担う。どこへ落ちたかの判定も、
 * その結果レイアウトをどう変えるかも、このコンポーネントは持たない。
 *
 * リサイズについても同じで、この領域は何も持たない。境界の掴み手は領域の中ではなく
 * 領域と領域の間（親 split の直下）に置かれ、大きさは親から style として渡ってくる
 * ＝「自分の大きさを自分で決めない」という上の原則がそのまま保たれる。
 */

interface DockAreaProps {
  readonly group: DockGroupNode
  /** 親の split が決めた並び方（幅・高さ・伸縮）。 */
  readonly style: CSSProperties
  readonly onActivatePanel: (groupId: DockNodeId, panelId: PanelId) => void
  readonly onClosePanel: (panelId: PanelId) => void
  readonly drag: PanelDragController
}

export function DockArea({
  group,
  style,
  onActivatePanel,
  onClosePanel,
  drag
}: DockAreaProps): JSX.Element {
  const { t } = useI18n()
  const activePanelId = resolveActivePanelId(group)
  const { registerDockArea } = drag

  const setAreaRef = useCallback(
    (element: HTMLDivElement | null): void => {
      registerDockArea(group.id, element)
    },
    [registerDockArea, group.id]
  )

  // ガイドを出すのは、このドラッグを受け入れられる領域だけ。
  // 落としても何も起きない領域に案内を出さないため（判定は dnd/dropTarget.ts）。
  // 色は運んでいるパネルのものを使うため、出す / 出さないと色の解決を1つの値にまとめる。
  const guideAccent =
    drag.state !== null && drag.state.droppableGroupIds.has(group.id)
      ? getPanelDefinition(drag.state.panelId).accent
      : null

  const over = drag.state?.over ?? null
  const here = over !== null && over.groupId === group.id ? over : null

  return (
    <div
      className={activePanelId === null ? 'fx-dock-area fx-dock-area--empty' : 'fx-dock-area'}
      style={style}
      ref={setAreaRef}
      data-drop-active={here !== null && here.target !== null}
    >
      {/*
        パネルが無い領域は正規化で木から取り除かれるため、空になりうるのは root だけ
        （＝すべてのパネルを閉じた状態）。空でもドロップ先にはなる。
        戻し方が分からなくなる行き止まりにしないよう、入口を文言で示しておく。
      */}
      {activePanelId === null ? (
        <span className="fx-dock-area__empty-label">{t('workspace.emptyDock')}</span>
      ) : (
        <PanelGroup
          panelIds={group.panelIds}
          activePanelId={activePanelId}
          draggingPanelId={drag.state?.panelId ?? null}
          onActivate={(panelId) => onActivatePanel(group.id, panelId)}
          onClose={onClosePanel}
          onPanelDragStart={drag.beginDrag}
        />
      )}

      {guideAccent !== null && (
        <DockGuideOverlay
          activeZone={here?.zone ?? null}
          allowed={here !== null && here.target !== null}
          accent={guideAccent}
        />
      )}
    </div>
  )
}
