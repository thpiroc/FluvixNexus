import { DOCK_SIZE_CONSTRAINTS, minNodeSize } from './constraints'
import type { DockSizeConstraints } from './constraints'
import { findNode, isSplitNode, layoutFromRoot, mapNode, toSplitChildren, withSize } from './tree'
import type { DockNode, DockNodeId, SplitDirection, WorkspaceLayout } from './types'

/**
 * 領域のサイズを変える純粋関数。
 *
 * operations.ts が「どこに何があるか（Dock / Split / タブ）」を扱うのに対し、
 * こちらは「それぞれがどれだけの大きさか」だけを扱う。木の形は一切変えない。
 *
 * この層が守る約束（operations.ts と同じ）:
 *   - 入力のレイアウトを書き換えない（常に新しい値を返す）
 *   - 変化が無ければ元のオブジェクトをそのまま返す
 *   - 返すレイアウトは常に正規形
 *
 * サイズの変更で正規形が崩れないのは、正規形の条件がどれも
 * 「木の形」と「パネルの置かれ方」の話で、size に触れるのは
 * 「正の数か null」という条件だけだから（下限を下回らないため常に満たす）。
 * 例外は「同じ向きの split が入れ子になっていない」だが、その条件自体が
 * size が null の子だけを対象にしており、px を持つ子は元から対象外になる。
 * よって normalizeLayout を通す必要が無い。
 *
 * ドラッグとの関係:
 *   ポインタの移動量 → resizeSplitBoundary → WorkspaceLayout → React 再描画
 * という一方向の流れになっており、DOM の幅・高さがレイアウトの正本になることはない。
 * 開始時の実サイズは呼び出し側（resize/useSplitResize.ts）が測って渡すが、
 * それはあくまで「今どれだけの大きさか」という入力であって、状態そのものではない。
 */

/**
 * ノード1つの基準サイズを差し替える。
 *
 *   数値 … その大きさに固定する
 *   null … 残りを埋める（同じ親に複数あれば等分）
 *
 * 境界のドラッグは resizeSplitBoundary が使う。こちらはレイアウトプリセットの適用や
 * 「このパネルを既定の幅に戻す」のように、値を直接決めたい場合の入口。
 */
export function resizeNode(
  layout: WorkspaceLayout,
  nodeId: DockNodeId,
  size: number | null
): WorkspaceLayout {
  const node = findNode(layout.root, nodeId)

  if (node === null || node.size === size) {
    return layout
  }

  // 0 以下や NaN は正規形から外れる（findLayoutProblems が報告する）ため受け付けない。
  if (size !== null && !(size > 0)) {
    return layout
  }

  return layoutFromRoot(mapNode(layout.root, nodeId, (target) => withSize(target, size)))
}

/**
 * split の中の1つの境界を動かす。
 *
 *   splitId    … 境界を持つ split
 *   index      … children[index] と children[index + 1] の間の境界
 *   startSizes … ドラッグ開始時の両側の実サイズ（px）
 *   delta      … 開始位置からの移動量（並び方向。+ が後ろ側＝右 / 下）
 *
 * delta を「開始位置からの累計」で受け取るのは、移動のたびに前回の結果へ足し込むと
 * 丸めと下限での頭打ちが積み重なって、カーソルと境界がずれていくため。
 * 開始時の値からの再計算にしておくと、下限に当たった後に戻したときも素直に追従する。
 *
 * **両側の合計は常に変わらない。** 境界の移動は2つの領域の間で大きさを移すだけで、
 * 他の領域や外側の大きさに影響しない、というのがこの操作の定義。
 */
