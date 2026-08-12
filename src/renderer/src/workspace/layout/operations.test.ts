import { describe, expect, it } from 'vitest'
import type { PanelId } from '../panels/types'
import { DEFAULT_WORKSPACE_LAYOUT } from './defaultLayout'
import { asDockNodeId } from './nodeId'
import {
  activatePanelInLayout,
  movePanel,
  removePanelFromLayout,
  splitNodeWithPanel,
  type DockOperationOptions
} from './operations'
import { collectPanelIds, findGroup, findLayoutProblems, findPanelLocation } from './tree'
import type { DockNode, DockNodeId, WorkspaceLayout } from './types'

/**
 * Dock / Split 操作の検証。
 *
 * 確かめたいことは3つ。
 *   1. 操作の結果が意図した木の形になること
 *   2. 同じパネルが2箇所に現れないこと
 *   3. どの操作をしても結果が正規形であること（＝空の領域や子1つの split を残さない）
 *
 * 3 は個別に書くと漏れるため、木の形を確かめる箇所では毎回 expectLayout を通す。
 */

const LEFT = asDockNodeId('left')
const CENTER = asDockNodeId('center')
const RIGHT = asDockNodeId('right')
const BOTTOM = asDockNodeId('bottom')

/** テスト中に作られるノードの id を固定する。 */
function fixedIds(): DockOperationOptions {
  let count = 0

  return {
    createNodeId: (): DockNodeId => {
      count += 1

      return asDockNodeId(`new-${count}`)
    }
  }
}

/**
 * 木の形を1行で表す。
 *   row(...) / column(...) … 分割とその向き
 *   [a,b]                  … 領域とその中のパネル（並び順）
 */
function shapeOf(node: DockNode): string {
  if (node.kind === 'group') {
    return `[${node.panelIds.join(',')}]`
  }

  return `${node.direction}(${node.children.map(shapeOf).join(' ')})`
}

/** 木の形を確かめると同時に、正規形から外れていないことも確かめる。 */
function expectLayout(layout: WorkspaceLayout, shape: string): void {
  expect(shapeOf(layout.root)).toBe(shape)
  expect(findLayoutProblems(layout)).toEqual([])

  const panelIds = collectPanelIds(layout.root)
  expect(new Set(panelIds).size).toBe(panelIds.length)
}

function activeOf(layout: WorkspaceLayout, groupId: DockNodeId): PanelId | null {
  return findGroup(layout.root, groupId)?.activePanelId ?? null
}

describe('初期レイアウト', () => {
  it('Files → left / Editor → center / Git → right / Terminal → bottom で、正規形である', () => {
    expectLayout(DEFAULT_WORKSPACE_LAYOUT, 'column(row([files] [editor] [git]) [terminal])')

    expect(findPanelLocation(DEFAULT_WORKSPACE_LAYOUT.root, 'files')?.group.id).toBe('left')
    expect(findPanelLocation(DEFAULT_WORKSPACE_LAYOUT.root, 'editor')?.group.id).toBe('center')
    expect(findPanelLocation(DEFAULT_WORKSPACE_LAYOUT.root, 'git')?.group.id).toBe('right')
    expect(findPanelLocation(DEFAULT_WORKSPACE_LAYOUT.root, 'terminal')?.group.id).toBe('bottom')
  })
})

describe('activatePanelInLayout', () => {
  const layout = movePanel(DEFAULT_WORKSPACE_LAYOUT, 'git', { kind: 'tab', groupId: BOTTOM })

  it('指定した領域のタブだけを切り替える', () => {
    const next = activatePanelInLayout(layout, BOTTOM, 'terminal')

    expect(activeOf(next, BOTTOM)).toBe('terminal')
    expect(findGroup(next.root, BOTTOM)?.panelIds).toEqual(['terminal', 'git'])
    expect(findGroup(next.root, CENTER)).toBe(findGroup(layout.root, CENTER))
  })

  it('既に手前にあるパネル・その領域に無いパネル・無い領域では元のレイアウトを返す', () => {
    expect(activatePanelInLayout(layout, BOTTOM, 'git')).toBe(layout)
    expect(activatePanelInLayout(layout, BOTTOM, 'files')).toBe(layout)
    expect(activatePanelInLayout(layout, asDockNodeId('none'), 'files')).toBe(layout)
  })
})

