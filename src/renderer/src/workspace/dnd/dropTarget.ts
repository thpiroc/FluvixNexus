import type { DockTarget } from '../layout/operations'
import { collectGroups, findGroup, findPanelLocation } from '../layout/tree'
import type { DockNodeId, WorkspaceLayout } from '../layout/types'
import type { PanelId } from '../panels/types'
import { DOCK_ZONES } from './types'
import type { DockZone, DropCandidate } from './types'

/**
 * ドロップ位置（領域 + DockZone）を、レイアウト操作の引数（DockTarget）に翻訳する。
 *
 * ここが dnd/ と layout/ の境目。UI 側はこの関数が返した DockTarget を
 * そのまま movePanel へ渡すだけで、レイアウトの木に触れない。
 *
 * 「落とせるかどうか」もこの層が決める。UI に散らすと、ガイド表示が許すのに
 * 実際には何も起きない（あるいはその逆）という食い違いが生まれるため、
 * ガイドの見た目も実際の操作も同じ判定結果から作る。
 */

/**
 * ドロップ位置を DockTarget に変換する。落とせない場合は null。
 *
 * null を返すのは次の場合:
 *   - 移動先の領域がもう無い（ドラッグ中にレイアウトが変わった場合）
 *   - 今そのパネルが居る領域の中央（既にその領域のタブであり、移動にならない）
 *   - 今そのパネルが居る領域の分割で、その領域にそのパネルしか入っていない
 *     （取り除いた時点で領域ごと消えるため、分割しても元と同じ形にしかならない）
 */
export function resolveDropTarget(
  layout: WorkspaceLayout,
  panelId: PanelId,
  groupId: DockNodeId,
  zone: DockZone
): DockTarget | null {
  if (findGroup(layout.root, groupId) === null) {
    return null
  }

  const source = findPanelLocation(layout.root, panelId)

  if (source !== null && source.group.id === groupId) {
    if (zone === 'center' || source.group.panelIds.length < 2) {
      return null
    }
  }

  if (zone === 'center') {
    return { kind: 'tab', groupId }
  }

  return { kind: 'split', groupId, side: zone }
}

/** ガイド表示に渡す形（位置と、そこへ落としたときに何が起きるか）にまとめる。 */
export function resolveDropCandidate(
  layout: WorkspaceLayout,
  panelId: PanelId,
  groupId: DockNodeId,
  zone: DockZone
): DropCandidate {
  return { groupId, zone, target: resolveDropTarget(layout, panelId, groupId, zone) }
}

/** その領域が、このパネルのドロップを1方向でも受け入れられるか。 */
export function canDropIntoGroup(
  layout: WorkspaceLayout,
  panelId: PanelId,
  groupId: DockNodeId
): boolean {
  return DOCK_ZONES.some((zone) => resolveDropTarget(layout, panelId, groupId, zone) !== null)
}

/**
 * ドラッグ中のパネルを受け入れられる領域を集める。
 *
 * ドラッグ開始時に一度求めて、ガイドを出す領域を決めるために使う
 * （ドラッグ中はレイアウトが変わらないため、毎フレーム求め直す必要が無い）。
 */
export function collectDroppableGroupIds(
  layout: WorkspaceLayout,
  panelId: PanelId
): ReadonlySet<DockNodeId> {
  const groupIds = collectGroups(layout.root)
    .filter((group) => canDropIntoGroup(layout, panelId, group.id))
    .map((group) => group.id)

  return new Set(groupIds)
}