export function resizeSplitBoundary(
  layout: WorkspaceLayout,
  splitId: DockNodeId,
  index: number,
  startSizes: readonly [number, number],
  delta: number,
  constraints: DockSizeConstraints = DOCK_SIZE_CONSTRAINTS
): WorkspaceLayout {
  const split = findNode(layout.root, splitId)

  if (split === null || !isSplitNode(split)) {
    return layout
  }

  if (!Number.isInteger(index) || index < 0 || index + 1 >= split.children.length) {
    return layout
  }

  const leading = split.children[index]
  const trailing = split.children[index + 1]
  const [startLeading, startTrailing] = startSizes

  if (
    !Number.isFinite(startLeading) ||
    !Number.isFinite(startTrailing) ||
    !Number.isFinite(delta)
  ) {
    return layout
  }

  // 実サイズは小数で入ってくる。px の整数に揃えてから配ると、合計のずれが1回で収まる。
  const total = Math.round(startLeading + startTrailing)
  const minLeading = effectiveMinSize(leading, split.direction, startLeading, constraints)
  const minTrailing = effectiveMinSize(trailing, split.direction, startTrailing, constraints)

  const nextLeading = Math.round(clamp(startLeading + delta, minLeading, total - minTrailing))
  const nextTrailing = total - nextLeading

  // 境界が動かないなら何も書かない。
  // 実サイズは（ウィンドウが狭くて縮んでいるなど）レイアウトが持つ値と一致しないことがあり、
  // 「動かせなかった」だけの操作で、今たまたま表示されている大きさを書き込んでしまわないため。
  if (nextLeading === Math.round(startLeading)) {
    return layout
  }

  const children = [...split.children]

  if (shouldPinLeading(split.children, index)) {
    children[index] = withSize(leading, nextLeading)
  }

  if (shouldPinTrailing(split.children, index)) {
    children[index + 1] = withSize(trailing, nextTrailing)
  }

  if (children[index] === leading && children[index + 1] === trailing) {
    return layout
  }

  return layoutFromRoot(
    mapNode(layout.root, splitId, () => ({ ...split, children: toSplitChildren(children) }))
  )
}

/**
 * リサイズで実際に効かせる下限。
 *
 * 設定上の下限をそのまま使うと、ウィンドウが小さくて既に下限を割っている領域を
 * リサイズが勝手に押し戻してしまう（境界を左へ動かしたのに右の領域が縮む、など
 * 操作と逆の結果になる）。ウィンドウの狭さが原因の状態を、境界の操作で直すのは筋が違う。
 *
 * そこで「今より狭くしない」ところまでを下限とする。結果として、
 *   - 十分な広さがあるとき … 設定どおりの下限で止まる
 *   - 既に割り込んでいるとき … それ以上狭くはならない（広げるのは自由）
 * となり、どちらの場合も「リサイズで領域を潰せない」ことは保たれる。
 */
function effectiveMinSize(
  node: DockNode,
  direction: SplitDirection,
  startSize: number,
  constraints: DockSizeConstraints
): number {
  return Math.min(minNodeSize(node, direction, constraints), Math.max(startSize, 0))
}

/**
 * 境界の両側のうち、どちらを px に固定するか。
 *
 * ここが「px 固定サイズと可変領域（size: null）」の噛み合わせの要になる。
 * null の領域は「残りを埋める」ため、px 側を書き換えるだけで反対側が自動で追従する。
 * これを利用すると、可変領域を可変のまま保てる（＝ウィンドウサイズが変わったときに
 * 伸び縮みを引き受ける領域が残る）。
 *
 * 一方、掴んだ2つ以外にも可変領域がある場合は、残りを分け合う相手が増えるため
 * 「片側だけ書き換えれば反対側が追従する」が成り立たない。関係の無い領域まで
 * 動いてしまうので、その場合は両側とも px に固定する。
 *
 * 場合分け（掴んだ2つ以外に可変領域が無いとき）:
 *
 *   前 px   / 後 px   … 両方を書き換える
 *   前 px   / 後 null … 前だけ。後は残りを埋めて追従する
 *   前 null / 後 px   … 後だけ。前は残りを埋めて追従する
 *   前 null / 後 null … 前だけ。後を可変のまま残す
 *
 * どの場合も少なくとも片方は px になり、かつ元々あった可変領域が全部消えることはない。
 */
function hasOtherFlexibleChild(children: readonly DockNode[], index: number): boolean {
  return children.some((child, at) => at !== index && at !== index + 1 && child.size === null)
}

function shouldPinLeading(children: readonly DockNode[], index: number): boolean {
  if (hasOtherFlexibleChild(children, index)) {
    return true
  }

  // 前が可変で後ろが固定なら、後ろを書き換えて前に追従させる（前を可変のまま残す）。
  return !(children[index].size === null && children[index + 1].size !== null)
}

function shouldPinTrailing(children: readonly DockNode[], index: number): boolean {
  if (hasOtherFlexibleChild(children, index)) {
    return true
  }

  return children[index + 1].size !== null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
