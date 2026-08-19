/**
 * ドラッグ中の自動スクロールの計算（React にも DOM にも依存しない。Session 3-6-8）。
 *
 * Session 3-6-3 でドラッグ&ドロップを入れた時点では、行き先が画面の外にある場合は
 * **いったん離して掴み直す**しかなかった（ARCHITECTURE.md §10.9「この節の範囲外」）。
 * 深いツリーや長いフォルダでは、1回の移動のために掴み直しが何度も要る ──
 * ドラッグという操作そのものが「離すまでが1つ」なので、途中で離す必要があること自体が
 * 操作の形と食い違っている。
 *
 * ## ここが答えるのは「1フレームでどれだけ動かすか」だけ
 *
 * どの要素を動かすかも、いつ動かすかも持たない（それは useFileDrag.ts）。
 * dragDrop.ts（落とせるかの判断）・filesLayoutMode.ts（表示方式の判断）と同じ立ち位置で、
 * **判断だけを純粋な関数として置く**とテストがそのまま書ける。
 *
 * ## 器の中にいる間だけ動かす
 *
 * カーソルが器の外にある間は動かさない。外は**そもそも落とせない場所**であり
 * （useFileDrag.ts の findZone）、落とせない位置で中身が流れ続けると、
 * 隣のパネルへ運ぼうとしただけでツリーが勝手に動く。
 *
 * ## 縁に近いほど速い
 *
 * 一定の速さにすると、少し入っただけで一気に流れる（行き過ぎる）か、
 * 端まで運ぶのに時間がかかりすぎるかのどちらかになる。縁からの距離で速さを変えると、
 * **止めたい所で止まり、遠くへ運ぶときは速い**という1つの動きで両方に応える。
 */

/** 器の矩形（DOM の DOMRect のうち、ここで使う4つだけ）。 */
export interface AutoScrollRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** カーソルの位置。 */
export interface AutoScrollPoint {
  readonly x: number
  readonly y: number
}

/** 1フレームで動かす量（px）。動かさないときは 0。 */
export interface AutoScrollDelta {
  readonly x: number
  readonly y: number
}

/**
 * 縁から数えて自動スクロールが始まる幅（px）。
 *
 * 行1つ分（22px）より少し広い。狭くすると、端の行を指したいだけで流れ始める。
 */
export const AUTO_SCROLL_EDGE_PX = 28

/**
 * 1フレームで動かす最大の量（px）。
 *
 * 60fps でおよそ 1000px/秒。これ以上速くすると、通り過ぎた場所を目で追えない。
 */
export const AUTO_SCROLL_MAX_STEP_PX = 16

export interface AutoScrollOptions {
  readonly edge?: number
  readonly maxStep?: number
}

/**
 * カーソルの位置から、この器を1フレームでどれだけ動かすかを求める。
 *
 * 縦と横は独立に決める ── カラム表示では**横は器、縦はカラムの中**が動くため、
 * 片方だけが動く場面が普通にある（useFileDrag.ts が軸ごとに別の要素へ当てる）。
 *
 * 器が縁の幅の2倍より狭い場合（短いカラムなど）は、両側の帯が重なる。
 * そのときは**近い方の縁が勝つ** ── 重なりを禁じると、狭い器では自動スクロールが
 * まったく効かなくなる。
 */
export function computeAutoScrollDelta(
  rect: AutoScrollRect,
  point: AutoScrollPoint,
  options: AutoScrollOptions = {}
): AutoScrollDelta {
  const edge = options.edge ?? AUTO_SCROLL_EDGE_PX
  const maxStep = options.maxStep ?? AUTO_SCROLL_MAX_STEP_PX

  // 器の外は動かさない（落とせない場所で中身を流さない）。
  if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) {
    return NO_AUTO_SCROLL
  }

  return {
    x: axisStep(point.x - rect.left, rect.right - point.x, edge, maxStep),
    y: axisStep(point.y - rect.top, rect.bottom - point.y, edge, maxStep)
  }
}

/** 動かさない。 */
const NO_AUTO_SCROLL: AutoScrollDelta = { x: 0, y: 0 }

/**
 * 1つの軸について、手前の縁と奥の縁からの距離から動かす量を決める。
 *
 * 手前（左 / 上）に近ければ負、奥（右 / 下）に近ければ正。どちらの帯にも入っている
 * 狭い器では、近い方（距離が小さい方）を採る。
 */
function axisStep(fromStart: number, fromEnd: number, edge: number, maxStep: number): number {
  if (edge <= 0) {
    return 0
  }

  const towardStart = fromStart < edge && fromStart <= fromEnd
  const towardEnd = fromEnd < edge && fromEnd < fromStart

  if (towardStart) {
    return -stepFor(fromStart, edge, maxStep)
  }

  if (towardEnd) {
    return stepFor(fromEnd, edge, maxStep)
  }

  return 0
}

/**
 * 縁からの距離を速さへ。
 *
 * 帯の中に入った時点で最低 1px は動く（`ceil`）。0 から始めると、帯の入口付近に
 * 「入っているのに何も起きない」幅ができて、効いていないように見える。
 */
function stepFor(distance: number, edge: number, maxStep: number): number {
  const ratio = Math.min(Math.max((edge - distance) / edge, 0), 1)

  return Math.ceil(ratio * maxStep)
}
