import type { PanelId } from '../panels/types'
import { DEFAULT_WORKSPACE_LAYOUT } from './defaultLayout'
import {
  activatePanelInLayout,
  movePanel,
  removePanelFromLayout,
  splitNodeWithPanel,
  type DockOperationOptions
} from './operations'
import { resizeNode } from './resize'
import {
  collectGroups,
  collectPanelIds,
  findNodePath,
  findPanelLocation,
  findSmallestNodeContaining,
  isSplitNode
} from './tree'
import { SPLIT_DIRECTION_BY_SIDE } from './types'
import type {
  DockGroupNode,
  DockNode,
  DockNodeId,
  DockSide,
  SplitDirection,
  WorkspaceLayout
} from './types'

/**
 * パネルの表示 / 非表示。
 *
 * **「閉じる」はレイアウトから取り除くことであって、Panel Registry から消すことではない。**
 * Registry（panels/registry.ts）は「どんなパネルが存在するか」を持ち、
 * WorkspaceLayout は「そのうち今どれをどこに置いているか」を持つ。
 * 閉じたパネルは定義として残り続けるので、いつでも同じ id で戻せる。
 *
 *   表示中  … WorkspaceLayout の木のどこかに その PanelId がある
 *   閉じている … 木のどこにも無い
 *
 * 可視状態のための状態変数を別に持たないのがこの設計の要。
 * 別に持つと「レイアウトにはあるが非表示」「非表示なのにタブが残っている」という
 * 食い違いが起こりうるが、レイアウトから導出する限り定義上あり得ない。
 *
 * 開く側で決めることがひとつだけある。**閉じたパネルをどこへ戻すか**で、
 * レイアウトにはもう手がかりが残っていない（取り除いた領域ごと畳まれている）。
 * そこで、その時点で適用されているレイアウトプリセットを「本来の居場所」の
 * 設計図として読み、今のレイアウトの中で一番近い場所を探す（resolvePanelPlacement）。
 *
 * この層も layout/ の約束どおり React にも DOM にも依存しない。
 * Registry を参照しないのもそのためで、「登録されているパネルの一覧」と
 * 「今表示されているか」を突き合わせるのは画面側の仕事になる。
 */

/** 閉じたパネルをどう戻すか。 */
export type PanelPlacement =
  /** そもそも閉じていない。タブを手前に出すだけ。 */
  | { readonly kind: 'activate'; readonly groupId: DockNodeId }
  /** 既存の領域へタブとして戻す。 */
  | { readonly kind: 'tab'; readonly groupId: DockNodeId }
  /**
   * ノードを分割して戻す。
   *
   * nodeId は領域（葉）とは限らない。プリセット上の隣人が今 複数の領域に散っていれば、
   * それらをまとめて含む部分木が対象になる（Terminal を画面下いっぱいに戻す場合など）。
   * size はプリセットでの基準サイズ（引き継げない場合は null）。
   */
  | {
      readonly kind: 'split'
      readonly nodeId: DockNodeId
      readonly side: DockSide
      readonly size: number | null
    }

/** 新しい領域が既存の領域の前（左 / 上）に入る側。 */
const LEADING_SIDE: Readonly<Record<SplitDirection, DockSide>> = { row: 'left', column: 'top' }

/** 新しい領域が既存の領域の後ろ（右 / 下）に入る側。 */
const TRAILING_SIDE: Readonly<Record<SplitDirection, DockSide>> = { row: 'right', column: 'bottom' }

/** そのパネルが今レイアウトに置かれているか。 */
export function isPanelVisible(layout: WorkspaceLayout, panelId: PanelId): boolean {
  return findPanelLocation(layout.root, panelId) !== null
}

/** 今表示されているパネル。並び順は画面の並び順。 */
export function listVisiblePanelIds(layout: WorkspaceLayout): readonly PanelId[] {
  return collectPanelIds(layout.root)
}

/**
 * パネルを閉じる。
 *
 * 実体はレイアウトから取り除くだけで、Registry には触れない。
 * 空になった領域が木から消えることと、子が1つになった split が畳まれることは
 * operations.ts / tree.ts が引き受けるため、ここに後片付けは要らない。
 * 最後の1枚を閉じた場合は空の root が残る（＝パネルが1枚も無い状態）。
 */
