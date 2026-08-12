import type { PanelId } from '../panels/types'
import { createDockNodeId } from './nodeId'
import {
  findGroup,
  findNode,
  findPanelLocation,
  isGroupNode,
  layoutFromRoot,
  mapGroup,
  normalizeLayout,
  toSplitChildren,
  withSize
} from './tree'
import { IS_LEADING_SIDE, SPLIT_DIRECTION_BY_SIDE } from './types'
import type {
  DockGroupNode,
  DockNode,
  DockNodeId,
  DockSide,
  SplitDirection,
  WorkspaceLayout
} from './types'

/**
 * レイアウトを操作する純粋関数。
 *
 * React から切り離してあるのは、Dock / Split / リサイズが増えるほど
 * ここが「レイアウトの正しさ」を決める中心になるため。
 * 状態の持ち方（useState / 永続化 / undo）が変わっても、この層はそのまま使える。
 *
 * この層が守る約束:
 *   - 入力のレイアウトを書き換えない（常に新しい値を返す）
 *   - 変化が無ければ元のオブジェクトをそのまま返す
 *   - 返すレイアウトは常に正規形（tree.ts の findLayoutProblems が空）
 *   - 同じ PanelId が2箇所に現れない。移動は必ず「取り除いてから入れる」
 *
 * 扱うのは「どこに何があるか」まで。「それぞれがどれだけの大きさか」は
 * layout/resize.ts が持つ（木の形を変える操作と、変えない操作の分け方）。
 */

export interface DockOperationOptions {
  /** 新しいノードの id をどう作るか。テストでは決まった id を注入して結果を固定する。 */
  readonly createNodeId?: () => DockNodeId
  /**
   * 分割の対象が px の大きさを持つ場合の扱い。
   *
   *   'carve'（既定）… 対象を新しい split で包み、その px を split が引き継ぐ。
   *                    ＝「この領域を割ってその半分に置く」。外から見た大きさは変わらない
   *   'insert'       … 親の並びが同じ向きなら、包まずに対象の隣へ差し込む。
   *                    ＝「この領域の隣に置く」。対象の大きさはそのまま残る
   *
   * ドロップは常に 'carve'。240px の Files の右端に落としたなら、期待されるのは
   * 「Files の右半分に入る」ことであって「Files の隣に増える」ことではないため。
   *
   * 閉じたパネルを元の並びへ戻す場合は 'insert'（layout/panelVisibility.ts）。
   * こちらの意図は「Files と Git の間へ Editor を戻す」であって、
   * 隣の領域を割ることではない。
   *
   * 対象が「残りを埋める」領域（size が null）の場合は、どちらでも隣へ差し込む
   * （割っても隣に増やしても結果が同じため）。
   */
  readonly splitStyle?: 'carve' | 'insert'
}

/**
 * パネルの移動先。ドラッグ&ドロップ（Session 2-3）のドロップ先がそのままこの値になる。
 *
 *   tab   … 既存の領域へタブとして入れる。index を省略すると末尾
 *   split … 対象の領域を分割し、空いた側に新しい領域を作ってそこへ入れる
 *
 * どちらも対象は領域（木の葉）。ドロップ先は必ず画面上の1領域だからで、
 * 部分木をまとめて分割したい場合は splitNodeWithPanel を直接使う。
 */
export type DockTarget =
  | { readonly kind: 'tab'; readonly groupId: DockNodeId; readonly index?: number }
  | { readonly kind: 'split'; readonly groupId: DockNodeId; readonly side: DockSide }

/**
 * 領域内のタブを切り替える。
 *
 * 変化が無い場合（同じパネル / その領域に無いパネル / 無い領域）は元のレイアウトをそのまま返す。
 */
export function activatePanelInLayout(
  layout: WorkspaceLayout,
  groupId: DockNodeId,
  panelId: PanelId
): WorkspaceLayout {
  const group = findGroup(layout.root, groupId)

  if (group === null || group.activePanelId === panelId || !group.panelIds.includes(panelId)) {
    return layout
  }

  return layoutFromRoot(
    mapGroup(layout.root, groupId, (target) => ({ ...target, activePanelId: panelId }))
  )
}

