import type { PanelId } from '../panels/types'

/**
 * Workspace のレイアウトを表すデータ。
 *
 * 「画面がどうなっているか」を JSX ではなくこのデータで表現するのが Workspace Shell の要。
 * Dock / Split / リサイズ / レイアウトプリセットの保存は、どれもこのデータの操作に還元される。
 * React コンポーネント側はこのデータを描画するだけで、自分では配置を持たない。
 *
 * Session 2-2 で、固定4領域（left / center / right / bottom）から**領域の木構造**へ移行した。
 * 領域は名前ではなく id で識別し、親の split がその領域の並び方（横 / 縦）を決める。
 * 「左」「下」といった位置は木の形から決まる結果であって、レイアウトが持つ属性ではない。
 */

declare const dockNodeIdBrand: unique symbol

/**
 * 木の中のノードを一意に指す id。
 *
 * 素の string と混ざらないよう branded type にしてある。
 * 生成は layout/nodeId.ts に集約し、他の場所で文字列から作らないこと
 * （id の重複はレイアウトを壊す代表的な原因で、型で塞げる範囲は塞いでおく）。
 */
export type DockNodeId = string & { readonly [dockNodeIdBrand]: true }

/**
 * split が子を並べる向き。CSS の flex-direction と同じ語を使う。
 *
 *   row    … 子を横に並べる（＝縦の境界線で分割する。いわゆる「垂直分割」）
 *   column … 子を縦に並べる（＝横の境界線で分割する。いわゆる「水平分割」）
 *
 * 「水平 / 垂直」は分割線を指すのか並びを指すのかで意味が反転するため、
 * データ側では row / column に統一し、UI の文言だけが人向けの言い方を持つ。
 */
export type SplitDirection = 'row' | 'column'

/** 領域から見てどちら側に新しい領域を作るか。ドラッグでのドロップ位置がそのままこの値になる。 */
export type DockSide = 'left' | 'right' | 'top' | 'bottom'

/** 分割の向きは「どちら側に置くか」から一意に決まる。 */
export const SPLIT_DIRECTION_BY_SIDE: Readonly<Record<DockSide, SplitDirection>> = {
  left: 'row',
  right: 'row',
  top: 'column',
  bottom: 'column'
}

/** 新しい領域が既存の領域より前（左 / 上）に入る側かどうか。 */
export const IS_LEADING_SIDE: Readonly<Record<DockSide, boolean>> = {
  left: true,
  right: false,
  top: true,
  bottom: false
}

/**
 * ノード共通の性質。
 *
 * size は「親の split の並び方向における基準サイズ（px）」。
 *   数値 … その大きさに固定する（サイドバーのように幅を保ちたい領域）
 *   null … 残りの領域を埋める。同じ親に null が複数あれば等分する
 *
 * 新しく作られる領域は必ず null にする。こうすると分割は常に「残りを等分」になり、
 * 分割のたびに px の初期値を発明しなくて済む（マウスリサイズは Session 2-3 以降）。
 */
interface DockNodeBase {
  readonly id: DockNodeId
  readonly size: number | null
}

/**
 * パネルを置く葉。従来の DockAreaState に相当する。
 * 同じ group に複数のパネルが入る場合はタブとして重なる。
 */
export interface DockGroupNode extends DockNodeBase {
  readonly kind: 'group'
  /** この領域に置かれているパネル。並び順がそのままタブの並び順になる。 */
  readonly panelIds: readonly PanelId[]
  /** タブとして手前に出ているパネル。空の領域では null。 */
  readonly activePanelId: PanelId | null
}

/**
 * 領域を分割する枝。
 *
 * children を「2つ以上」の tuple 型にしてあるのは、子が1つ以下の split が
 * 不正な状態（描画すると余計な入れ子になる）だから。
 * 子が減って1つになった split は木から畳む（layout/tree.ts の正規化）。
 */
export type DockSplitChildren = readonly [DockNode, DockNode, ...DockNode[]]

export interface DockSplitNode extends DockNodeBase {
  readonly kind: 'split'
  readonly direction: SplitDirection
  readonly children: DockSplitChildren
}

export type DockNode = DockGroupNode | DockSplitNode

export interface WorkspaceLayout {
  /**
   * 木の根。
   *
   * 空の group は木から取り除くが、根だけは例外として空のまま残す
   * （「パネルが1枚も無い」状態を表す場所が必要なため）。
   * root を null 許容にしないことで、描画側の分岐が1つ減る。
   */
  readonly root: DockNode
}