describe('movePanel（タブとして別領域へ）', () => {
  it('移動先へ入れ、空になった移動元の領域は木から消える', () => {
    const next = movePanel(DEFAULT_WORKSPACE_LAYOUT, 'git', { kind: 'tab', groupId: BOTTOM })

    expectLayout(next, 'column(row([files] [editor]) [terminal,git])')
    // 移動したパネルを手前に出す。
    expect(activeOf(next, BOTTOM)).toBe('git')
    expect(findGroup(next.root, RIGHT)).toBeNull()
  })

  it('index を指定するとその位置へ入る', () => {
    const next = movePanel(DEFAULT_WORKSPACE_LAYOUT, 'files', {
      kind: 'tab',
      groupId: CENTER,
      index: 0
    })

    expectLayout(next, 'column(row([files,editor] [git]) [terminal])')
    expect(activeOf(next, CENTER)).toBe('files')
  })

  it('同じ領域の中では並べ替えになる', () => {
    const layout = movePanel(DEFAULT_WORKSPACE_LAYOUT, 'git', { kind: 'tab', groupId: BOTTOM })

    const next = movePanel(layout, 'terminal', { kind: 'tab', groupId: BOTTOM, index: 1 })

    expectLayout(next, 'column(row([files] [editor]) [git,terminal])')
    expect(activeOf(next, BOTTOM)).toBe('terminal')
  })

  it('並び順も手前のパネルも変わらない移動では元のレイアウトを返す', () => {
    const layout = movePanel(DEFAULT_WORKSPACE_LAYOUT, 'git', { kind: 'tab', groupId: BOTTOM })

    expect(movePanel(layout, 'git', { kind: 'tab', groupId: BOTTOM })).toBe(layout)
  })

  it('移動元の領域に残ったパネルが手前に出る', () => {
    const layout = movePanel(DEFAULT_WORKSPACE_LAYOUT, 'git', { kind: 'tab', groupId: BOTTOM })

    const next = movePanel(layout, 'git', { kind: 'tab', groupId: CENTER })

    expect(activeOf(next, BOTTOM)).toBe('terminal')
    expectLayout(next, 'column(row([files] [editor,git]) [terminal])')
  })

  it('レイアウトに無いパネルは追加として扱う', () => {
    const closed = removePanelFromLayout(DEFAULT_WORKSPACE_LAYOUT, 'git')

    const next = movePanel(closed, 'git', { kind: 'tab', groupId: LEFT })

    expectLayout(next, 'column(row([files,git] [editor]) [terminal])')
  })

  it('移動先の領域が無ければ何もしない', () => {
    expect(
      movePanel(DEFAULT_WORKSPACE_LAYOUT, 'git', { kind: 'tab', groupId: asDockNodeId('none') })
    ).toBe(DEFAULT_WORKSPACE_LAYOUT)
  })
})

describe('movePanel（領域を分割してその側へ）', () => {
  it('親が同じ向きの split で、対象が残りを埋める領域なら、入れ子にせず兄弟として並べる', () => {
    const next = movePanel(
      DEFAULT_WORKSPACE_LAYOUT,
      'terminal',
      { kind: 'split', groupId: CENTER, side: 'right' },
      fixedIds()
    )

    // bottom が空になって畳まれ、root（column）も子が1つになるため main-row が繰り上がる。
    expectLayout(next, 'row([files] [editor] [terminal] [git])')
    expect(findGroup(next.root, asDockNodeId('new-1'))?.panelIds).toEqual(['terminal'])
    // 新しい領域は「残りを埋める」。分割は等分から始まる。
    expect(findGroup(next.root, asDockNodeId('new-1'))?.size).toBeNull()
  })

  it('left（縦の境界で分割）と right で、新しい領域の位置が入れ替わる', () => {
    const next = movePanel(
      DEFAULT_WORKSPACE_LAYOUT,
      'terminal',
      { kind: 'split', groupId: CENTER, side: 'left' },
      fixedIds()
    )

    expectLayout(next, 'row([files] [terminal] [editor] [git])')
  })

  it('向きが違う場合は、対象の領域を新しい split で包む', () => {
    const next = movePanel(
      DEFAULT_WORKSPACE_LAYOUT,
      'git',
      { kind: 'split', groupId: BOTTOM, side: 'right' },
      fixedIds()
    )

    expectLayout(next, 'column(row([files] [editor]) row([terminal] [git]))')

    // 外から見た大きさ（bottom の 220px）は新しい split が引き継ぎ、中身は等分になる。
    // 新しい領域（new-1）を作ってから、それを収める split（new-2）を作る。
    const wrapper = next.root.kind === 'split' ? next.root.children[1] : null
    expect(wrapper?.id).toBe('new-2')
    expect(wrapper?.size).toBe(220)
    expect(findGroup(next.root, BOTTOM)?.size).toBeNull()
  })

  it('top / bottom は横の境界で分割する', () => {
    const next = movePanel(
      DEFAULT_WORKSPACE_LAYOUT,
      'git',
      { kind: 'split', groupId: CENTER, side: 'top' },
      fixedIds()
    )

    expectLayout(next, 'column(row([files] column([git] [editor])) [terminal])')
  })

  it('root そのものも分割できる', () => {
    const single: WorkspaceLayout = {
      root: {
        kind: 'group',
        id: LEFT,
        panelIds: ['files', 'editor'],
        activePanelId: 'files',
        size: null
      }
    }

    const next = movePanel(
      single,
      'editor',
      { kind: 'split', groupId: LEFT, side: 'bottom' },
      fixedIds()
    )

    expectLayout(next, 'column([files] [editor])')
  })

  it('1枚しか入っていない領域を、その領域自身の分割先へ動かしても何も起きない', () => {
    expect(
      movePanel(DEFAULT_WORKSPACE_LAYOUT, 'editor', {
        kind: 'split',
        groupId: CENTER,
        side: 'right'
      })
    ).toBe(DEFAULT_WORKSPACE_LAYOUT)
  })

  it('タブが2枚ある領域は、その領域自身を分割して切り離せる', () => {
    const layout = movePanel(DEFAULT_WORKSPACE_LAYOUT, 'git', { kind: 'tab', groupId: BOTTOM })

    const next = movePanel(
      layout,
      'git',
      { kind: 'split', groupId: BOTTOM, side: 'bottom' },
      fixedIds()
    )

    expectLayout(next, 'column(row([files] [editor]) column([terminal] [git]))')
  })

  it('splitNodeWithPanel は同じ結果になる', () => {
    const target = { kind: 'split', groupId: BOTTOM, side: 'right' } as const

    expect(
      splitNodeWithPanel(DEFAULT_WORKSPACE_LAYOUT, BOTTOM, 'right', 'git', fixedIds())
    ).toEqual(movePanel(DEFAULT_WORKSPACE_LAYOUT, 'git', target, fixedIds()))
  })
})