/**
 * パネルを別の領域へ移動する（Dock 操作の入口）。
 *
 * タブの並べ替え・別領域への移動・分割してその側へ移動を、1つの関数で扱う。
 * どれも「同じパネルは木の中に1つだけ」という条件を保つ必要があり、
 * 分けて実装すると重複を防ぐ責任が散らばるため。
 *
 * まだレイアウトに無いパネルを指定した場合は、そのまま追加として扱う
 * （パネルを開く操作も同じ経路に乗る）。
 *
 * 移動元を取り除いた結果、移動先の領域自体が消えるケース
 * （1枚しか入っていない領域を、その領域自身の分割先へ動かす）は何も起きない移動として扱い、
 * 元のレイアウトを返す。
 */
export function movePanel(
  layout: WorkspaceLayout,
  panelId: PanelId,
  target: DockTarget,
  options: DockOperationOptions = {}
): WorkspaceLayout {
  const source = findPanelLocation(layout.root, panelId)

  // 同じ領域の中での tab 移動は並べ替え。取り除いてから入れると位置がずれるため別扱いにする。
  if (target.kind === 'tab' && source !== null && source.group.id === target.groupId) {
    return reorderPanel(layout, source.group, panelId, target.index)
  }

  if (target.kind === 'split') {
    return splitNodeWithPanel(layout, target.groupId, target.side, panelId, options)
  }

  const detached = source === null ? layout : detachPanel(layout, source.group.id, panelId)

  if (findGroup(detached.root, target.groupId) === null) {
    return layout
  }

  return normalizeLayout(
    layoutFromRoot(insertPanel(detached.root, target.groupId, panelId, target.index))
  )
}

/**
 * ノードを分割し、空いた側にパネル1枚の領域を作る。
 *
 * 対象は領域（葉）に限らず、木のどのノードでもよい。ドラッグ&ドロップが指すのは
 * 常に領域だが、レイアウト操作としては制限する理由が無く、
 * 「今 Files / Editor / Git が並んでいる範囲全体の下へ Terminal を戻す」のように
 * **部分木の隣に置きたい**場面がある（layout/panelVisibility.ts の再表示）。
 *
 * 「今どこにあるパネルか」を気にせず使える（既にどこかにあれば移動、無ければ追加になる）。
 *
 * 取り除いた結果として対象のノード自体が消える場合
 * （1枚しか入っていない領域を、その領域自身の分割先へ動かす）は
 * 何も起きない操作として扱い、元のレイアウトをそのまま返す。
 */
export function splitNodeWithPanel(
  layout: WorkspaceLayout,
  nodeId: DockNodeId,
  side: DockSide,
  panelId: PanelId,
  options: DockOperationOptions = {}
): WorkspaceLayout {
  const createNodeId = options.createNodeId ?? createDockNodeId
  const source = findPanelLocation(layout.root, panelId)
  const detached = source === null ? layout : detachPanel(layout, source.group.id, panelId)

  if (findNode(detached.root, nodeId) === null) {
    return layout
  }

  const newGroup: DockGroupNode = {
    kind: 'group',
    id: createNodeId(),
    panelIds: [panelId],
    activePanelId: panelId,
    // 新しい領域は常に「残りを埋める」。分割は等分から始まり、比率の調整はリサイズの仕事。
    size: null
  }

  return normalizeLayout(
    layoutFromRoot(
      insertBeside(
        detached.root,
        nodeId,
        side,
        newGroup,
        createNodeId,
        options.splitStyle ?? 'carve'
      ) ?? detached.root
    )
  )
}

/**
 * パネルをレイアウトから取り除く。
 *
 * 取り除いた結果として空になった領域は木から消え、子が1つになった split は畳まれる
 * （tree.ts の mapGroup が引き受ける）。パネルを閉じる操作の実体になる。
 */
export function removePanelFromLayout(layout: WorkspaceLayout, panelId: PanelId): WorkspaceLayout {
  const source = findPanelLocation(layout.root, panelId)

  if (source === null) {
    return layout
  }

  return detachPanel(layout, source.group.id, panelId)
}

/** 領域からパネルを1枚抜く。抜いた後に手前へ出すパネルもここで決める。 */
function detachPanel(
  layout: WorkspaceLayout,
  groupId: DockNodeId,
  panelId: PanelId
): WorkspaceLayout {
  return layoutFromRoot(
    mapGroup(layout.root, groupId, (group) => {
      const panelIds = group.panelIds.filter((id) => id !== panelId)

      if (panelIds.length === 0) {
        return null
      }

      if (group.activePanelId !== panelId) {
        return { ...group, panelIds }
      }

      // 手前にあったパネルが抜けた場合は、その位置を埋めたパネル（無ければ末尾）を手前にする。
      const index = group.panelIds.indexOf(panelId)
      const next = panelIds[Math.min(index, panelIds.length - 1)]

      return { ...group, panelIds, activePanelId: next }
    })
  )
}

