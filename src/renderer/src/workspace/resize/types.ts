import type { DockNodeId, SplitDirection } from '../layout/types'

/**
 * 境界のリサイズの語彙。
 *
 * dnd/ と同じ立ち位置の層で、責務は「ポインタの移動量をサイズ操作の引数に翻訳すること」だけ。
 * レイアウトそのものは書き換えない（書き換えるのは layout/resize.ts）。
 *
 *   ポインタの移動量 → 境界と移動量 → resizeSplitBoundary → WorkspaceLayout → 再描画
 *   （useSplitResize）                （layout/）
 *
 * DOM の幅・高さを状態の正本にしないため、この層が DOM から読むのは
 * 「ドラッグ開始時の両側の実サイズ」だけで、それも操作の入力として1回渡すに留める。
 */

/**
 * split の中の1つの境界。children[index] と children[index + 1] の間を指す。
 *
 * 境界そのものは id を持たない（レイアウトデータに存在しない）ため、
 * 「どの split の何番目か」で指す。
 */
export interface SplitBoundary {
  readonly splitId: DockNodeId
  readonly index: number
  /** 親 split の並び方向。掴み手の向きとカーソルの形がここから決まる。 */
  readonly direction: SplitDirection
}

/** リサイズ中の状態。リサイズしていない間は null。 */
export interface SplitResizeState {
  readonly boundary: SplitBoundary
}
