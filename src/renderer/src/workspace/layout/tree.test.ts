import { describe, expect, it } from 'vitest'
import { asDockNodeId } from './nodeId'
import {
  collectGroups,
  collectPanelIds,
  findGroup,
  findLayoutProblems,
  findPanelLocation,
  layoutFromRoot,
  mapGroup,
  normalizeLayout,
  resolveActivePanelId
} from './tree'
import type { DockGroupNode, DockNode, DockSplitChildren, WorkspaceLayout } from './types'

/**
 * 木の探索・組み立て・正規化の検証。
 *
 * ここで守りたいのは「壊れたレイアウトを描画可能な形に直せる」こと。
 * レイアウトを永続化する以上、アプリの更新をまたいで古い値・不整合な値が入ってくる前提で扱う。
 */

function group(id: string, panelIds: DockGroupNode['panelIds'], size: number | null = null) {
  return {
    kind: 'group',
    id: asDockNodeId(id),
    panelIds,
    activePanelId: panelIds[0] ?? null,
    size
  } satisfies DockGroupNode
}

function split(
  id: string,
  direction: 'row' | 'column',
  children: readonly DockNode[],
  size: number | null = null
): DockNode {
  return {
    kind: 'split',
    id: asDockNodeId(id),
    direction,
    size,
    children: children as DockSplitChildren
  }
}

function layoutOf(root: DockNode): WorkspaceLayout {
  return { root }
}

describe('resolveActivePanelId', () => {
  it('activePanelId がその領域にあればそれを返す', () => {
    expect(resolveActivePanelId({ ...group('a', ['terminal', 'git']), activePanelId: 'git' })).toBe(
      'git'
    )
  })

  it('activePanelId がその領域に無い場合は先頭のパネルへ落とす', () => {
    expect(
      resolveActivePanelId({ ...group('a', ['terminal', 'git']), activePanelId: 'files' })
    ).toBe('terminal')
  })

  it('パネルが無い領域では null を返す', () => {
    expect(resolveActivePanelId({ ...group('a', []), activePanelId: 'files' })).toBeNull()
  })
})

describe('木の探索', () => {
  const root = split('root', 'column', [
    split('row', 'row', [group('left', ['files']), group('center', ['editor'])]),
    group('bottom', ['terminal', 'git'])
  ])

  it('group とパネルを画面の並び順で集める', () => {
    expect(collectGroups(root).map((node) => node.id)).toEqual(['left', 'center', 'bottom'])
    expect(collectPanelIds(root)).toEqual(['files', 'editor', 'terminal', 'git'])
  })

  it('id から group を引ける。split の id では引けない', () => {
    expect(findGroup(root, asDockNodeId('center'))?.panelIds).toEqual(['editor'])
    expect(findGroup(root, asDockNodeId('row'))).toBeNull()
  })

  it('パネルがどの領域の何番目にあるかを返す', () => {
    expect(findPanelLocation(root, 'git')).toEqual({
      group: expect.objectContaining({ id: 'bottom' }),
      index: 1
    })
    expect(findPanelLocation(group('a', []), 'files')).toBeNull()
  })
})

describe('mapGroup', () => {
  const root = split('root', 'row', [
    group('left', ['files'], 240),
    split(
      'center-col',
      'column',
      [group('editor', ['editor']), group('terminal', ['terminal'])],
      500
    )
  ])

  it('対象の group だけを置き換える', () => {
    const next = mapGroup(root, asDockNodeId('left'), (target) => ({
      ...target,
      panelIds: [...target.panelIds, 'git']
    }))

    expect(findGroup(next!, asDockNodeId('left'))?.panelIds).toEqual(['files', 'git'])
    expect(findGroup(next!, asDockNodeId('editor'))).toBe(findGroup(root, asDockNodeId('editor')))
  })

  it('該当が無ければ元のノードをそのまま返す', () => {
    expect(mapGroup(root, asDockNodeId('none'), () => null)).toBe(root)
  })

  it('空になった領域を取り除き、子が1つになった split を畳む', () => {
    const next = mapGroup(root, asDockNodeId('terminal'), () => null)

    // center-col は子が editor だけになるため畳まれ、editor が center-col の大きさを引き継ぐ。
    expect(findGroup(next!, asDockNodeId('terminal'))).toBeNull()
    expect(findGroup(next!, asDockNodeId('editor'))?.size).toBe(500)
    expect(findLayoutProblems(layoutOf(next!))).toEqual([])
  })

  it('最後の領域を取り除くと null になる', () => {
    const single = group('only', ['files'])

    expect(mapGroup(single, asDockNodeId('only'), () => null)).toBeNull()
    expect(layoutFromRoot(null).root.kind).toBe('group')
    expect(collectPanelIds(layoutFromRoot(null).root)).toEqual([])
  })
})

