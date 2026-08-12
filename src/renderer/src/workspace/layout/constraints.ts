import type { PanelId } from '../panels/types'
import { isGroupNode } from './tree'
import type { DockNode, SplitDirection } from './types'

/**
 * 領域の下限に関する設定と、その計算。
 *
 * リサイズで領域を潰せてしまうと、そのパネルは掴み直すことも閉じることもできなくなる。
 * 下限は「レイアウトが守るべき制約」であって特定のコンポーネントの都合ではないため、
 * 値をコンポーネントへ書かずここ1箇所に集める（変更もここだけで済む）。
 *
 * 「1つの領域の下限」と「木全体としての下限」は別物である点に注意する。
 * 入れ子になった split の下限は中の領域から決まるため、境界のリサイズは
 * 掴んだ両側のノードについて minNodeSize() を求めてから可動範囲を決める。
 *
 * この層は React にも DOM にも依存しない（layout/ の約束）。
 */

/** 領域の下限（px）。並び方向によって width / height のどちらを見るかが変わる。 */
export interface DockMinSize {
  readonly width: number
  readonly height: number
}

export interface DockSizeConstraints {
  /**
   * どの領域にも共通の下限。
   *
   * 「掴み直せる・閉じられる」ことが基準。高さはタブ列（--fx-tabbar-height）が
   * 隠れない範囲で、幅はタブが1枚読める範囲で決めている。
   */
  readonly minGroupSize: DockMinSize

  /**
   * パネルごとの上書き。共通の下限より大きい値だけが意味を持つ。
   *
   * 中央の作業領域（Editor）のように「置けるだけでは足りず、実際に操作できる広さが要る」
   * パネルはここで個別に底上げする。タブで複数のパネルが同居する領域は、
   * その中で最も大きい下限に合わせる（どのタブに切り替えても操作できる必要があるため）。
   */
  readonly minGroupSizeByPanel: Readonly<Partial<Record<PanelId, Partial<DockMinSize>>>>

  /**
   * 領域と領域の間に置く掴み手の太さ（px）。
   *
   * 見た目（CSS）と可動範囲の計算（この層）の両方で必要になるため、値はここが正本とし、
   * CSS へは WorkspaceShell がカスタムプロパティとして流す。
   */
  readonly handleThickness: number
}

export const DOCK_SIZE_CONSTRAINTS: DockSizeConstraints = {
  minGroupSize: { width: 140, height: 64 },
  minGroupSizeByPanel: {
    editor: { width: 320, height: 140 }
  },
  handleThickness: 6
}

/**
 * ノードがその向きで縮められる限界（px）。
 *
 *   group … そこに置かれているパネルの下限のうち最大のもの
 *   split … 向きが同じなら子の合計（＋間の掴み手）、違うなら子の最大
 *
 * 「向きが同じなら合計」なのは、その向きに縮めると子が全部縮むため。
 * 向きが違う場合は子が横並びに縮むわけではないので、最も譲れない子が限界になる。
 */
export function minNodeSize(
  node: DockNode,
  direction: SplitDirection,
  constraints: DockSizeConstraints = DOCK_SIZE_CONSTRAINTS
): number {
  if (isGroupNode(node)) {
    return minGroupSize(node.panelIds, direction, constraints)
  }

  const children = node.children.map((child) => minNodeSize(child, direction, constraints))

  if (node.direction !== direction) {
    return Math.max(...children)
  }

  return (
    children.reduce((total, size) => total + size, 0) +
    (node.children.length - 1) * constraints.handleThickness
  )
}

/** 領域（葉）の下限。パネルが1枚も無い領域（root だけがなりうる）は共通の下限を使う。 */
function minGroupSize(
  panelIds: readonly PanelId[],
  direction: SplitDirection,
  constraints: DockSizeConstraints
): number {
  const axis = direction === 'row' ? 'width' : 'height'
  const base = constraints.minGroupSize[axis]

  return panelIds.reduce(
    (size, panelId) => Math.max(size, constraints.minGroupSizeByPanel[panelId]?.[axis] ?? 0),
    base
  )
}