export function closePanelInLayout(layout: WorkspaceLayout, panelId: PanelId): WorkspaceLayout {
  return removePanelFromLayout(layout, panelId)
}

/**
 * パネルを開く（閉じていたものを再表示する）。
 *
 * 置き場所の決め方は resolvePanelPlacement を参照。
 * 既に表示されている場合はタブを手前に出すだけで、配置は変えない
 * （メニューから選んだときに、せっかく組んだ配置が動かないようにするため）。
 */
export function openPanelInLayout(
  layout: WorkspaceLayout,
  panelId: PanelId,
  preset: WorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
  options: DockOperationOptions = {}
): WorkspaceLayout {
  const placement = resolvePanelPlacement(layout, panelId, preset)

  if (placement.kind === 'activate') {
    return activatePanelInLayout(layout, placement.groupId, panelId)
  }

  if (placement.kind === 'tab') {
    return movePanel(layout, panelId, { kind: 'tab', groupId: placement.groupId }, options)
  }

  // 戻す操作は「隣の領域を割る」のではなく「元の並びへ差し込む」。
  // 240px の Files を割って Editor を戻す、といったことが起きないようにする。
  const next = splitNodeWithPanel(layout, placement.nodeId, placement.side, panelId, {
    ...options,
    splitStyle: options.splitStyle ?? 'insert'
  })

  if (placement.size === null) {
    return next
  }

  // 分割で生まれた領域にはそのパネルしか入っていないため、パネルの居場所がそのまま新しい領域。
  const created = findPanelLocation(next.root, panelId)

  return created === null ? next : resizeNode(next, created.group.id, placement.size)
}

/**
 * 閉じたパネルの戻り先を決める（再表示時の配置ルール）。
 *
 * 基準にするのは**そのとき適用されているレイアウトプリセット**で、
 * 「Default では Files は Editor の左に居た」という情報をそこから読む。
 * ただしプリセットの形をそのまま復元するのではなく、
 * **今のレイアウトを崩さずに、プリセットで隣に居た相手の隣へ戻す**。
 * 利用者がドラッグ&ドロップやリサイズで組んだ配置を、
 * パネルを1枚開いただけで作り直してしまわないため。
 *
 * 上から順に見て、最初に当てはまったものを採る。
 *
 *   1. そもそも閉じていない            → タブを手前に出すだけ
 *   2. プリセットで同じ領域に居たパネルが表示中 → その領域へタブとして戻す
 *   3. プリセットで近くに居たパネルが表示中     → その範囲の隣を分割して戻す
 *   4. どれも当てはまらない            → 先頭の領域へタブとして戻す
 *
 * 3 が本体で、プリセットの木を葉から根へ辿りながら
 * 「同じ split の中で、どちら側の何番目に居たか」を見ていく。近い兄弟から順に、
 * その中のパネルが1枚でも表示されていれば、**表示されている分をまとめて含む最小のノード**を
 * 相手として分割する。相手が領域とは限らないのはこのためで、
 * 例えば Terminal は Files / Editor / Git を含む部分木の下へ戻るので画面幅いっぱいになる。
 * 葉に限ると「Git の下」のような、元の意図から外れた場所に戻ってしまう。
 *
 * 4 は、他のパネルが1枚も表示されていない場合（すべて閉じた直後）と、
 * プリセットに含まれないパネルを開いた場合。前者は空の root がその「先頭の領域」になる。
 *
 * 戻したときの大きさもプリセットから引き継ぐ（Terminal なら高さ 220px）。
 * ただし引き継げるのは、プリセットでその大きさが効いていた向きと
 * 今回の分割の向きが一致するときだけ。向きが違えば意味の違う値になるため null（等分）にする。
 */
export function resolvePanelPlacement(
  layout: WorkspaceLayout,
  panelId: PanelId,
  preset: WorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT
): PanelPlacement {
  const current = findPanelLocation(layout.root, panelId)

  if (current !== null) {
    return { kind: 'activate', groupId: current.group.id }
  }

  const seat = findPresetSeat(preset, panelId)

  if (seat !== null) {
    const roommates = seat.group.panelIds.filter((id) => id !== panelId)
    const roommateGroupId = findGroupOfFirstVisible(layout, roommates)

    if (roommateGroupId !== null) {
      return { kind: 'tab', groupId: roommateGroupId }
    }

    const neighbour = findVisibleNeighbour(layout, seat)

    if (neighbour !== null) {
      return {
        kind: 'split',
        nodeId: neighbour.nodeId,
        side: neighbour.side,
        size: inheritedSize(seat, neighbour.side)
      }
    }
  }

  return { kind: 'tab', groupId: fallbackGroupId(layout) }
}

