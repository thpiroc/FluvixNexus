import type { PanelId } from '../panels/types'
import { asDockNodeId } from './nodeId'
import type {
  DockGroupNode,
  DockNode,
  DockNodeId,
  DockSplitChildren,
  DockSplitNode,
  WorkspaceLayout
} from './types'

/**
 * レイアウトの木を「読む」ための層。
 *
 * layout/ の中の役割分担:
 *   types.ts      … 形の定義
 *   tree.ts       … 木の探索・組み立て・正規化・検証（このファイル）
 *   operations.ts … レイアウトを変える操作（Dock / Split / タブ）
 *
 * 木を扱う共通処理をここに集めているのは、操作が増えるほど
 * 「取り除いた結果どうなるか」の判断が重複するため。
 * 正規形の定義（＝何を不正とみなすか）もこのファイルが持つ。
 */

/** 空のレイアウト。パネルが1枚も無い状態を表す（root だけは空の group を許す）。 */
const EMPTY_ROOT: DockGroupNode = {
  kind: 'group',
  id: asDockNodeId('empty-root'),
  panelIds: [],
  activePanelId: null,
  size: null
}

export function isGroupNode(node: DockNode): node is DockGroupNode {
  return node.kind === 'group'
}

export function isSplitNode(node: DockNode): node is DockSplitNode {
  return node.kind === 'split'
}

/**
 * 実際に表示すべきパネルを決める。
 *
 * activePanelId は保存されたレイアウトから来る値であり、
 * パネルの追加・削除やアプリの更新で領域の中身とずれることがある。
 * 「ずれていたら先頭を出す」ことにして、描画側が不整合を意識しなくて済むようにする。
 */
export function resolveActivePanelId(group: DockGroupNode): PanelId | null {
  return resolveActive(group.panelIds, group.activePanelId)
}

function resolveActive(
  panelIds: readonly PanelId[],
  activePanelId: PanelId | null
): PanelId | null {
  if (activePanelId !== null && panelIds.includes(activePanelId)) {
    return activePanelId
  }

  return panelIds[0] ?? null
}

/** 木を根から順に辿る。並び順は画面の並び順（split の children 順）と一致する。 */
export function collectNodes(node: DockNode): readonly DockNode[] {
  if (isGroupNode(node)) {
    return [node]
  }

  return [node, ...node.children.flatMap((child) => collectNodes(child))]
}

/** 木に含まれる group をすべて集める。ドロップ先の候補やデバッグ表示に使う。 */
export function collectGroups(node: DockNode): readonly DockGroupNode[] {
  return collectNodes(node).filter(isGroupNode)
}

/** 木に含まれるパネルをすべて集める。並び順は画面の並び順。 */
export function collectPanelIds(node: DockNode): readonly PanelId[] {
  return collectGroups(node).flatMap((group) => [...group.panelIds])
}

export function findNode(node: DockNode, nodeId: DockNodeId): DockNode | null {
  return collectNodes(node).find((candidate) => candidate.id === nodeId) ?? null
}

export function findGroup(node: DockNode, groupId: DockNodeId): DockGroupNode | null {
  const found = findNode(node, groupId)

  return found !== null && isGroupNode(found) ? found : null
}

/**
 * 根から指定したノードまでの経路（先頭が根、末尾が対象）。見つからなければ null。
 *
 * 「そのノードが木のどのあたりに居るか」を知るために使う。
 * 位置は領域自身の属性ではなく木の形から決まる結果なので、位置を問いたい側は
 * 経路を辿って親の split の向きと子の並び順を読む（layout/panelVisibility.ts）。
 */
export function findNodePath(node: DockNode, nodeId: DockNodeId): readonly DockNode[] | null {
  if (node.id === nodeId) {
    return [node]
  }

  if (isGroupNode(node)) {
    return null
  }

  for (const child of node.children) {
    const path = findNodePath(child, nodeId)

    if (path !== null) {
      return [node, ...path]
    }
  }

  return null
}

/**
 * 指定したパネルをすべて含む最小のノード。1枚でも欠けていれば null。
 *
 * 「この何枚かのパネルが今まとまって置かれている範囲」を1つのノードとして取り出すためのもの。
 * 閉じたパネルを戻す位置を決めるときに、戻り先の基準を領域（葉）に限らず
 * 部分木として指せるようにするために要る（Terminal を画面下いっぱいに戻す場合など）。
 */
