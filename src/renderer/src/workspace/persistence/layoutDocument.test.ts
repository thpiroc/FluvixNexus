import { describe, expect, it } from 'vitest'
import { WORKSPACE_LAYOUT_SCHEMA_VERSION, type WorkspaceLayoutDocument } from '@shared/workspace'
import { DEFAULT_WORKSPACE_LAYOUT } from '../layout/defaultLayout'
import { asDockNodeId } from '../layout/nodeId'
import { NO_PANEL_SEATS, placePanelAt } from '../layout/panelSeats'
import { closePanelInLayout } from '../layout/panelVisibility'
import { DEFAULT_LAYOUT_PRESET_ID } from '../layout/presets'
import { collectPanelIds, findLayoutProblems } from '../layout/tree'
import type { WorkspaceLayout } from '../layout/types'
import {
  deserializeWorkspaceLayout,
  isSameLayout,
  migrateStoredLayout,
  serializeWorkspaceLayout
} from './layoutDocument'

/**
 * 保存形式と実行時のレイアウトの相互変換。
 *
 * ここで確かめたいことは2つ。
 *   1. 保存 → 読み込みで配置が元通りになること（往復で情報が落ちない）
 *   2. **どんな内容を渡しても例外を投げず、失敗として返すこと**
 *
 * 2 が本題。保存ファイルは利用者が手で編集できる場所にあり、アプリの更新で
 * 形が変わることもある。壊れた入力で起動できなくなると、利用者には
 * 「アプリが壊れた」ようにしか見えず、直す手立てもない。
 */

/** 保存された文書を組み立てる（テストからは JSON を書く感覚で渡したい）。 */
function documentOf(
  layout: unknown,
  schemaVersion = WORKSPACE_LAYOUT_SCHEMA_VERSION
): WorkspaceLayoutDocument {
  return { schemaVersion, layout }
}

function storedDefault(): unknown {
  return serializeWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, DEFAULT_LAYOUT_PRESET_ID).layout
}

/** 保存形式の木を書き換える（壊れたファイルを作るため）。 */
function withRoot(patch: unknown): unknown {
  return { presetId: 'default', root: patch }
}

describe('serializeWorkspaceLayout', () => {
  it('今の schemaVersion と、プリセット id を添えて保存する', () => {
    const document = serializeWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, DEFAULT_LAYOUT_PRESET_ID)

    expect(document.schemaVersion).toBe(WORKSPACE_LAYOUT_SCHEMA_VERSION)
    expect(document.layout).toMatchObject({ presetId: DEFAULT_LAYOUT_PRESET_ID })
  })

  it('JSON として読み書きできる（関数や undefined を含まない）', () => {
    const document = serializeWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, DEFAULT_LAYOUT_PRESET_ID)

    expect(JSON.parse(JSON.stringify(document))).toEqual(document)
  })
})