/** プリセットの中でのそのパネルの居場所（領域と、根からそこまでの経路）。 */
interface PresetSeat {
  readonly group: DockGroupNode
  readonly path: readonly DockNode[]
}

function findPresetSeat(preset: WorkspaceLayout, panelId: PanelId): PresetSeat | null {
  const location = findPanelLocation(preset.root, panelId)

  if (location === null) {
    return null
  }

  const path = findNodePath(preset.root, location.group.id)

  return path === null ? null : { group: location.group, path }
}

/** 分割の相手と、その相手から見てどちら側に入るか。 */
interface PanelNeighbour {
  readonly nodeId: DockNodeId
  readonly side: DockSide
}

/**
 * プリセットで近くに居たパネルのうち、今も表示されているものを探す。
 *
 * 葉から根へ向かって祖先の split を辿る（近い関係から順に見る）。
 * それぞれの split では、パネルが入っていた子から近い兄弟の順に見ていき、
 * その中に表示中のパネルがあれば、それらをまとめて含む最小のノードを相手にする。
 */
function findVisibleNeighbour(layout: WorkspaceLayout, seat: PresetSeat): PanelNeighbour | null {
  for (let depth = seat.path.length - 2; depth >= 0; depth -= 1) {
    const ancestor = seat.path[depth]

    if (!isSplitNode(ancestor)) {
      continue
    }

    const index = ancestor.children.findIndex((child) => child.id === seat.path[depth + 1].id)

    if (index < 0) {
      continue
    }

    for (const at of siblingsByDistance(ancestor.children.length, index)) {
      const visible = collectPanelIds(ancestor.children[at]).filter((id) =>
        isPanelVisible(layout, id)
      )
      const anchor = findSmallestNodeContaining(layout.root, visible)

      if (anchor === null) {
        continue
      }

      // 相手が前（左 / 上）に居たならその後ろへ、後ろに居たならその前へ入る。
      const side = at < index ? TRAILING_SIDE[ancestor.direction] : LEADING_SIDE[ancestor.direction]

      return { nodeId: anchor.id, side }
    }
  }

  return null
}

/**
 * 兄弟を近い順に並べる。同じ距離なら前（並びの先頭側）を先に見る。
 *
 * 「近い順」なのは、プリセットで隣にあったものほど、戻す位置の手がかりとして強いため。
 */
function siblingsByDistance(count: number, index: number): readonly number[] {
  return Array.from({ length: count }, (_unused, at) => at)
    .filter((at) => at !== index)
    .sort((a, b) => Math.abs(a - index) - Math.abs(b - index) || a - b)
}

/**
 * プリセットでの基準サイズを引き継げるか判断する。
 *
 * size は「親の split の並び方向における大きさ」なので、その向きでの分割でなければ
 * 同じ数値でも別の意味になる（240 という幅を高さとして使ってしまう）。
 * 向きが一致するときだけ引き継ぎ、それ以外は等分（null）から始める。
 */
function inheritedSize(seat: PresetSeat, side: DockSide): number | null {
  const parent = seat.path[seat.path.length - 2]

  if (parent === undefined || !isSplitNode(parent)) {
    return null
  }

  return parent.direction === SPLIT_DIRECTION_BY_SIDE[side] ? seat.group.size : null
}

/** 与えたパネルのうち、最初に見つかった表示中のものが置かれている領域。 */
function findGroupOfFirstVisible(
  layout: WorkspaceLayout,
  panelIds: readonly PanelId[]
): DockNodeId | null {
  for (const panelId of panelIds) {
    const location = findPanelLocation(layout.root, panelId)

    if (location !== null) {
      return location.group.id
    }
  }

  return null
}

/**
 * 手がかりが無いときの戻り先。画面の並び順で先頭の領域。
 *
 * すべてのパネルを閉じた状態では空の root がそれにあたるため、
 * 「全部閉じてから1枚開く」も特別扱いせずにこの経路で戻せる。
 */
function fallbackGroupId(layout: WorkspaceLayout): DockNodeId {
  return collectGroups(layout.root)[0]?.id ?? layout.root.id
}