describe('normalizeLayout', () => {
  it('正規形のレイアウトは同じオブジェクトのまま返す', () => {
    const layout = layoutOf(
      split('root', 'row', [group('left', ['files']), group('center', ['editor'])])
    )

    expect(normalizeLayout(layout)).toBe(layout)
  })

  it('同じパネルが2箇所にある場合は先に現れた方だけを残す', () => {
    const layout = layoutOf(
      split('root', 'row', [group('left', ['files']), group('center', ['editor', 'files'])])
    )

    const next = normalizeLayout(layout)

    expect(collectPanelIds(next.root)).toEqual(['files', 'editor'])
    expect(findLayoutProblems(next)).toEqual([])
  })

  it('パネルが無い領域を取り除き、子が1つになった split を畳む', () => {
    const layout = layoutOf(
      split('root', 'row', [
        group('left', []),
        split('col', 'column', [group('center', ['editor']), group('ghost', [])], 300)
      ])
    )

    const next = normalizeLayout(layout)

    expect(next.root.kind).toBe('group')
    expect(next.root.id).toBe('center')
    // col（300px）が畳まれ、さらに root も畳まれるため、外側の大きさは root の size になる。
    expect(next.root.size).toBeNull()
  })

  it('その領域に無いパネルを指している activePanelId を直す', () => {
    const layout = layoutOf({ ...group('a', ['terminal', 'git']), activePanelId: 'files' })

    expect((normalizeLayout(layout).root as DockGroupNode).activePanelId).toBe('terminal')
  })

  it('同じ向きの split が入れ子になっていれば平坦化する', () => {
    const layout = layoutOf(
      split('root', 'row', [
        group('left', ['files'], 240),
        split('nested', 'row', [group('center', ['editor']), group('right', ['git'])])
      ])
    )

    const next = normalizeLayout(layout)

    expect(next.root.kind).toBe('split')
    expect(collectGroups(next.root).map((node) => node.id)).toEqual(['left', 'center', 'right'])
    expect(findLayoutProblems(next)).toEqual([])
  })

  it('サイズを持つ split は平坦化しない（箱の大きさが変わってしまうため）', () => {
    const layout = layoutOf(
      split('root', 'row', [
        group('left', ['files'], 240),
        split('nested', 'row', [group('center', ['editor']), group('right', ['git'])], 400)
      ])
    )

    expect(normalizeLayout(layout)).toBe(layout)
  })

  it('すべての領域が空なら空のレイアウトになる', () => {
    const layout = layoutOf(split('root', 'row', [group('a', []), group('b', [])]))

    const next = normalizeLayout(layout)

    expect(collectPanelIds(next.root)).toEqual([])
    expect(findLayoutProblems(next)).toEqual([])
  })
})

describe('findLayoutProblems', () => {
  it('正規形のレイアウトでは何も挙げない', () => {
    const layout = layoutOf(
      split('root', 'column', [
        split('row', 'row', [group('left', ['files'], 240), group('center', ['editor'])]),
        group('bottom', ['terminal'], 220)
      ])
    )

    expect(findLayoutProblems(layout)).toEqual([])
  })

  it('ノード id の重複を見つける', () => {
    const layout = layoutOf(
      split('root', 'row', [group('same', ['files']), group('same', ['editor'])])
    )

    expect(findLayoutProblems(layout)).toContain('ノード id が重複しています: same')
  })

  it('同じパネルが複数の領域にあることを見つける', () => {
    const layout = layoutOf(
      split('root', 'row', [group('a', ['files']), group('b', ['files', 'editor'])])
    )

    expect(findLayoutProblems(layout)).toContain('同じパネルが複数の領域にあります: files')
  })

  it('パネルが無い領域が root 以外に残っていることを見つける', () => {
    const layout = layoutOf(split('root', 'row', [group('a', ['files']), group('b', [])]))

    expect(findLayoutProblems(layout)).toContain('パネルが無い group が残っています: b')
  })

  it('空の root は不正としない', () => {
    expect(findLayoutProblems(layoutOf(group('root', [])))).toEqual([])
  })

  it('activePanelId のずれと不正な size を見つける', () => {
    const layout = layoutOf({ ...group('a', ['files'], 0), activePanelId: 'git' })

    expect(findLayoutProblems(layout)).toEqual([
      'size は正の数か null である必要があります: a = 0',
      'activePanelId がその group にありません: a = git'
    ])
  })
})