describe('deserializeWorkspaceLayout', () => {
  it('保存 → 読み込みで配置が元に戻る', () => {
    const document = serializeWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, DEFAULT_LAYOUT_PRESET_ID)
    const result = deserializeWorkspaceLayout(document)

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    expect(result.layout).toEqual(DEFAULT_WORKSPACE_LAYOUT)
    expect(result.presetId).toBe(DEFAULT_LAYOUT_PRESET_ID)
  })

  it('タブの並び・activePanelId・size・split の向きが保たれる', () => {
    const layout: WorkspaceLayout = {
      root: {
        kind: 'split',
        id: asDockNodeId('root'),
        direction: 'row',
        size: null,
        children: [
          {
            kind: 'group',
            id: asDockNodeId('a'),
            panelIds: ['terminal', 'files'],
            activePanelId: 'files',
            size: 321
          },
          {
            kind: 'group',
            id: asDockNodeId('b'),
            panelIds: ['editor', 'git'],
            activePanelId: 'git',
            size: null
          }
        ]
      }
    }

    const result = deserializeWorkspaceLayout(
      serializeWorkspaceLayout(layout, DEFAULT_LAYOUT_PRESET_ID)
    )

    expect(result.ok && result.layout).toEqual(layout)
  })

  it('すべてのパネルを閉じた状態（空の領域）も復元できる', () => {
    const layout: WorkspaceLayout = {
      root: {
        kind: 'group',
        id: asDockNodeId('empty-root'),
        panelIds: [],
        activePanelId: null,
        size: null
      }
    }

    const result = deserializeWorkspaceLayout(
      serializeWorkspaceLayout(layout, DEFAULT_LAYOUT_PRESET_ID)
    )

    expect(result.ok).toBe(true)
    expect(result.ok && collectPanelIds(result.layout.root)).toEqual([])
  })

  it('復元したレイアウトは必ず正規形になっている', () => {
    // 同じパネルが2箇所にあり、activePanelId が中身とずれ、空の領域も混ざった木。
    const document = documentOf(
      withRoot({
        kind: 'split',
        id: 'root',
        size: null,
        direction: 'row',
        children: [
          { kind: 'group', id: 'a', size: null, panelIds: ['files'], activePanelId: 'git' },
          { kind: 'group', id: 'b', size: null, panelIds: ['files'], activePanelId: 'files' },
          { kind: 'group', id: 'c', size: null, panelIds: [], activePanelId: null },
          { kind: 'group', id: 'd', size: null, panelIds: ['editor'], activePanelId: 'editor' }
        ]
      })
    )

    const result = deserializeWorkspaceLayout(document)

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    expect(findLayoutProblems(result.layout)).toEqual([])
    expect(collectPanelIds(result.layout.root)).toEqual(['files', 'editor'])
  })

  it('子が1つの split は畳み、大きさを子へ引き継ぐ', () => {
    const document = documentOf(
      withRoot({
        kind: 'split',
        id: 'outer',
        size: 220,
        direction: 'column',
        children: [
          { kind: 'group', id: 'only', size: null, panelIds: ['git'], activePanelId: 'git' }
        ]
      })
    )

    const result = deserializeWorkspaceLayout(document)

    expect(result.ok && result.layout.root).toMatchObject({ kind: 'group', id: 'only', size: 220 })
  })

  it('知らない presetId は Default として扱い、配置は捨てない', () => {
    const document = documentOf({
      presetId: 'no-such-preset',
      root: (storedDefault() as { root: unknown }).root
    })
    const result = deserializeWorkspaceLayout(document)

    expect(result.ok).toBe(true)
    expect(result.ok && result.presetId).toBe(DEFAULT_LAYOUT_PRESET_ID)
    expect(result.ok && collectPanelIds(result.layout.root)).toEqual(
      collectPanelIds(DEFAULT_WORKSPACE_LAYOUT.root)
    )
  })

  it.each([
    ['layout がオブジェクトでない', 'broken'],
    ['root が無い', { presetId: 'default' }],
    ['root がオブジェクトでない', withRoot(42)],
    ['知らない kind', withRoot({ kind: 'window', id: 'a', size: null })],
    [
      '知らない PanelId',
      withRoot({
        kind: 'group',
        id: 'a',
        size: null,
        panelIds: ['files', 'unknown'],
        activePanelId: 'files'
      })
    ],
    [
      '知らない activePanelId',
      withRoot({
        kind: 'group',
        id: 'a',
        size: null,
        panelIds: ['files'],
        activePanelId: 'unknown'
      })
    ],
    [
      'panelIds が配列でない',
      withRoot({ kind: 'group', id: 'a', size: null, panelIds: 'files', activePanelId: 'files' })
    ],
    [
      'size が負の数',
      withRoot({ kind: 'group', id: 'a', size: -10, panelIds: ['files'], activePanelId: 'files' })
    ],
    [
      'size が数でも null でもない',
      withRoot({ kind: 'group', id: 'a', size: '240', panelIds: ['files'], activePanelId: 'files' })
    ],
    [
      'ノード id が文字列でない',
      withRoot({ kind: 'group', id: 7, size: null, panelIds: ['files'], activePanelId: 'files' })
    ],
    [
      '知らない direction',
      withRoot({
        kind: 'split',
        id: 'a',
        size: null,
        direction: 'diagonal',
        children: [
          { kind: 'group', id: 'b', size: null, panelIds: ['files'], activePanelId: 'files' },
          { kind: 'group', id: 'c', size: null, panelIds: ['editor'], activePanelId: 'editor' }
        ]
      })
    ],
    [
      'children が配列でない',
      withRoot({ kind: 'split', id: 'a', size: null, direction: 'row', children: {} })
    ],
    [
      'children が空',
      withRoot({ kind: 'split', id: 'a', size: null, direction: 'row', children: [] })
    ],
    [
      '子のどれかが壊れている',
      withRoot({
        kind: 'split',
        id: 'a',
        size: null,
        direction: 'row',
        children: [
          { kind: 'group', id: 'b', size: null, panelIds: ['files'], activePanelId: 'files' },
          null
        ]
      })
    ]
  ])('%s 場合は失敗として返す（例外は投げない）', (_name, layout) => {
    const result = deserializeWorkspaceLayout(documentOf(layout))

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason.length).toBeGreaterThan(0)
  })
})