describe('splitNodeWithPanel（領域に限らないノードの分割）', () => {
  it('split ノードを対象にすると、その部分木の外側に並ぶ', () => {
    // main-row（Files / Editor / Git の並び）ごと下へ分割する。
    const next = splitNodeWithPanel(
      DEFAULT_WORKSPACE_LAYOUT,
      asDockNodeId('main-row'),
      'bottom',
      'terminal',
      fixedIds()
    )

    // terminal は元の位置から抜け、main-row 全体の下に入り直す（形は初期レイアウトと同じ）。
    expectLayout(next, 'column(row([files] [editor] [git]) [terminal])')
    expect(findGroup(next.root, asDockNodeId('new-1'))?.panelIds).toEqual(['terminal'])
  })

  it('無いノードを対象にすると何もしない', () => {
    expect(splitNodeWithPanel(DEFAULT_WORKSPACE_LAYOUT, asDockNodeId('none'), 'left', 'git')).toBe(
      DEFAULT_WORKSPACE_LAYOUT
    )
  })
})

describe('removePanelFromLayout', () => {
  it('空になった領域を木から外す', () => {
    const next = removePanelFromLayout(DEFAULT_WORKSPACE_LAYOUT, 'git')

    expectLayout(next, 'column(row([files] [editor]) [terminal])')
  })

  it('タブが残っていれば領域はそのまま残る', () => {
    const layout = movePanel(DEFAULT_WORKSPACE_LAYOUT, 'git', { kind: 'tab', groupId: BOTTOM })

    const next = removePanelFromLayout(layout, 'git')

    expectLayout(next, 'column(row([files] [editor]) [terminal])')
    expect(activeOf(next, BOTTOM)).toBe('terminal')
  })

  it('レイアウトに無いパネルでは元のレイアウトを返す', () => {
    const closed = removePanelFromLayout(DEFAULT_WORKSPACE_LAYOUT, 'git')

    expect(removePanelFromLayout(closed, 'git')).toBe(closed)
  })

  it('すべて外すと空のレイアウトになる', () => {
    const panelIds: readonly PanelId[] = ['files', 'editor', 'git', 'terminal']

    const next = panelIds.reduce(removePanelFromLayout, DEFAULT_WORKSPACE_LAYOUT)

    expectLayout(next, '[]')
  })
})

describe('操作を重ねても壊れない', () => {
  it('初期レイアウトから移動と分割を繰り返しても、パネルは1枚ずつ残る', () => {
    const options = fixedIds()

    // Terminal を右へ、Git を Files と同じ領域へ、Editor を下に分割…と動かしていく。
    // right は 280px を持つため、兄弟ではなく入れ子になる（その 280px を2つで分け合う）。
    const step1 = movePanel(
      DEFAULT_WORKSPACE_LAYOUT,
      'terminal',
      { kind: 'split', groupId: RIGHT, side: 'right' },
      options
    )
    expectLayout(step1, 'row([files] [editor] row([git] [terminal]))')

    const step2 = movePanel(step1, 'git', { kind: 'tab', groupId: LEFT }, options)
    expectLayout(step2, 'row([files,git] [editor] [terminal])')

    const step3 = movePanel(
      step2,
      'editor',
      { kind: 'split', groupId: LEFT, side: 'bottom' },
      options
    )
    expectLayout(step3, 'row(column([files,git] [editor]) [terminal])')

    const step4 = movePanel(step3, 'terminal', { kind: 'tab', groupId: LEFT, index: 0 }, options)
    expectLayout(step4, 'column([terminal,files,git] [editor])')

    expect([...collectPanelIds(step4.root)].sort()).toEqual(['editor', 'files', 'git', 'terminal'])
  })
})
