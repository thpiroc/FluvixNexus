import { describe, expect, it } from 'vitest'
import type { PanelId } from '../panels/types'
import { DEFAULT_WORKSPACE_LAYOUT } from './defaultLayout'
import { asDockNodeId } from './nodeId'
import { movePanel, type DockOperationOptions } from './operations'
import {
  INITIAL_SIDE_SIZE,
  NO_PANEL_SEATS,
  PANEL_PLACEMENT_CHOICES,
  openPanelAtSeat,
  placePanelAt,
  rememberPanelSeats,
  resolvePanelShowMode,
  type PanelSeats
} from './panelSeats'
import { closePanelInLayout } from './panelVisibility'
import { resizeNode } from './resize'
import { collectPanelIds, findLayoutProblems, findPanelLocation } from './tree'
import type { DockNode, WorkspaceLayout } from './types'

/**
 * 利用者が置き場所を決めるパネル（Agent）の初回配置と最後の席。
 *
 *   1. 初回か・再表示かの判定（resolvePanelShowMode）
 *   2. 初回の5方向が、既存の Dock 操作で正しい場所に入ること（placePanelAt）
 *   3. 表示中 → 非表示 で席が控えられること（rememberPanelSeats）
 *   4. 再表示で最後の席へ、同じ大きさで戻ること（openPanelAtSeat）
 */

const USER_PLACED: readonly PanelId[] = ['agent']

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

function expectSound(layout: WorkspaceLayout): void {
  expect(findLayoutProblems(layout)).toEqual([])

  const panelIds = collectPanelIds(layout.root)
  expect(new Set(panelIds).size).toBe(panelIds.length)
}

function agentSize(layout: WorkspaceLayout): number | null {
  return findPanelLocation(layout.root, 'agent')?.group.size ?? null
}

/** 表示中 → 非表示 を1回通し、席を控えた結果を返す（Shell の流れと同じ）。 */
function close(layout: WorkspaceLayout, seats: PanelSeats): [WorkspaceLayout, PanelSeats] {
  const next = closePanelInLayout(layout, 'agent')

  return [next, rememberPanelSeats(seats, layout, next, USER_PLACED)]
}

describe('初回か・再表示かの判定', () => {
  it('表示中なら visible（前面に出すだけ）', () => {
    const layout = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'right', fixedIds())

    expect(resolvePanelShowMode(layout, NO_PANEL_SEATS, 'agent')).toBe('visible')
  })

  it('閉じていて席が無ければ choose（初回）', () => {
    expect(resolvePanelShowMode(DEFAULT_WORKSPACE_LAYOUT, NO_PANEL_SEATS, 'agent')).toBe('choose')
  })

  it('閉じていて席があれば restore（再表示）', () => {
    const shown = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'right', fixedIds())
    const [closed, seats] = close(shown, NO_PANEL_SEATS)

    expect(resolvePanelShowMode(closed, seats, 'agent')).toBe('restore')
  })

  it('席の相手が1枚も表示されていなければ、推測せず choose に戻る', () => {
    const shown = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'right', fixedIds())
    const [closed, seats] = close(shown, NO_PANEL_SEATS)
    const empty = (['files', 'editor', 'git', 'terminal'] as const).reduce(
      (layout, panelId) => closePanelInLayout(layout, panelId),
      closed
    )

    expect(resolvePanelShowMode(empty, seats, 'agent')).toBe('choose')
  })

  it('そのパネル自身が入っていない席は使わない', () => {
    const seats: PanelSeats = { agent: DEFAULT_WORKSPACE_LAYOUT }

    expect(resolvePanelShowMode(DEFAULT_WORKSPACE_LAYOUT, seats, 'agent')).toBe('choose')
  })
})