describe('migrateStoredLayout', () => {
  it('今のバージョンなら何もしない', () => {
    const layout = storedDefault()

    expect(migrateStoredLayout(documentOf(layout))).toEqual({ ok: true, layout })
  })

  it('移行手順が無い古いバージョンは失敗として返す', () => {
    const result = migrateStoredLayout(documentOf(storedDefault(), 0))

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('移行手順')
  })

  it('このアプリより新しいバージョンは失敗として返す（下げられないため）', () => {
    const result = migrateStoredLayout(
      documentOf(storedDefault(), WORKSPACE_LAYOUT_SCHEMA_VERSION + 1)
    )

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('新しい形式')
  })

  it('非対応バージョンは読み込み全体としても失敗する', () => {
    const result = deserializeWorkspaceLayout(
      documentOf(storedDefault(), WORKSPACE_LAYOUT_SCHEMA_VERSION + 1)
    )

    expect(result.ok).toBe(false)
  })
})

describe('isSameLayout', () => {
  it('同じ配置を組み立て直したものは同じとみなす', () => {
    const restored = deserializeWorkspaceLayout(
      serializeWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, DEFAULT_LAYOUT_PRESET_ID)
    )

    expect(restored.ok && isSameLayout(restored.layout, DEFAULT_WORKSPACE_LAYOUT)).toBe(true)
  })

  it('大きさが違えば別の配置とみなす（＝「変更あり」になる）', () => {
    const resized: WorkspaceLayout = {
      root: {
        ...DEFAULT_WORKSPACE_LAYOUT.root,
        size: 999
      }
    }

    expect(isSameLayout(resized, DEFAULT_WORKSPACE_LAYOUT)).toBe(false)
  })
})

