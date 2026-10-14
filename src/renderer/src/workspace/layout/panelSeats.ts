import type { PanelId } from '../panels/types'
import { movePanel, splitNodeWithPanel, type DockOperationOptions } from './operations'
import { openPanelInLayout } from './panelVisibility'
import { resizeNode } from './resize'
import {
  collectGroups,
  collectPanelIds,
  findNodePath,
  findPanelLocation,
  isSplitNode
} from './tree'
import type { DockNode, DockNodeId, DockSide, DockSplitNode, WorkspaceLayout } from './types'

/**
 * 利用者が置き場所を決めるパネルの「最後の席」（FN Agent のドックパネル化）。
 *
 * ほとんどのパネルは、閉じたあとの戻り先を**レイアウトプリセット**から決める
 * （layout/panelVisibility.ts）。プリセットに入っていないパネル（Agent）は
 * その手掛かりが無いため、次の2つで置き場所を決める。
 *
 *   初めて出すとき … 利用者が 左 / 右 / 上 / 下 / 中央 から選ぶ（placePanelAt）
 *   再び出すとき   … 最後に見えていたときのレイアウトを設計図にして戻す（openPanelAtSeat）
 *
 * ## 席はレイアウトの写しで持つ
 *
 * 「最後に見えていたときのレイアウト」をそのまま席として控え、再表示ではそれを
 * プリセットの代わりに resolvePanelPlacement へ渡す。席のための別の形
 * （「Files の右に 360px」のような記述）を作らないので、戻し方の判断は
 * 既存の再表示と同じ1本のまま保たれる。同じ領域に居た相手が見えていれば
 * その領域へタブとして、隣に居た相手が見えていればその隣へ同じ大きさで戻る。
 *
 * ## 判定（初回か、再表示か）
 *
 *   表示中               … どちらでもない（前面に出すだけ）
 *   閉じていて、席がある … 再表示。席を設計図にして戻す
 *   閉じていて、席が無い … 初回。置き場所を尋ねる
 *
 * 席は「表示中 → 非表示」に変わった瞬間に、変わる直前のレイアウトを控える
 * （rememberPanelSeats）。閉じるボタン・View メニュー・コマンドだけでなく、
 * プリセットの切り替えでパネルが消えた場合も同じ扱いになる。
 *
 * **例外は「レイアウトを初期化」で、席ごと捨てる**（useWorkspaceLayout.ts の resetLayout）。
 * 初期化は配置をはじめからやり直す操作なので、次に出すときは改めて置き場所を尋ねる。
 *
 * 席に残っている相手が1枚も表示されていない（全部閉じた・席が古い）場合は、
 * 戻す場所を推測せず、初回と同じく尋ねる。先頭の領域へ黙って入れると、
 * 利用者には「勝手な場所に出た」ようにしか見えないため。
 *
 * この層も layout/ の約束どおり React にも DOM にも Registry にも依存しない。
 * どのパネルが「利用者が置き場所を決める」ものかは呼び出し側が渡す。
 */

/** 初めて出すときに選べる置き場所。ドロップの5方向と同じ語を使う。 */
export type PanelPlacementChoice = 'center' | DockSide

export const PANEL_PLACEMENT_CHOICES: readonly PanelPlacementChoice[] = [
  'left',
  'right',
  'top',
  'bottom',
  'center'
]

/** パネルごとの最後の席（その時点のレイアウトの写し）。 */
export type PanelSeats = Readonly<Partial<Record<PanelId, WorkspaceLayout>>>

export const NO_PANEL_SEATS: PanelSeats = Object.freeze({})

/**
 * 端に置いたときの最初の大きさ（px）。
 *
 * 左右は Git（280px）より少し広い幅、上下は Terminal（220px）と同じくらいの高さ。
 * 出した後は境界のドラッグで自由に変えられ、その値が次の席として残る。
 */
export const INITIAL_SIDE_SIZE: Readonly<Record<DockSide, number>> = {
  left: 360,
  right: 360,
  top: 240,
  bottom: 240
}

/** 今の判定。呼び出し側はこれを見て、尋ねるか・そのまま出すかを分ける。 */
export type PanelShowMode = 'visible' | 'restore' | 'choose'

export function resolvePanelShowMode(
  layout: WorkspaceLayout,
  seats: PanelSeats,
  panelId: PanelId
): PanelShowMode {
  if (findPanelLocation(layout.root, panelId) !== null) {
    return 'visible'
  }

  const seat = seats[panelId]

  return seat !== undefined && hasVisibleNeighbour(layout, seat, panelId) ? 'restore' : 'choose'
}

/**
 * 表示中 → 非表示 に変わったパネルの席を控える。
 *
 * 対象は panelIds（利用者が置き場所を決めるパネル）だけ。変化が無ければ元の値を返す
 * （参照が同じなら保存も起きない）。
 */
export function rememberPanelSeats(
  seats: PanelSeats,
  previous: WorkspaceLayout,
  next: WorkspaceLayout,
  panelIds: readonly PanelId[]
): PanelSeats {
  if (previous === next) {
    return seats
  }

  let changed: Partial<Record<PanelId, WorkspaceLayout>> | null = null

  for (const panelId of panelIds) {
    const wasVisible = findPanelLocation(previous.root, panelId) !== null
    const isVisible = findPanelLocation(next.root, panelId) !== null

    if (wasVisible && !isVisible) {
      changed ??= { ...seats }
      changed[panelId] = previous
    }
  }

  return changed ?? seats
}

