import { describe, expect, it } from 'vitest'
import { DEFAULT_WORKSPACE_LAYOUT } from '../layout/defaultLayout'
import { asDockNodeId } from '../layout/nodeId'
import { movePanel } from '../layout/operations'
import { collectPanelIds, findGroup, findLayoutProblems } from '../layout/tree'
import type { DockNode, DockNodeId, WorkspaceLayout } from '../layout/types'
import type { PanelId } from '../panels/types'
import { canDropIntoGroup, collectDroppableGroupIds, resolveDropTarget } from './dropTarget'
import type { DockZone } from './types'

/**
 * ドロップ位置 → Dock 操作の翻訳の検証。
 *
 * 確かめたいことは3つ。
 *   1. 5方向がそれぞれ意図した DockTarget になること
 *   2. 何も起きないドロップ・受け付けられないドロップを、操作を呼ぶ前に弾けること
 *   3. 翻訳結果を movePanel に渡すと、実際に期待どおりのレイアウトになること
 *
 * 3 まで確かめるのは、ドロップ位置の解釈とレイアウト操作が別々に正しくても、
 * つなぎ方を間違えれば「左に落としたのに右に出る」が起きるため。
 */

const LEFT = asDockNodeId('left')
const CENTER = asDockNodeId('center')
const RIGHT = asDockNodeId('right')
const BOTTOM = asDockNodeId('bottom')

/** 木の形を1行で表す（layout/operations.test.ts と同じ書き方）。 */
function shapeOf(node: DockNode): string {
  if (node.kind === 'group') {
    return `[${node.panelIds.join(',')}]`
  }

  return `${node.direction}(${node.children.map(shapeOf).join(' ')})`
}

/**
 * ドロップ1回分。
 *
 * 実際の UI と同じ順序（位置 → DockTarget → movePanel）を通し、
 * 途中で null になった場合はレイアウトを変えない、という UI 側の約束も一緒に再現する。
 */
function drop(
  layout: WorkspaceLayout,
  panelId: PanelId,
  groupId: DockNodeId,
  zone: DockZone
): WorkspaceLayout {
  const target = resolveDropTarget(layout, panelId, groupId, zone)

  return target === null ? layout : movePanel(layout, panelId, target)
}

/** ドロップの結果が正規形であること（空の領域もパネルの重複も残らないこと）も毎回見る。 */
function expectLayout(layout: WorkspaceLayout, shape: string): void {
  expect(shapeOf(layout.root)).toBe(shape)
  expect(findLayoutProblems(layout)).toEqual([])

  const panelIds = collectPanelIds(layout.root)
  expect(new Set(panelIds).size).toBe(panelIds.length)
}

describe('resolveDropTarget', () => {
  it('中央は、その領域へのタブ追加になる', () => {
    expect(resolveDropTarget(DEFAULT_WORKSPACE_LAYOUT, 'files', CENTER, 'center')).toEqual({
      kind: 'tab',
      groupId: CENTER
    })
  })

  it('上下左右は、その領域の分割になる（方向はそのまま DockSide になる）', () => {
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      expect(resolveDropTarget(DEFAULT_WORKSPACE_LAYOUT, 'files', CENTER, side)).toEqual({
        kind: 'split',
        groupId: CENTER,
        side
      })
    }
  })

  it('もう存在しない領域へは落とせない', () => {
    expect(
      resolveDropTarget(DEFAULT_WORKSPACE_LAYOUT, 'files', asDockNodeId('none'), 'center')
    ).toBeNull()
  })

  it('今そのパネルが居る領域の中央へは落とせない（既にそこのタブのため）', () => {
    expect(resolveDropTarget(DEFAULT_WORKSPACE_LAYOUT, 'files', LEFT, 'center')).toBeNull()
  })

  it('1枚しか入っていない領域を、その領域自身の分割先へは落とせない', () => {
    expect(resolveDropTarget(DEFAULT_WORKSPACE_LAYOUT, 'files', LEFT, 'right')).toBeNull()
  })

  it('タブが2枚以上ある領域は、その領域自身の分割先へ落として切り離せる', () => {
    const tabbed = movePanel(DEFAULT_WORKSPACE_LAYOUT, 'git', { kind: 'tab', groupId: BOTTOM })

    expect(resolveDropTarget(tabbed, 'git', BOTTOM, 'bottom')).toEqual({
      kind: 'split',
      groupId: BOTTOM,
      side: 'bottom'
    })
    expect(resolveDropTarget(tabbed, 'git', BOTTOM, 'center')).toBeNull()
  })

  it('レイアウトにまだ無いパネルは、どの領域へも落とせる（開く操作と同じ経路）', () => {
    const closed = movePanel(DEFAULT_WORKSPACE_LAYOUT, 'git', { kind: 'tab', groupId: BOTTOM })
    const removed = drop(closed, 'git', BOTTOM, 'center')

    expect(resolveDropTarget(removed, 'git', LEFT, 'center')).toEqual({
      kind: 'tab',
      groupId: LEFT
    })
  })
})