/** 同じ領域の中でタブの位置を変える。 */
function reorderPanel(
  layout: WorkspaceLayout,
  group: DockGroupNode,
  panelId: PanelId,
  index: number | undefined
): WorkspaceLayout {
  const rest = group.panelIds.filter((id) => id !== panelId)
  const at = clamp(index ?? rest.length, 0, rest.length)
  const panelIds = [...rest.slice(0, at), panelId, ...rest.slice(at)]

  if (samePanelOrder(panelIds, group.panelIds) && group.activePanelId === panelId) {
    return layout
  }

  return layoutFromRoot(
    mapGroup(layout.root, group.id, (target) => ({ ...target, panelIds, activePanelId: panelId }))
  )
}

/** 既存の領域へタブとして差し込む。差し込んだパネルを手前に出す。 */
function insertPanel(
  root: DockNode,
  groupId: DockNodeId,
  panelId: PanelId,
  index: number | undefined
): DockNode | null {
  return mapGroup(root, groupId, (group) => {
    const at = clamp(index ?? group.panelIds.length, 0, group.panelIds.length)

    return {
      ...group,
      panelIds: [...group.panelIds.slice(0, at), panelId, ...group.panelIds.slice(at)],
      activePanelId: panelId
    }
  })
}

/**
 * 対象の領域の隣に新しいノードを置く。対象が見つからなければ null。
 *
 * 親が既に同じ向きの split で、かつ対象が「残りを埋める」領域なら、
 * 入れ子にせず兄弟として差し込む。分割のたびに木が1段深くなるのを避けるため
 * （同じ見た目に複数の木が対応すると、レイアウトの比較も保存も扱いにくくなる）。
 *
 * 対象が px のサイズを持つ場合にどうするかは splitStyle が決める（DockOperationOptions）。
 * 既定の 'carve' では兄弟にできない。例えば高さ 220px の領域を上下に分けたとき、
 * 期待されるのは「220px の中が2つに割れる」ことで、「220px の隣にもう1つ領域が増える」
 * ことではないため。この場合は入れ子にして、新しい split が元の 220px を引き継ぐ。
 *
 * 対象が根そのものの場合は親が無いため、どちらの style でも包む。
 */
function insertBeside(
  node: DockNode,
  targetId: DockNodeId,
  side: DockSide,
  newNode: DockNode,
  createNodeId: () => DockNodeId,
  splitStyle: 'carve' | 'insert'
): DockNode | null {
  const direction = SPLIT_DIRECTION_BY_SIDE[side]
  const leading = IS_LEADING_SIDE[side]

  if (node.id === targetId) {
    return wrapInSplit(node, direction, leading, newNode, createNodeId)
  }

  if (isGroupNode(node)) {
    return null
  }

  const index = node.children.findIndex((child) => child.id === targetId)

  if (
    index >= 0 &&
    node.direction === direction &&
    (splitStyle === 'insert' || node.children[index].size === null)
  ) {
    const children = [...node.children]
    children.splice(leading ? index : index + 1, 0, newNode)

    return { ...node, children: toSplitChildren(children) }
  }

  for (let i = 0; i < node.children.length; i += 1) {
    const replaced = insertBeside(
      node.children[i],
      targetId,
      side,
      newNode,
      createNodeId,
      splitStyle
    )

    if (replaced === null) {
      continue
    }

    const children = [...node.children]
    children[i] = replaced

    return { ...node, children: toSplitChildren(children) }
  }

  return null
}

/**
 * ノードを新しい split で包み、その中に元のノードと新しいノードを並べる。
 *
 * 元のノードが持っていた size は split が引き継ぎ、中身は2つとも「残りを埋める」にする。
 * こうすると、分割しても外から見た領域の大きさは変わらず、中が等分される。
 */
function wrapInSplit(
  target: DockNode,
  direction: SplitDirection,
  leading: boolean,
  newNode: DockNode,
  createNodeId: () => DockNodeId
): DockNode {
  const inner = withSize(target, null)

  return {
    kind: 'split',
    id: createNodeId(),
    direction,
    size: target.size,
    children: toSplitChildren(leading ? [newNode, inner] : [inner, newNode])
  }
}

function samePanelOrder(a: readonly PanelId[], b: readonly PanelId[]): boolean {
  return a.length === b.length && a.every((panelId, index) => panelId === b[index])
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