describe('初回の置き場所（5方向）', () => {
  it('選べるのは 左・右・上・下・中央 の5つ', () => {
    expect([...PANEL_PLACEMENT_CHOICES].sort()).toEqual(
      ['bottom', 'center', 'left', 'right', 'top'].sort()
    )
  })

  it('左: 画面全体の左端に、新しい領域として 360px で入る', () => {
    const layout = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'left', fixedIds())

    expect(shapeOf(layout.root)).toBe('row([agent] column(row([files] [editor] [git]) [terminal]))')
    expect(agentSize(layout)).toBe(INITIAL_SIDE_SIZE.left)
    expectSound(layout)
  })

  it('右: 画面全体の右端に、新しい領域として 360px で入る', () => {
    const layout = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'right', fixedIds())

    expect(shapeOf(layout.root)).toBe('row(column(row([files] [editor] [git]) [terminal]) [agent])')
    expect(agentSize(layout)).toBe(INITIAL_SIDE_SIZE.right)
    expectSound(layout)
  })

  it('上: 画面全体の上端に、新しい領域として 240px で入る', () => {
    const layout = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'top', fixedIds())

    expect(shapeOf(layout.root)).toBe('column([agent] row([files] [editor] [git]) [terminal])')
    expect(agentSize(layout)).toBe(INITIAL_SIDE_SIZE.top)
    expectSound(layout)
  })

  it('下: 画面全体の下端（Terminal のさらに下）に、240px で入る', () => {
    const layout = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'bottom', fixedIds())

    expect(shapeOf(layout.root)).toBe('column(row([files] [editor] [git]) [terminal] [agent])')
    expect(agentSize(layout)).toBe(INITIAL_SIDE_SIZE.bottom)
    expectSound(layout)
  })

  it('中央: Editor の領域へタブとして加わり、手前に出る', () => {
    const layout = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'center', fixedIds())

    expect(shapeOf(layout.root)).toBe('column(row([files] [editor,agent] [git]) [terminal])')
    expect(findPanelLocation(layout.root, 'agent')?.group.activePanelId).toBe('agent')
    expectSound(layout)
  })

  it('中央: Editor が無ければ、残りを埋める領域へタブとして加わる', () => {
    // Editor を Git の領域へ移してから閉じる → Git の領域が「残りを埋める」側になる。
    const git = findPanelLocation(DEFAULT_WORKSPACE_LAYOUT.root, 'git')?.group.id
    const options = fixedIds()
    const merged = movePanel(
      DEFAULT_WORKSPACE_LAYOUT,
      'git',
      { kind: 'tab', groupId: asDockNodeId('center') },
      options
    )
    const noEditor = closePanelInLayout(merged, 'editor')
    const layout = placePanelAt(noEditor, 'agent', 'center', options)

    expect(git).toBeDefined()
    expect(findPanelLocation(layout.root, 'agent')?.group.panelIds).toEqual(['git', 'agent'])
    expect(findPanelLocation(layout.root, 'agent')?.group.size).toBeNull()
    expectSound(layout)
  })

  it('中央: 残りを埋める領域も無ければ、先頭の領域へタブとして加わる', () => {
    const noEditor = closePanelInLayout(DEFAULT_WORKSPACE_LAYOUT, 'editor')
    const layout = placePanelAt(noEditor, 'agent', 'center', fixedIds())

    expect(findPanelLocation(layout.root, 'agent')?.group.panelIds).toEqual(['files', 'agent'])
    expectSound(layout)
  })

  it('パネルが1枚も無ければ、どれを選んでも空の領域へ入る', () => {
    const empty = (['files', 'editor', 'git', 'terminal'] as const).reduce(
      (layout, panelId) => closePanelInLayout(layout, panelId),
      DEFAULT_WORKSPACE_LAYOUT
    )

    for (const choice of PANEL_PLACEMENT_CHOICES) {
      const layout = placePanelAt(empty, 'agent', choice, fixedIds())

      expect(shapeOf(layout.root)).toBe('[agent]')
      expectSound(layout)
    }
  })

  it('他のパネルは動かず、増えも減りもしない', () => {
    for (const choice of PANEL_PLACEMENT_CHOICES) {
      const layout = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', choice, fixedIds())

      expect([...collectPanelIds(layout.root)].sort()).toEqual(
        ['agent', 'editor', 'files', 'git', 'terminal'].sort()
      )
      expect(findPanelLocation(layout.root, 'files')?.group.size).toBe(240)
      expect(findPanelLocation(layout.root, 'terminal')?.group.size).toBe(220)
    }
  })
})

