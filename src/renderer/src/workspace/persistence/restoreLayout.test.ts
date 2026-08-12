import { describe, expect, it } from 'vitest'
import { WORKSPACE_LAYOUT_SCHEMA_VERSION } from '@shared/workspace'
import { createDockNodeId } from '../layout/nodeId'
import { collectNodes } from '../layout/tree'
import { restoreWorkspaceLayout } from './restoreLayout'

/**
 * 復元したレイアウトの id が、その後の発番と衝突しないことの確認。
 *
 * 衝突しても復元直後は正常に見えるため、テストが無いと気づけない。
 * 表に出るのはドラッグやリサイズを始めたときで、しかも「別の領域が動く」という
 * 原因の分かりにくい形になる（探索はすべて id で行うため）。
 */
describe('restoreWorkspaceLayout', () => {
  function documentWithNodeIds(ids: readonly string[]): {
    schemaVersion: number
    layout: unknown
  } {
    return {
      schemaVersion: WORKSPACE_LAYOUT_SCHEMA_VERSION,
      layout: {
        presetId: 'default',
        root: {
          kind: 'split',
          id: ids[0],
          size: null,
          direction: 'row',
          children: [
            { kind: 'group', id: ids[1], size: null, panelIds: ['files'], activePanelId: 'files' },
            { kind: 'group', id: ids[2], size: null, panelIds: ['editor'], activePanelId: 'editor' }
          ]
        }
      }
    }
  }

  it('復元したレイアウトの id は、その後の発番で再利用されない', () => {
    const result = restoreWorkspaceLayout(documentWithNodeIds(['dock-40', 'dock-41', 'dock-42']))

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    const restoredIds = new Set(collectNodes(result.layout.root).map((node) => node.id))

    // 復元後に領域を分割していく状況を模す。
    for (let i = 0; i < 5; i++) {
      expect(restoredIds.has(createDockNodeId())).toBe(false)
    }
  })

  it('手書きの id（プリセット由来）は発番の対象外なので影響しない', () => {
    const before = createDockNodeId()
    const result = restoreWorkspaceLayout(documentWithNodeIds(['root', 'left', 'center']))

    expect(result.ok).toBe(true)
    // `dock-` で始まらない id はカウンタを動かさない（layout/nodeId.ts）。
    expect(Number.parseInt(createDockNodeId().slice(5), 10)).toBe(
      Number.parseInt(before.slice(5), 10) + 1
    )
  })

  it('復元に失敗した場合は何も予約しない', () => {
    const result = restoreWorkspaceLayout({
      schemaVersion: WORKSPACE_LAYOUT_SCHEMA_VERSION,
      layout: { presetId: 'default', root: { kind: 'group', id: 'dock-900', size: null } }
    })

    expect(result.ok).toBe(false)
    // 採用しない木の id を確保してしまうと、発番が無意味に飛ぶ。
    expect(Number.parseInt(createDockNodeId().slice(5), 10)).toBeLessThan(900)
  })
})