describe('受け入れられる領域', () => {
  it('自分しか入っていない領域は、そのパネル自身のドロップを受け付けない', () => {
    expect(canDropIntoGroup(DEFAULT_WORKSPACE_LAYOUT, 'files', LEFT)).toBe(false)
    expect(canDropIntoGroup(DEFAULT_WORKSPACE_LAYOUT, 'files', CENTER)).toBe(true)
  })

  it('ドラッグ中のパネルを受け入れられる領域だけを集める', () => {
    expect(collectDroppableGroupIds(DEFAULT_WORKSPACE_LAYOUT, 'files')).toEqual(
      new Set([CENTER, RIGHT, BOTTOM])
    )
  })

  it('タブが2枚ある領域は、自分自身も受け入れ先になる（切り離せるため）', () => {
    const tabbed = movePanel(DEFAULT_WORKSPACE_LAYOUT, 'git', { kind: 'tab', groupId: BOTTOM })

    expect(collectDroppableGroupIds(tabbed, 'git')).toEqual(new Set([LEFT, CENTER, BOTTOM]))
  })
})

describe('ドロップからレイアウト操作まで', () => {
  it('Files を Editor の中央へ落とすと、Editor と同じ領域のタブになる', () => {
    const next = drop(DEFAULT_WORKSPACE_LAYOUT, 'files', CENTER, 'center')

    expectLayout(next, 'column(row([editor,files] [git]) [terminal])')
    // 落としたパネルが手前に出る。
    expect(findGroup(next.root, CENTER)?.activePanelId).toBe('files')
  })

  it('Files を Editor の左へ落とすと、左右の分割になる', () => {
    const next = drop(DEFAULT_WORKSPACE_LAYOUT, 'files', CENTER, 'left')

    // 元の left が空になって消え、新しい領域が Editor の左隣に入る。
    expectLayout(next, 'column(row([files] [editor] [git]) [terminal])')
  })

  it('Terminal を Editor の下へ落とすと、上下の分割になる', () => {
    const next = drop(DEFAULT_WORKSPACE_LAYOUT, 'terminal', CENTER, 'bottom')

    expectLayout(next, 'row([files] column([editor] [terminal]) [git])')
  })

  it('Git を別の領域へ移すと、空になった領域は木から消える', () => {
    const next = drop(DEFAULT_WORKSPACE_LAYOUT, 'git', BOTTOM, 'center')

    expectLayout(next, 'column(row([files] [editor]) [terminal,git])')
    expect(findGroup(next.root, RIGHT)).toBeNull()
  })

  it('何も起きないドロップではレイアウトが変わらない', () => {
    expect(drop(DEFAULT_WORKSPACE_LAYOUT, 'files', LEFT, 'center')).toBe(DEFAULT_WORKSPACE_LAYOUT)
    expect(drop(DEFAULT_WORKSPACE_LAYOUT, 'files', LEFT, 'top')).toBe(DEFAULT_WORKSPACE_LAYOUT)
  })

  it('落とし続けてもパネルは1枚ずつしか存在しない', () => {
    const step1 = drop(DEFAULT_WORKSPACE_LAYOUT, 'files', CENTER, 'center')
    const step2 = drop(step1, 'terminal', CENTER, 'right')
    const step3 = drop(step2, 'files', CENTER, 'bottom')
    const step4 = drop(step3, 'git', CENTER, 'center')

    expect([...collectPanelIds(step4.root)].sort()).toEqual(['editor', 'files', 'git', 'terminal'])
    expect(findLayoutProblems(step4)).toEqual([])
  })
})
