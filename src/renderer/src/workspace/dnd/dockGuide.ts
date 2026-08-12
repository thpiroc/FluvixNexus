import type { DockSide } from '../layout/types'
import type { DockZone, DragAreaRect, DragPoint } from './types'

/**
 * カーソルの位置から「領域のどこへ落とそうとしているか」を決める。
 *
 * この判定を純粋関数として切り出してあるのは、ドラッグ&ドロップで最も間違えやすいのが
 * ここ（端の帯の広さ、角の扱い、領域外の扱い）であり、実際にマウスを動かさずに
 * 確かめられる形にしておきたいため。React も DOM もこのファイルには入らない。
 */

/** 端の帯の広さ（領域の短辺に対する割合）。0.5 未満であれば必ず中央が残る。 */
const EDGE_RATIO = 0.3

/**
 * 端の帯の上限（px）。
 *
 * 割合だけで決めると、広い領域では端の帯が数百 px になり
 * 「中央に落としたつもりが分割された」が起きる。実際に狙える幅で頭打ちにする。
 */
const EDGE_MAX_PX = 120

/** 判定の順序。角のように複数の辺が同じ深さになる場合は、この並びの先頭が勝つ。 */
const SIDES: readonly DockSide[] = ['left', 'right', 'top', 'bottom']

/**
 * 領域の中でのカーソル位置を DockZone に変換する。カーソルが領域の外なら null。
 *
 * 各辺について「端の帯にどれだけ入り込んでいるか」を 0〜1 に正規化し、最も深い辺を採る。
 * どの辺の帯にも入っていなければ中央。
 * 正規化してから比べるため、横長の領域でも角の境界は素直に対角線になる。
 */
export function resolveDockZone(rect: DragAreaRect, point: DragPoint): DockZone | null {
  if (!(rect.width > 0) || !(rect.height > 0)) {
    return null
  }

  const x = point.x - rect.left
  const y = point.y - rect.top

  if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
    return null
  }

  const bandX = Math.min(rect.width * EDGE_RATIO, EDGE_MAX_PX)
  const bandY = Math.min(rect.height * EDGE_RATIO, EDGE_MAX_PX)

  const depthOf = (side: DockSide): number => {
    switch (side) {
      case 'left':
        return x / bandX
      case 'right':
        return (rect.width - x) / bandX
      case 'top':
        return y / bandY
      case 'bottom':
        return (rect.height - y) / bandY
    }
  }

  let closest: DockSide = SIDES[0]
  let closestDepth = depthOf(closest)

  for (const side of SIDES.slice(1)) {
    const depth = depthOf(side)

    if (depth < closestDepth) {
      closest = side
      closestDepth = depth
    }
  }

  return closestDepth < 1 ? closest : 'center'
}
