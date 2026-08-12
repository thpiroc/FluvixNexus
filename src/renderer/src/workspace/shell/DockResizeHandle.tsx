import { useMemo, type JSX } from 'react'
import type { DockNodeId, SplitDirection } from '../layout/types'
import type { SplitResizeController } from '../resize/useSplitResize'

/**
 * 領域と領域の間の掴み手。
 *
 * split の子と子の間に置かれる要素で、Session 2-3 まで CSS の border で引いていた
 * 境界線の役をそのまま引き継ぐ（見た目は 1px の線のまま、掴める幅だけを広く取る）。
 *
 * 自分では何も判断しない。掴まれたことを resize/ に伝えるだけで、
 * 移動量の解釈も、サイズの計算も、レイアウトの書き換えも持たない。
 *
 * 両隣の実サイズは resize/ が DOM から測るため、**この要素は split の直下に、
 * 対象の2領域に挟まれた位置で描かれる必要がある**（DockNodeView がその並びを作る）。
 *
 * カーソルの形（col-resize / row-resize）は workspace.css が親 split の
 * data-direction から出し分ける。
 */

interface DockResizeHandleProps {
  readonly splitId: DockNodeId
  /** children[index] と children[index + 1] の間。 */
  readonly index: number
  readonly direction: SplitDirection
  readonly resize: SplitResizeController
}

export function DockResizeHandle({
  splitId,
  index,
  direction,
  resize
}: DockResizeHandleProps): JSX.Element {
  const boundary = useMemo(() => ({ splitId, index, direction }), [splitId, index, direction])

  const active =
    resize.state !== null &&
    resize.state.boundary.splitId === splitId &&
    resize.state.boundary.index === index

  return (
    <div
      className="fx-dock-resize-handle"
      // 分割線としての意味を持たせる。row（横並び）を分けるのは縦の線。
      role="separator"
      aria-orientation={direction === 'row' ? 'vertical' : 'horizontal'}
      data-active={active}
      // 実機での確認（境界の指定）に使う。
      data-split-id={splitId}
      data-boundary-index={index}
      onPointerDown={(event) => resize.beginResize(boundary, event)}
    />
  )
}