describe('最後の席を控える', () => {
  it('表示中 → 非表示 の瞬間に、消える直前のレイアウトを控える', () => {
    const shown = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'left', fixedIds())
    const [, seats] = close(shown, NO_PANEL_SEATS)

    expect(seats.agent).toBe(shown)
  })

  it('対象外のパネルが消えても、何も控えない（参照も変えない）', () => {
    const shown = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'left', fixedIds())
    const next = closePanelInLayout(shown, 'git')

    expect(rememberPanelSeats(NO_PANEL_SEATS, shown, next, USER_PLACED)).toBe(NO_PANEL_SEATS)
  })

  it('移動・リサイズ・閉じたままの変化では席を書き換えない', () => {
    const shown = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'left', fixedIds())
    const [closed, seats] = close(shown, NO_PANEL_SEATS)
    const moved = closePanelInLayout(closed, 'git')

    expect(rememberPanelSeats(seats, closed, moved, USER_PLACED)).toBe(seats)
  })

  it('プリセットの適用・初期化のように木ごと差し替わっても控える', () => {
    const shown = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'right', fixedIds())

    expect(
      rememberPanelSeats(NO_PANEL_SEATS, shown, DEFAULT_WORKSPACE_LAYOUT, USER_PLACED).agent
    ).toBe(shown)
  })
})

describe('最後の席へ戻す（再表示）', () => {
  it.each(PANEL_PLACEMENT_CHOICES)('%s に出して閉じ、また出すと同じ場所へ戻る', (choice) => {
    const options = fixedIds()
    const shown = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', choice, options)
    const [closed, seats] = close(shown, NO_PANEL_SEATS)
    const seat = seats.agent

    expect(seat).toBeDefined()

    const reopened = openPanelAtSeat(closed, seat as WorkspaceLayout, 'agent', options)

    expect(shapeOf(reopened.root)).toBe(shapeOf(shown.root))
    expect(agentSize(reopened)).toBe(agentSize(shown))
    expectSound(reopened)
  })

  it('ドラッグで移した先・変えた大きさが、次の席になる', () => {
    const options = fixedIds()
    const shown = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'right', options)
    // Files の下へドラッグし、高さを 300px に変えた。
    const filesGroup = findPanelLocation(shown.root, 'files')?.group.id
    const dragged = movePanel(
      shown,
      'agent',
      { kind: 'split', groupId: filesGroup ?? asDockNodeId('left'), side: 'bottom' },
      options
    )
    const resized = resizeNode(
      dragged,
      findPanelLocation(dragged.root, 'agent')?.group.id ?? asDockNodeId('none'),
      300
    )
    const [closed, seats] = close(resized, NO_PANEL_SEATS)
    const reopened = openPanelAtSeat(closed, seats.agent as WorkspaceLayout, 'agent', options)

    expect(shapeOf(reopened.root)).toBe(shapeOf(resized.root))
    expect(agentSize(reopened)).toBe(300)
    expectSound(reopened)
  })

  it('タブとして統合していた場合は、同じ領域のタブへ戻る', () => {
    const options = fixedIds()
    const shown = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'center', options)
    const [closed, seats] = close(shown, NO_PANEL_SEATS)
    const reopened = openPanelAtSeat(closed, seats.agent as WorkspaceLayout, 'agent', options)

    expect(findPanelLocation(reopened.root, 'agent')?.group.panelIds).toEqual(['editor', 'agent'])
    expectSound(reopened)
  })

  it('閉じている間に他のパネルが動いても、席の相手の隣へ戻る', () => {
    const options = fixedIds()
    const shown = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'center', options)
    const [closed, seats] = close(shown, NO_PANEL_SEATS)
    // Editor を Terminal の領域へタブとして移した。
    const terminal = findPanelLocation(closed.root, 'terminal')?.group.id ?? asDockNodeId('none')
    const rearranged = movePanel(closed, 'editor', { kind: 'tab', groupId: terminal }, options)
    const reopened = openPanelAtSeat(rearranged, seats.agent as WorkspaceLayout, 'agent', options)

    expect(findPanelLocation(reopened.root, 'agent')?.group.id).toBe(terminal)
    expectSound(reopened)
  })
})