/**
 * 席を設計図にしてパネルを戻す。
 *
 * 戻し方は閉じたパネルの再表示（openPanelInLayout）そのもので、設計図が
 * プリセットから席に替わるだけ。表示中なら前面に出すだけになる。
 *
 * 再表示が引き継ぐ大きさは戻すパネル自身の分だけなので、**同じ並びの隣の大きさ**も
 * 席から写す（restoreSiblingSizes）。Files の下に置いて境界を動かした場合、
 * 固定されているのは Files の側の高さで、写さないと等分に戻ってしまう。
 */
export function openPanelAtSeat(
  layout: WorkspaceLayout,
  seat: WorkspaceLayout,
  panelId: PanelId,
  options: DockOperationOptions = {}
): WorkspaceLayout {
  const opened = openPanelInLayout(layout, panelId, seat, options)

  return opened === layout ? opened : restoreSiblingSizes(opened, seat, panelId)
}

/**
 * 戻したパネルの親の split が、席での親と同じ並び（向き・子の数・それぞれの子の中身）なら、
 * 子の大きさを席の値に揃える。並びが違えば何もしない（意味の違う値を書かない）。
 */
function restoreSiblingSizes(
  layout: WorkspaceLayout,
  seat: WorkspaceLayout,
  panelId: PanelId
): WorkspaceLayout {
  const parent = parentSplitOf(layout, panelId)
  const seatParent = parentSplitOf(seat, panelId)

  if (
    parent === null ||
    seatParent === null ||
    parent.direction !== seatParent.direction ||
    parent.children.length !== seatParent.children.length ||
    parent.children.some((child, index) => panelKey(child) !== panelKey(seatParent.children[index]))
  ) {
    return layout
  }

  return parent.children.reduce(
    (next, child, index) => resizeNode(next, child.id, seatParent.children[index].size),
    layout
  )
}

function parentSplitOf(layout: WorkspaceLayout, panelId: PanelId): DockSplitNode | null {
  const location = findPanelLocation(layout.root, panelId)
  const path = location === null ? null : findNodePath(layout.root, location.group.id)
  const parent = path?.[path.length - 2]

  return parent !== undefined && isSplitNode(parent) ? parent : null
}

/** 子の中身を比べるための鍵（そのノードに入っているパネルの並び）。 */
function panelKey(node: DockNode): string {
  return collectPanelIds(node).join(',')
}

/**
 * 利用者が選んだ置き場所へパネルを出す（初めて出すとき）。
 *
 *   左 / 右 / 上 / 下 … 画面全体（木の根）の端に、新しい領域として差し込む
 *   中央             … Editor の領域へタブとして加える（Editor が無ければ、
 *                      残りを埋める領域 → 先頭の領域の順で探す）
 *
 * どちらもドロップと同じ Dock 操作（splitNodeWithPanel / movePanel）を通す。
 * 出した後は他のパネルと同じく、ドラッグ・タブ統合・リサイズの対象になる。
 *
 * パネルが1枚も無い状態では、どれを選んでも空の領域へ入れる（割る相手が無い）。
 */
export function placePanelAt(
  layout: WorkspaceLayout,
  panelId: PanelId,
  choice: PanelPlacementChoice,
  options: DockOperationOptions = {}
): WorkspaceLayout {
  const others = collectPanelIds(layout.root).filter((id) => id !== panelId)

  if (others.length === 0) {
    return movePanel(layout, panelId, { kind: 'tab', groupId: firstGroupId(layout) }, options)
  }

  if (choice === 'center') {
    return movePanel(layout, panelId, { kind: 'tab', groupId: centerGroupId(layout) }, options)
  }

  const next = splitNodeWithPanel(layout, layout.root.id, choice, panelId, {
    ...options,
    splitStyle: 'insert'
  })
  const created = findPanelLocation(next.root, panelId)

  return created === null ? next : resizeNode(next, created.group.id, INITIAL_SIDE_SIZE[choice])
}

/** 席に残っている相手（自分以外のパネル）が、今1枚でも表示されているか。 */
function hasVisibleNeighbour(
  layout: WorkspaceLayout,
  seat: WorkspaceLayout,
  panelId: PanelId
): boolean {
  if (findPanelLocation(seat.root, panelId) === null) {
    return false
  }

  return collectPanelIds(seat.root).some(
    (id) => id !== panelId && findPanelLocation(layout.root, id) !== null
  )
}

function centerGroupId(layout: WorkspaceLayout): DockNodeId {
  const editor = findPanelLocation(layout.root, 'editor')

  if (editor !== null) {
    return editor.group.id
  }

  const filling = collectGroups(layout.root).find(
    (group) => group.size === null && group.panelIds.length > 0
  )

  return filling?.id ?? firstGroupId(layout)
}

function firstGroupId(layout: WorkspaceLayout): DockNodeId {
  return collectGroups(layout.root)[0]?.id ?? layout.root.id
}