export function findSmallestNodeContaining(
  node: DockNode,
  panelIds: readonly PanelId[]
): DockNode | null {
  if (panelIds.length === 0) {
    return null
  }

  const owned = new Set(collectPanelIds(node))

  if (!panelIds.every((panelId) => owned.has(panelId))) {
    return null
  }

  if (isSplitNode(node)) {
    for (const child of node.children) {
      const found = findSmallestNodeContaining(child, panelIds)

      if (found !== null) {
        return found
      }
    }
  }

  return node
}

/** パネルが今どの group の何番目にあるか。木のどこにでも1回だけ現れる前提（正規形の条件）。 */
export interface PanelLocation {
  readonly group: DockGroupNode
  readonly index: number
}

export function findPanelLocation(node: DockNode, panelId: PanelId): PanelLocation | null {
  for (const group of collectGroups(node)) {
    const index = group.panelIds.indexOf(panelId)

    if (index >= 0) {
      return { group, index }
    }
  }

  return null
}

/**
 * 配列を split の children として扱う。
 *
 * 2つ未満の split は作れないという不変条件を、型の側から通すための入口。
 * 呼び出し側は必ず件数を確かめてから渡すため、例外は本来到達しない。
 */
export function toSplitChildren(children: readonly DockNode[]): DockSplitChildren {
  if (children.length < 2) {
    throw new Error(`split には2つ以上の子が必要です（受け取った数: ${children.length}）`)
  }

  return children as DockSplitChildren
}

/** サイズだけを差し替える。畳んだ split の代わりに子を置くときなど、箱の大きさを引き継ぐために使う。 */
export function withSize(node: DockNode, size: number | null): DockNode {
  return node.size === size ? node : { ...node, size }
}

/** root が無くなった場合（最後のパネルを取り除いた場合）も含めてレイアウトを組み立てる。 */
export function layoutFromRoot(root: DockNode | null): WorkspaceLayout {
  return { root: root ?? EMPTY_ROOT }
}

/**
 * 指定した group を置き換える。
 *
 * map が null を返した場合はその group を木から取り除き、
 * 結果として子が減った split もその場で畳む（空の領域を残さないためのルール）。
 *
 *   - 子が0になった split … 取り除く
 *   - 子が1つになった split … その子で置き換える。子は split が持っていた size を引き継ぐ
 *
 * 変化が無い場合は元のノードをそのまま返し、不要な再描画を起こさない。
 */
export function mapGroup(
  node: DockNode,
  groupId: DockNodeId,
  map: (group: DockGroupNode) => DockNode | null
): DockNode | null {
  if (isGroupNode(node)) {
    return node.id === groupId ? map(node) : node
  }

  const index = node.children.findIndex((child) => findNode(child, groupId) !== null)

  if (index < 0) {
    return node
  }

  const replaced = mapGroup(node.children[index], groupId, map)

  if (replaced === node.children[index]) {
    return node
  }

  const children = [...node.children]

  if (replaced === null) {
    children.splice(index, 1)
  } else {
    children[index] = replaced
  }

  if (children.length === 0) {
    return null
  }

  if (children.length === 1) {
    return withSize(children[0], node.size)
  }

  return { ...node, children: toSplitChildren(children) }
}

/**
 * 指定したノードを差し替える。
 *
 * mapGroup と違い、葉に限らずどのノードでも対象にでき、取り除きもしない
 * （＝木の形は変わらず、ノードの中身だけが変わる）。size の書き換えのように
 * 「領域の増減を伴わない変更」はこちらを使う。
 *
 * 対象が見つからない場合と、map が同じノードを返した場合は元のノードをそのまま返す。
 */
export function mapNode(
  node: DockNode,
  nodeId: DockNodeId,
  map: (target: DockNode) => DockNode
): DockNode {
  if (node.id === nodeId) {
    return map(node)
  }

  if (isGroupNode(node)) {
    return node
  }

  const index = node.children.findIndex((child) => findNode(child, nodeId) !== null)

  if (index < 0) {
    return node
  }

  const replaced = mapNode(node.children[index], nodeId, map)

  if (replaced === node.children[index]) {
    return node
  }

  const children = [...node.children]
  children[index] = replaced

  return { ...node, children: toSplitChildren(children) }
}

