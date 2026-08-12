import { describe, expect, it } from 'vitest'
import type { PanelId } from '../panels/types'
import { DEFAULT_WORKSPACE_LAYOUT } from './defaultLayout'
import { asDockNodeId } from './nodeId'
import { movePanel } from './operations'
import type { DockOperationOptions } from './operations'
import {
  closePanelInLayout,
  isPanelVisible,
  listVisiblePanelIds,
  openPanelInLayout,
  resolvePanelPlacement
} from './panelVisibility'
import { resizeNode } from './resize'
import { collectPanelIds, findGroup, findLayoutProblems, findPanelLocation } from './tree'
import type { DockNode, WorkspaceLayout } from './types'

/**
 * パネルの表示 / 非表示と、再表示したときの戻り先の検証。
 *
 * 確かめたいことは4つ。
 *   1. 閉じてもレイアウトが壊れないこと（空の領域が残らない・最後の1枚でも破綻しない）
 *   2. 戻したときに「本来の位置」へ戻ること（Files は Editor の左、Terminal は下いっぱい）
 *   3. 配置を組み替えた後でも戻せること（ドラッグ&ドロップ・リサイズ後）
 *   4. 何度閉じて開いても、同じパネルが2枚に増えないこと
 */

const LEFT = asDockNodeId('left')
const CENTER = asDockNodeId('center')
const BOTTOM = asDockNodeId('bottom')

const ALL_PANEL_IDS: readonly PanelId[] = ['files', 'editor', 'git', 'terminal']

/** テスト中に作られるノードの id を固定する。 */
function fixedIds(): DockOperationOptions {
  let count = 0

  return {
    createNodeId: () => {
      count += 1

      return asDockNodeId(`new-${count}`)
    }
  }
}

function shapeOf(node: DockNode): string {
  if (node.kind === 'group') {
    return `[${node.panelIds.join(',')}]`
  }

  return `${node.direction}(${node.children.map(shapeOf).join(' ')})`
}

function expectLayout(layout: WorkspaceLayout, shape: string): void {
  expect(shapeOf(layout.root)).toBe(shape)
  expect(findLayoutProblems(layout)).toEqual([])

  const panelIds = collectPanelIds(layout.root)
  expect(new Set(panelIds).size).toBe(panelIds.length)
}

/** そのパネルが今どれだけの基準サイズの領域に置かれているか。 */
function sizeOfPanel(layout: WorkspaceLayout, panelId: PanelId): number | null | undefined {
  return findPanelLocation(layout.root, panelId)?.group.size
}

/**
 * 閉じてから開き直す（実際の操作の最小単位）。
 *
 * 続けて何度も呼ぶ場合は、発番を共有するために options を渡す
 * （毎回作り直すと、前の操作で残った領域と id が衝突する）。
 */
function reopen(
  layout: WorkspaceLayout,
  panelId: PanelId,
  options: DockOperationOptions = fixedIds()
): WorkspaceLayout {
  return openPanelInLayout(
    closePanelInLayout(layout, panelId),
    panelId,
    DEFAULT_WORKSPACE_LAYOUT,
    options
  )
}

describe('表示状態の判定', () => {
  it('レイアウトに居るかどうかがそのまま可視状態になる', () => {
    expect(isPanelVisible(DEFAULT_WORKSPACE_LAYOUT, 'files')).toBe(true)
    expect(listVisiblePanelIds(DEFAULT_WORKSPACE_LAYOUT)).toEqual([
      'files',
      'editor',
      'git',
      'terminal'
    ])

    const closed = closePanelInLayout(DEFAULT_WORKSPACE_LAYOUT, 'files')

    expect(isPanelVisible(closed, 'files')).toBe(false)
    expect(listVisiblePanelIds(closed)).toEqual(['editor', 'git', 'terminal'])
  })
})

describe('パネルを閉じる', () => {
  it('空になった領域は木から消え、他の領域はそのまま残る', () => {
    expectLayout(
      closePanelInLayout(DEFAULT_WORKSPACE_LAYOUT, 'files'),
      'column(row([editor] [git]) [terminal])'
    )
  })

  it('タブが残っていれば領域は残り、残ったパネルが手前に出る', () => {
    const tabbed = movePanel(DEFAULT_WORKSPACE_LAYOUT, 'git', { kind: 'tab', groupId: BOTTOM })

    const next = closePanelInLayout(tabbed, 'git')

    expectLayout(next, 'column(row([files] [editor]) [terminal])')
    expect(findGroup(next.root, BOTTOM)?.activePanelId).toBe('terminal')
  })

  it('領域の最後の1枚を閉じると、その領域ごと畳まれる', () => {
    // bottom には terminal しか居ない。閉じると root（column）の子が1つになって繰り上がる。
    expectLayout(
      closePanelInLayout(DEFAULT_WORKSPACE_LAYOUT, 'terminal'),
      'row([files] [editor] [git])'
    )
  })

  it('すべて閉じても壊れず、空のレイアウトになる', () => {
    const empty = ALL_PANEL_IDS.reduce(closePanelInLayout, DEFAULT_WORKSPACE_LAYOUT)

    expectLayout(empty, '[]')
    expect(listVisiblePanelIds(empty)).toEqual([])
  })

  it('閉じているパネルをもう一度閉じても何も起きない', () => {
    const closed = closePanelInLayout(DEFAULT_WORKSPACE_LAYOUT, 'git')

    expect(closePanelInLayout(closed, 'git')).toBe(closed)
  })
})