describe('最後の席（panelSeats。Agent パネルのドックパネル化）', () => {
  const shown = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'right')
  const closed = closePanelInLayout(shown, 'agent')

  it('席が無ければ項目自体を書かない（これまでの保存ファイルと同じ内容）', () => {
    const document = serializeWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, DEFAULT_LAYOUT_PRESET_ID)

    expect(Object.keys(document.layout as object).sort()).toEqual(['presetId', 'root'])
    expect(
      serializeWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, DEFAULT_LAYOUT_PRESET_ID, NO_PANEL_SEATS)
    ).toEqual(document)
  })

  it('保存 → 読み込みで席が元通りになる（schemaVersion は上げていない）', () => {
    const document = JSON.parse(
      JSON.stringify(serializeWorkspaceLayout(closed, DEFAULT_LAYOUT_PRESET_ID, { agent: shown }))
    ) as WorkspaceLayoutDocument
    const result = deserializeWorkspaceLayout(document)

    expect(document.schemaVersion).toBe(WORKSPACE_LAYOUT_SCHEMA_VERSION)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.panelSeats.agent).toBeDefined()
    expect(isSameLayout(result.panelSeats.agent as WorkspaceLayout, shown)).toBe(true)
    expect(isSameLayout(result.layout, closed)).toBe(true)
  })

  it('席の無い古いファイルは「席が無い」として読める', () => {
    const result = deserializeWorkspaceLayout(documentOf(storedDefault()))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.panelSeats).toEqual({})
  })

  it('読めない席はその席だけを捨て、配置は残す', () => {
    const stored = serializeWorkspaceLayout(closed, DEFAULT_LAYOUT_PRESET_ID, {
      agent: shown
    }).layout as Record<string, unknown>
    const broken = [
      { ...stored, panelSeats: 'x' },
      { ...stored, panelSeats: { agent: { kind: 'nope' } } },
      { ...stored, panelSeats: { unknownPanel: (stored.panelSeats as { agent: unknown }).agent } },
      // そのパネル自身が入っていない木
      { ...stored, panelSeats: { agent: (stored as { root: unknown }).root } }
    ]

    for (const layout of broken) {
      const result = deserializeWorkspaceLayout(documentOf(layout))

      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(result.panelSeats.agent).toBeUndefined()
      expect(isSameLayout(result.layout, closed)).toBe(true)
    }
  })

  it('席の中の木のずれ（空の領域など）は配置と同じく整えて読む', () => {
    const stored = serializeWorkspaceLayout(closed, DEFAULT_LAYOUT_PRESET_ID, {
      agent: shown
    }).layout as { panelSeats: { agent: { children: unknown[] } } }
    const seat = stored.panelSeats.agent
    const withEmpty = {
      ...stored,
      panelSeats: {
        agent: {
          ...seat,
          children: [
            ...seat.children,
            { kind: 'group', id: 'empty', size: null, panelIds: [], activePanelId: null }
          ]
        }
      }
    }
    const result = deserializeWorkspaceLayout(documentOf(withEmpty))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.panelSeats.agent).toBeDefined()
    expect(findLayoutProblems(result.panelSeats.agent as WorkspaceLayout)).toEqual([])
    expect(collectPanelIds((result.panelSeats.agent as WorkspaceLayout).root)).toContain('agent')
  })
})

