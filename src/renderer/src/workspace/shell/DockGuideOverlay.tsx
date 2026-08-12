import type { JSX } from 'react'
import { DOCK_ZONES } from '../dnd/types'
import type { DockZone } from '../dnd/types'
import type { PanelAccent } from '../panels/types'

/**
 * ドラッグ中に、その領域へ落とすとどうなるかを示す表示。
 *
 * 出すのは2つ。
 *   ガイド     … 5方向（上 / 左 / 中央 / 右 / 下）の的。今狙っている方向を強調する
 *   プレビュー … 落とした結果パネルが占める範囲を、領域の上に重ねて示す
 *
 * ガイドは目印であって当たり判定ではない（pointer-events を持たない）。
 * どこに落ちるかはカーソルの座標だけで決まり（dnd/dockGuide.ts）、
 * 「的を正確に射なければ Dock できない」状態を作らないため。
 *
 * 中央の的だけ上辺に線が入るのは、それがタブとして加わることを表すため。
 * 上下左右の的は、パネルが入る側を塗って分割の向きを表す。
 */

interface DockGuideOverlayProps {
  /** 今狙っている方向。この領域を指していなければ null。 */
  readonly activeZone: DockZone | null
  /** 狙っている方向へ実際に落とせるか。落としても何も起きない場合は false。 */
  readonly allowed: boolean
  /** 運んでいるパネルの識別色。どのパネルを置こうとしているかを色で示す。 */
  readonly accent: PanelAccent
}

export function DockGuideOverlay({
  activeZone,
  allowed,
  accent
}: DockGuideOverlayProps): JSX.Element {
  return (
    <div
      className="fx-dock-guide"
      data-accent={accent}
      data-over={activeZone !== null && allowed}
      aria-hidden="true"
    >
      {activeZone !== null && allowed && (
        <div className="fx-dock-guide__preview" data-zone={activeZone} />
      )}

      <div className="fx-dock-guide__pad">
        {DOCK_ZONES.map((zone) => (
          <div
            key={zone}
            className="fx-dock-guide__slot"
            data-zone={zone}
            data-active={zone === activeZone}
            data-allowed={zone !== activeZone || allowed}
          >
            <span className="fx-dock-guide__fill" />
          </div>
        ))}
      </div>
    </div>
  )
}