describe('閉じたパネルを再表示する（初期レイアウトから）', () => {
  it('Files は Editor の左へ、幅もプリセットの 240px に戻る', () => {
    const next = reopen(DEFAULT_WORKSPACE_LAYOUT, 'files')

    expectLayout(next, 'column(row([files] [editor] [git]) [terminal])')
    expect(sizeOfPanel(next, 'files')).toBe(240)
  })

  it('Git は Editor の右へ、幅もプリセットの 280px に戻る', () => {
    const next = reopen(DEFAULT_WORKSPACE_LAYOUT, 'git')

    expectLayout(next, 'column(row([files] [editor] [git]) [terminal])')
    expect(sizeOfPanel(next, 'git')).toBe(280)
  })

  it('Terminal は横並び全体の下へ戻る（1つの領域の下ではない）', () => {
    const next = reopen(DEFAULT_WORKSPACE_LAYOUT, 'terminal')

    expectLayout(next, 'column(row([files] [editor] [git]) [terminal])')
    expect(sizeOfPanel(next, 'terminal')).toBe(220)
  })

  it('Editor は Files と Git の間へ戻る（大きさは等分のまま）', () => {
    const next = reopen(DEFAULT_WORKSPACE_LAYOUT, 'editor')

    expectLayout(next, 'column(row([files] [editor] [git]) [terminal])')
    // プリセットでも「残りを埋める」領域なので、引き継ぐ px は無い。
    expect(sizeOfPanel(next, 'editor')).toBeNull()
  })

  it('表示中のパネルを開くと、配置は変えずタブを手前に出すだけ', () => {
    const tabbed = movePanel(DEFAULT_WORKSPACE_LAYOUT, 'git', { kind: 'tab', groupId: LEFT })
    const layout = movePanel(tabbed, 'files', { kind: 'tab', groupId: LEFT, index: 0 })

    const next = openPanelInLayout(layout, 'git', DEFAULT_WORKSPACE_LAYOUT, fixedIds())

    expectLayout(next, 'column(row([files,git] [editor]) [terminal])')
    expect(findGroup(next.root, LEFT)?.activePanelId).toBe('git')
  })
})

describe('再表示の配置ルール', () => {
  it('プリセットで同じ領域に居たパネルが表示中なら、その領域へタブとして戻る', () => {
    // Files と Git を同じ領域に集めたプリセットを想定する。
    const preset: WorkspaceLayout = {
      root: {
        kind: 'split',
        id: asDockNodeId('preset-root'),
        direction: 'row',
        size: null,
        children: [
          {
            kind: 'group',
            id: asDockNodeId('preset-side'),
            panelIds: ['files', 'git'],
            activePanelId: 'files',
            size: 240
          },
          {
            kind: 'group',
            id: asDockNodeId('preset-main'),
            panelIds: ['editor'],
            activePanelId: 'editor',
            size: null
          }
        ]
      }
    }

    const layout = closePanelInLayout(DEFAULT_WORKSPACE_LAYOUT, 'git')

    expect(resolvePanelPlacement(layout, 'git', preset)).toEqual({ kind: 'tab', groupId: LEFT })
    expectLayout(
      openPanelInLayout(layout, 'git', preset, fixedIds()),
      'column(row([files,git] [editor]) [terminal])'
    )
  })

  it('プリセットで隣に居たパネルも閉じている場合は、さらに外側の関係で決める', () => {
    // Files と Editor を閉じた状態から Files を戻す。
    // プリセットでの隣（Editor）が居ないので、その次に近い Git が基準になる。
    const layout = ['files', 'editor'].reduce(
      (current, panelId) => closePanelInLayout(current, panelId as PanelId),
      DEFAULT_WORKSPACE_LAYOUT
    )

    expectLayout(layout, 'column([git] [terminal])')

    const next = openPanelInLayout(layout, 'files', DEFAULT_WORKSPACE_LAYOUT, fixedIds())

    expectLayout(next, 'column(row([files] [git]) [terminal])')
    expect(sizeOfPanel(next, 'files')).toBe(240)
  })

  it('他のパネルが1枚も無ければ、空のレイアウトへそのまま置く', () => {
    const empty = ALL_PANEL_IDS.reduce(closePanelInLayout, DEFAULT_WORKSPACE_LAYOUT)

    const next = openPanelInLayout(empty, 'terminal', DEFAULT_WORKSPACE_LAYOUT, fixedIds())

    expectLayout(next, '[terminal]')
  })

  it('プリセットに含まれないパネルは、先頭の領域へタブとして入る', () => {
    // Editor しか置かないプリセットを想定する（他のパネルは既定では閉じている扱い）。
    const preset: WorkspaceLayout = {
      root: {
        kind: 'group',
        id: asDockNodeId('preset-only'),
        panelIds: ['editor'],
        activePanelId: 'editor',
        size: null
      }
    }

    const next = openPanelInLayout(DEFAULT_WORKSPACE_LAYOUT, 'files', preset, fixedIds())

    // files は既に表示されているため、この場合はタブが手前に出るだけ。
    expectLayout(next, 'column(row([files] [editor] [git]) [terminal])')

    const closed = closePanelInLayout(DEFAULT_WORKSPACE_LAYOUT, 'files')

    expectLayout(
      openPanelInLayout(closed, 'files', preset, fixedIds()),
      'column(row([editor,files] [git]) [terminal])'
    )
  })
})