describe('保存形式の互換性（panelSeats を足した後）', () => {
  /** v1.0.0 〜 この変更の前のアプリが書いた、既定の配置の保存ファイル（そのままの文字列）。 */
  const LEGACY_DEFAULT_FILE = JSON.stringify({
    schemaVersion: 1,
    layout: {
      presetId: 'default',
      root: {
        kind: 'split',
        id: 'root',
        size: null,
        direction: 'column',
        children: [
          {
            kind: 'split',
            id: 'main-row',
            size: null,
            direction: 'row',
            children: [
              { kind: 'group', id: 'left', size: 240, panelIds: ['files'], activePanelId: 'files' },
              {
                kind: 'group',
                id: 'center',
                size: null,
                panelIds: ['editor'],
                activePanelId: 'editor'
              },
              { kind: 'group', id: 'right', size: 280, panelIds: ['git'], activePanelId: 'git' }
            ]
          },
          {
            kind: 'group',
            id: 'bottom',
            size: 220,
            panelIds: ['terminal'],
            activePanelId: 'terminal'
          }
        ]
      }
    }
  })

  it('既存の保存ファイル（panelSeats 無し）をそのまま読め、書き直しても同じ内容になる', () => {
    const document = JSON.parse(LEGACY_DEFAULT_FILE) as WorkspaceLayoutDocument
    const result = deserializeWorkspaceLayout(document)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(isSameLayout(result.layout, DEFAULT_WORKSPACE_LAYOUT)).toBe(true)
    expect(result.panelSeats).toEqual({})
    expect(
      JSON.stringify(serializeWorkspaceLayout(result.layout, result.presetId, result.panelSeats))
    ).toBe(LEGACY_DEFAULT_FILE)
  })

  it('Agent を表示したまま保存された既存のファイルも読める（席は無いが、表示中なので尋ねない）', () => {
    const shown = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'center')
    const document = JSON.parse(
      JSON.stringify(serializeWorkspaceLayout(shown, DEFAULT_LAYOUT_PRESET_ID))
    ) as WorkspaceLayoutDocument
    const result = deserializeWorkspaceLayout(document)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(collectPanelIds(result.layout.root)).toContain('agent')
    expect(result.panelSeats).toEqual({})
  })

  it('panelSeats がどんな値でも、レイアウト全体は壊れない', () => {
    const shown = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'right')
    const closed = closePanelInLayout(shown, 'agent')
    const stored = serializeWorkspaceLayout(closed, DEFAULT_LAYOUT_PRESET_ID, { agent: shown })
      .layout as { presetId: string; root: unknown; panelSeats: { agent: unknown } }
    const validSeat = stored.panelSeats.agent
    const seatGroup = (panelIds: unknown, size: unknown = null): unknown => ({
      kind: 'group',
      id: 'g',
      size,
      panelIds,
      activePanelId: null
    })
    const variants: readonly unknown[] = [
      null,
      42,
      'agent',
      true,
      [],
      [validSeat],
      {},
      { agent: null },
      { agent: 'x' },
      { agent: [] },
      { agent: {} },
      { agent: { kind: 'split', id: 's', size: null, direction: 'diagonal', children: [] } },
      { agent: { kind: 'split', id: 's', size: null, direction: 'row', children: 'x' } },
      { agent: seatGroup(['agent'], -1) },
      { agent: seatGroup(['agent'], 'wide') },
      { agent: seatGroup(['agent', 'unknown-panel']) },
      { agent: seatGroup('agent') },
      { agent: seatGroup(['files']) }
    ]

    for (const panelSeats of variants) {
      const result = deserializeWorkspaceLayout(documentOf({ ...stored, panelSeats }))

      expect(result.ok, JSON.stringify(panelSeats)).toBe(true)
      if (!result.ok) continue
      expect(isSameLayout(result.layout, closed), JSON.stringify(panelSeats)).toBe(true)
      expect(result.panelSeats.agent, JSON.stringify(panelSeats)).toBeUndefined()
    }
  })

  it('壊れた席が他の正しい席を巻き込まない', () => {
    const shown = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'right')
    const stored = serializeWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, DEFAULT_LAYOUT_PRESET_ID, {
      agent: shown
    }).layout as { panelSeats: Record<string, unknown> }
    const result = deserializeWorkspaceLayout(
      documentOf({ ...stored, panelSeats: { ...stored.panelSeats, 'unknown-panel': 42 } })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.panelSeats.agent).toBeDefined()
    expect(Object.keys(result.panelSeats)).toEqual(['agent'])
  })

  it('Agent 以外のパネルの席は読まない（他のパネルはプリセットから戻るまま）', () => {
    const stored = serializeWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, DEFAULT_LAYOUT_PRESET_ID)
      .layout as { root: unknown }
    const result = deserializeWorkspaceLayout(
      documentOf({ ...stored, panelSeats: { terminal: stored.root, files: stored.root } })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.panelSeats).toEqual({})
  })

  it('__proto__ などの特別なキーでも、席にもならず例外も出ない', () => {
    const stored = serializeWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, DEFAULT_LAYOUT_PRESET_ID)
      .layout as { root: unknown }
    const raw = JSON.parse(
      `{"schemaVersion":1,"layout":{"presetId":"default","root":${JSON.stringify(stored.root)},` +
        `"panelSeats":{"__proto__":{"agent":1},"constructor":${JSON.stringify(stored.root)}}}}`
    ) as WorkspaceLayoutDocument
    const result = deserializeWorkspaceLayout(raw)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.panelSeats)).toEqual([])
    expect(({} as Record<string, unknown>).agent).toBeUndefined()
  })

  it('panelSeats 以外の配置の壊れ方は、これまでどおり Default へ落ちる（扱いを変えていない）', () => {
    const result = deserializeWorkspaceLayout(
      documentOf({ presetId: 'default', root: { kind: 'nope' }, panelSeats: {} })
    )

    expect(result.ok).toBe(false)
  })
})
