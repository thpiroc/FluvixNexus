import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import { useI18n } from '../../i18n/context'
import { getPanelTitle } from '../panels/panelLabels'
import { getPanelDefinition } from '../panels/registry'
import type { PanelId } from '../panels/types'

/**
 * 同じ領域に置かれたパネルの束。
 *
 * パネルを配置できる共通コンテナはこれ1つに統一する。
 * どの領域でも同じコンポーネントを使うため、Dock でパネルが領域をまたいで移動しても
 * 見た目と操作は変わらない。
 *
 * このコンポーネントが持つのは「タブの並び」と「本体の枠」だけで、
 * 中身は Registry から解決したパネルに任せる（Shell と Panel の責務分離）。
 *
 * ドラッグの開始点はタブ（と、タブ列の空き部分）。
 * ここは「掴まれた」ことを伝えるだけで、ドラッグの追跡もドロップ先の判定も持たない
 * （dnd/usePanelDrag.ts）。タブのクリックによる切り替えは、
 * しきい値を超えるまでドラッグにならないため従来どおり動く。
 *
 * 閉じる操作も同じで、ここは「押された」ことを伝えるだけ。
 * 閉じた結果この領域が消えるかどうかはレイアウト側の判断であり
 * （最後の1枚なら領域ごと畳まれる）、このコンポーネントは何も後片付けしない。
 *
 * タブを button の入れ子にできないため、タブ1枚は
 * 「切り替えのボタン」と「閉じるボタン」を並べた小さな器になっている。
 * role="tab" は器の側が持つ。
 *
 * STEP 2 の範囲外（STEP 3 以降）:
 *   - タブのドラッグによる同一領域内での並べ替え
 *     （レイアウト操作は movePanel の `{ kind: 'tab', index }` として実装済みで、
 *      足りていないのは dnd/ 側のタブ列の当たり判定だけ）
 *   - タブの右クリックメニュー、独立ウィンドウ化
 */

interface PanelGroupProps {
  readonly panelIds: readonly PanelId[]
  /** 手前に出ているパネル。呼び出し側で resolveActivePanelId 済みの値を渡す。 */
  readonly activePanelId: PanelId
  /** 今ドラッグされているパネル。この領域のものでなければ含まれないだけ。 */
  readonly draggingPanelId: PanelId | null
  readonly onActivate: (panelId: PanelId) => void
  readonly onClose: (panelId: PanelId) => void
  readonly onPanelDragStart: (panelId: PanelId, event: ReactPointerEvent) => void
}

export function PanelGroup({
  panelIds,
  activePanelId,
  draggingPanelId,
  onActivate,
  onClose,
  onPanelDragStart
}: PanelGroupProps): JSX.Element {
  const { t } = useI18n()
  const active = getPanelDefinition(activePanelId)
  const ActivePanel = active.Component

  return (
    <section className="fx-panel-group" data-accent={active.accent}>
      {/* タブは1枚だけのときもそのまま出す。パネルの見出しを兼ねているため。 */}
      <div
        className="fx-panel-group__tabs"
        role="tablist"
        // タブ列の空き部分も掴めるようにする（＝見出しを掴む感覚）。
        // タブ自身から伝わってきた分は下のボタンが既に扱っているため無視する。
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            onPanelDragStart(activePanelId, event)
          }
        }}
      >
        {panelIds.map((panelId) => {
          const definition = getPanelDefinition(panelId)
          const title = getPanelTitle(panelId, t)
          const isActive = panelId === activePanelId

          return (
            <div
              key={panelId}
              role="tab"
              aria-selected={isActive}
              className="fx-panel-tab"
              data-panel={panelId}
              data-accent={definition.accent}
              data-active={isActive}
              data-dragging={panelId === draggingPanelId}
            >
              <button
                type="button"
                className="fx-panel-tab__label"
                onPointerDown={(event) => onPanelDragStart(panelId, event)}
                onClick={() => onActivate(panelId)}
              >
                {title}
              </button>

              {/*
                閉じるボタンはドラッグの開始点ではない。onPointerDown を持たないため、
                ここを押してもドラッグにはならない（タブ列側の判定も target が違うので素通り）。
              */}
              <button
                type="button"
                className="fx-panel-tab__close"
                aria-label={t('workspace.closePanel', { title })}
                title={t('workspace.closePanel', { title })}
                onClick={() => onClose(panelId)}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>

      {/*
        スクロールはこの枠の内側で完結させる（ウィンドウ全体はスクロールさせない）。

        `data-panel-body` は「今どのパネルの中に focus があるか」を打鍵の層が
        読むための目印（Session 4-7A。keybindings/KeybindingProvider.tsx）。
        focus の持ち主はブラウザであって React ではないため、状態としては
        受け取れない ── 器に印を付けて `closest()` で辿るのが一番短い。

        タブ側の `data-panel` と名前を分けてあるのは、タブがこの器の**外**に
        あるため。同じ名前にすると、タブに focus があるときも
        「そのパネルの中に居る」と読めてしまう。
      */}
      <div className="fx-panel-group__body" role="tabpanel" data-panel-body={activePanelId}>
        <ActivePanel />
      </div>
    </section>
  )
}