/**
 * レイアウトを正規形に整える。
 *
 * 操作関数は必要な後片付けをその場で済ませるため、通常の操作でここが何かを直すことはない。
 * 効いてくるのは保存されたレイアウトを読み込むとき（アプリの更新でパネル構成が変わった後など）で、
 * 「壊れた入力でも描画できる形にして返す」ことがこの関数の役目。
 *
 * 正規形の条件:
 *   1. 同じ PanelId が2箇所に現れない（先に現れた方を残す）
 *   2. パネルが無い group は木に無い（root だけは例外）
 *   3. split の子は2つ以上
 *   4. 同じ向きの split が入れ子になっていない
 *   5. activePanelId はその group にあるパネルを指している
 *
 * 4 の平坦化は size が null の split だけを対象にする。
 * サイズを持つ split を平坦化すると箱の大きさが変わってしまうため。
 * （null 同士の等分比率はわずかに変わりうるが、木を浅く保つ方を優先する）
 */
export function normalizeLayout(layout: WorkspaceLayout): WorkspaceLayout {
  const root = normalizeNode(layout.root, new Set<PanelId>())

  if (root === layout.root) {
    return layout
  }

  return layoutFromRoot(root)
}

function normalizeNode(node: DockNode, seen: Set<PanelId>): DockNode | null {
  if (isGroupNode(node)) {
    return normalizeGroup(node, seen)
  }

  const children: DockNode[] = []
  let changed = false

  for (const child of node.children) {
    const normalized = normalizeNode(child, seen)

    if (normalized !== child) {
      changed = true
    }

    if (normalized === null) {
      continue
    }

    // 同じ向きで、かつ残りを埋めるだけの split は親に取り込む。
    if (
      isSplitNode(normalized) &&
      normalized.direction === node.direction &&
      normalized.size === null
    ) {
      children.push(...normalized.children)
      changed = true
      continue
    }

    children.push(normalized)
  }

  if (children.length === 0) {
    return null
  }

  if (children.length === 1) {
    return withSize(children[0], node.size)
  }

  return changed ? { ...node, children: toSplitChildren(children) } : node
}

function normalizeGroup(group: DockGroupNode, seen: Set<PanelId>): DockGroupNode | null {
  const panelIds = group.panelIds.filter((panelId) => {
    if (seen.has(panelId)) {
      return false
    }

    seen.add(panelId)

    return true
  })

  if (panelIds.length === 0) {
    return null
  }

  const activePanelId = resolveActive(panelIds, group.activePanelId)

  if (panelIds.length === group.panelIds.length && activePanelId === group.activePanelId) {
    return group
  }

  return { ...group, panelIds, activePanelId }
}

/**
 * 正規形から外れている点を挙げる。
 *
 * 返すのは開発者向けの文言で、UI には出さない。
 * 用途は2つ:
 *   - テストで「操作の結果が正規形である」ことを毎回確かめる
 *   - 開発ビルドで、操作のたびに壊れていないかを検査する（useWorkspaceLayout）
 */
export function findLayoutProblems(layout: WorkspaceLayout): readonly string[] {
  const problems: string[] = []
  const nodes = collectNodes(layout.root)
  const seenNodeIds = new Set<DockNodeId>()
  const seenPanelIds = new Set<PanelId>()

  for (const node of nodes) {
    if (seenNodeIds.has(node.id)) {
      problems.push(`ノード id が重複しています: ${node.id}`)
    }
    seenNodeIds.add(node.id)

    if (node.size !== null && !(node.size > 0)) {
      problems.push(`size は正の数か null である必要があります: ${node.id} = ${node.size}`)
    }

    if (isSplitNode(node)) {
      if (node.children.length < 2) {
        problems.push(`split の子が2つ未満です: ${node.id}`)
      }

      for (const child of node.children) {
        if (isSplitNode(child) && child.direction === node.direction && child.size === null) {
          problems.push(`同じ向きの split が入れ子になっています: ${node.id} > ${child.id}`)
        }
      }

      continue
    }

    if (node.panelIds.length === 0 && node !== layout.root) {
      problems.push(`パネルが無い group が残っています: ${node.id}`)
    }

    if (node.activePanelId !== null && !node.panelIds.includes(node.activePanelId)) {
      problems.push(`activePanelId がその group にありません: ${node.id} = ${node.activePanelId}`)
    }

    if (node.activePanelId === null && node.panelIds.length > 0) {
      problems.push(`パネルがあるのに activePanelId が null です: ${node.id}`)
    }

    for (const panelId of node.panelIds) {
      if (seenPanelIds.has(panelId)) {
        problems.push(`同じパネルが複数の領域にあります: ${panelId}`)
      }
      seenPanelIds.add(panelId)
    }
  }

  return problems
}
