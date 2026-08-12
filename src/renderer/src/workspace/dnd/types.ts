import type { DockTarget } from '../layout/operations'
import type { DockNodeId, DockSide } from '../layout/types'
import type { PanelId } from '../panels/types'

/**
 * ドラッグ&ドロップの語彙。
 *
 * dnd/ の責務は「マウス操作を Dock 操作の引数に翻訳すること」だけで、
 * レイアウトそのものは書き換えない（書き換えるのは layout/operations.ts）。
 *
 *   マウス座標 → DockZone → DockTarget → movePanel
 *   （dockGuide.ts）  （dropTarget.ts）   （layout/）
 *
 * この一方向の流れを保つため、dnd/ は layout/ を参照するが layout/ は dnd/ を知らない。
 */

/**
 * 領域のどこへ落とそうとしているか。
 *
 *   center      … その領域へタブとして加える
 *   上下左右     … その領域を分割し、その側へ置く（DockSide がそのまま分割方向になる）
 */
export type DockZone = 'center' | DockSide

/** 5方向の並び。ガイド表示の並び順もこの順に従う。 */
export const DOCK_ZONES: readonly DockZone[] = ['top', 'left', 'center', 'right', 'bottom']

/** マウス座標（ビューポート基準）。DOM に依存しない値として扱う。 */
export interface DragPoint {
  readonly x: number
  readonly y: number
}

/**
 * 領域の位置と大きさ（ビューポート基準）。
 *
 * DOMRect をそのまま渡せる形にしてあるが、判定側は数値しか見ない。
 * 「DOM の位置はレイアウトの正本ではなく、当たり判定の入力にすぎない」ことを型でも示す。
 */
export interface DragAreaRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * ドロップ先の候補。
 *
 * target が null なのは「そこへは落とせない / 落としても何も変わらない」場合で、
 * ガイド表示はこの値を見て受け入れ可否を出し分ける。
 * 判定を UI 側で書かずここに1本化するため、ドロップ可否と実際の操作を同じ値で持つ。
 */
export interface DropCandidate {
  readonly groupId: DockNodeId
  readonly zone: DockZone
  readonly target: DockTarget | null
}

/** ドラッグ中の状態。ドラッグしていない間は null。 */
export interface PanelDragState {
  readonly panelId: PanelId
  /**
   * このドラッグを受け入れられる領域。
   *
   * ドラッグ開始時に一度だけ求める（ドラッグ中はレイアウトが変わらないため）。
   * ガイドを出す領域を絞り、落としても何も起きない場所に案内を出さないために使う。
   */
  readonly droppableGroupIds: ReadonlySet<DockNodeId>
  /** 今カーソルが指している候補。領域の外にいる間は null。 */
  readonly over: DropCandidate | null
}