describe('配置を組み替えた後の閉じる / 再表示', () => {
  it('ドラッグ&ドロップで動かした後に閉じても、レイアウトが壊れない', () => {
    // Git を Terminal の領域へタブとして移し、Editor を下へ分割した状態。
    const moved = movePanel(DEFAULT_WORKSPACE_LAYOUT, 'git', { kind: 'tab', groupId: BOTTOM })
    const split = movePanel(
      moved,
      'editor',
      { kind: 'split', groupId: LEFT, side: 'bottom' },
      fixedIds()
    )

    expectLayout(split, 'column([files] [editor] [terminal,git])')

    const next = closePanelInLayout(split, 'git')

    expectLayout(next, 'column([files] [editor] [terminal])')
  })

  it('ドラッグ&ドロップで動かした後でも、閉じたパネルを近い場所へ戻せる', () => {
    const moved = movePanel(DEFAULT_WORKSPACE_LAYOUT, 'git', { kind: 'tab', groupId: BOTTOM })
    const closed = closePanelInLayout(moved, 'files')

    expectLayout(closed, 'column([editor] [terminal,git])')

    const next = openPanelInLayout(closed, 'files', DEFAULT_WORKSPACE_LAYOUT, fixedIds())

    // プリセットで隣だった Editor の左へ戻る（Git が動いていても影響しない）。
    expectLayout(next, 'column(row([files] [editor]) [terminal,git])')
    expect(sizeOfPanel(next, 'files')).toBe(240)
  })

  it('リサイズした大きさは、別のパネルを閉じても開いても保たれる', () => {
    const resized = resizeNode(DEFAULT_WORKSPACE_LAYOUT, LEFT, 300)

    const next = reopen(resized, 'terminal')

    expect(sizeOfPanel(next, 'files')).toBe(300)
    expectLayout(next, 'column(row([files] [editor] [git]) [terminal])')
  })

  it('px に固定された領域の隣へ戻しても、その領域は割られない', () => {
    const closed = closePanelInLayout(DEFAULT_WORKSPACE_LAYOUT, 'git')
    // Editor を px に固定してから Git を戻す（ドロップなら入れ子になる条件）。
    const resized = resizeNode(closed, CENTER, 400)

    const next = openPanelInLayout(resized, 'git', DEFAULT_WORKSPACE_LAYOUT, fixedIds())

    // 戻す操作は隣へ差し込む（splitStyle: 'insert'）ので、Editor の 400px はそのまま残る。
    expectLayout(next, 'column(row([files] [editor] [git]) [terminal])')
    expect(sizeOfPanel(next, 'editor')).toBe(400)
    expect(sizeOfPanel(next, 'git')).toBe(280)
  })
})

describe('閉じる / 再表示を繰り返しても壊れない', () => {
  it('全パネルを一巡しても、パネルは1枚ずつのままで初期の形に戻る', () => {
    const options = fixedIds()

    const next = ALL_PANEL_IDS.reduce(
      (current, panelId) => reopen(current, panelId, options),
      DEFAULT_WORKSPACE_LAYOUT
    )

    expectLayout(next, 'column(row([files] [editor] [git]) [terminal])')
    expect([...collectPanelIds(next.root)].sort()).toEqual(['editor', 'files', 'git', 'terminal'])
  })

  it('すべて閉じてから1枚ずつ戻すと、初期の配置が組み上がる', () => {
    const options = fixedIds()
    const empty = ALL_PANEL_IDS.reduce(closePanelInLayout, DEFAULT_WORKSPACE_LAYOUT)

    const next = ALL_PANEL_IDS.reduce(
      (current, panelId) => openPanelInLayout(current, panelId, DEFAULT_WORKSPACE_LAYOUT, options),
      empty
    )

    expectLayout(next, 'column(row([files] [editor] [git]) [terminal])')
    expect([...collectPanelIds(next.root)].sort()).toEqual(['editor', 'files', 'git', 'terminal'])
  })

  it('同じパネルを何度も開いても増えない', () => {
    const opened = openPanelInLayout(
      openPanelInLayout(DEFAULT_WORKSPACE_LAYOUT, 'files', DEFAULT_WORKSPACE_LAYOUT, fixedIds()),
      'files',
      DEFAULT_WORKSPACE_LAYOUT,
      fixedIds()
    )

    expectLayout(opened, 'column(row([files] [editor] [git]) [terminal])')
  })
})
