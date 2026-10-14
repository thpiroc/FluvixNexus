/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceLayoutDocument } from '@shared/workspace'
import { NO_PANEL_SEATS, placePanelAt } from './layout/panelSeats'
import { closePanelInLayout } from './layout/panelVisibility'
import { DEFAULT_LAYOUT_PRESET_ID, getLayoutPreset } from './layout/presets'
import { collectPanelIds, findPanelLocation } from './layout/tree'
import { serializeWorkspaceLayout } from './persistence/layoutDocument'
import { useWorkspaceLayout, type WorkspaceLayoutController } from './useWorkspaceLayout'

/**
 * レイアウトの持ち主（useWorkspaceLayout）と、Agent の初回配置・最後の席。
 *
 *   - 初回か再表示かの判定が、レイアウトを変える**どの経路**の後でも正しいこと
 *     （閉じる・プリセットの適用・初期化）
 *   - 席が配置と一緒に保存され、起動時に戻ること
 *   - Agent 以外のパネルの開き方（プリセット基準）が変わっていないこと
 */

const workspaceApi = vi.hoisted(() => ({
  loadLayout: vi.fn(),
  saveLayout: vi.fn()
}))

vi.mock('../api/fluvix', () => ({ fluvix: { workspace: workspaceApi } }))

let container: HTMLDivElement
let root: Root
let controller: WorkspaceLayoutController

function Probe(): null {
  controller = useWorkspaceLayout()
  return null
}

async function mount(document: WorkspaceLayoutDocument | null = null): Promise<void> {
  workspaceApi.loadLayout.mockResolvedValue({ ok: true, data: { document } })
  await act(async () => {
    root.render(createElement(Probe))
  })
}

/** 間引きの待ちを進めて、保存された最後の文書を返す。 */
async function savedDocument(): Promise<WorkspaceLayoutDocument> {
  await act(async () => {
    vi.advanceTimersByTime(1000)
  })

  const calls = workspaceApi.saveLayout.mock.calls

  return (calls[calls.length - 1][0] as { document: WorkspaceLayoutDocument }).document
}

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  workspaceApi.saveLayout.mockResolvedValue({ ok: true, data: undefined })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('Agent の初回配置と再表示', () => {
  it('初回は choose、置いた後は visible、閉じた後は restore', async () => {
    await mount()

    expect(controller.panelShowMode('agent')).toBe('choose')

    act(() => controller.placePanel('agent', 'bottom'))
    expect(controller.panelShowMode('agent')).toBe('visible')
    expect(findPanelLocation(controller.layout.root, 'agent')?.group.size).toBe(240)

    act(() => controller.closePanel('agent'))
    expect(controller.panelShowMode('agent')).toBe('restore')

    act(() => controller.openPanel('agent'))
    expect(findPanelLocation(controller.layout.root, 'agent')?.group.size).toBe(240)
    expect(controller.layout.root.kind === 'split' && controller.layout.root.direction).toBe(
      'column'
    )
  })

  it('プリセットの切り替えで消えても、最後の席は残る', async () => {
    await mount()

    act(() => controller.placePanel('agent', 'left'))
    act(() => controller.applyPreset(DEFAULT_LAYOUT_PRESET_ID))
    expect(collectPanelIds(controller.layout.root)).not.toContain('agent')
    expect(controller.panelShowMode('agent')).toBe('restore')

    act(() => controller.openPanel('agent'))
    expect(collectPanelIds(controller.layout.root)[0]).toBe('agent')
  })

  it('レイアウトの初期化では最後の席も消え、次は改めて置き場所を尋ねる', async () => {
    await mount()

    act(() => controller.placePanel('agent', 'left'))
    act(() => controller.closePanel('agent'))
    expect(controller.panelShowMode('agent')).toBe('restore')

    act(() => controller.resetLayout())
    expect(controller.modified).toBe(false)
    expect(controller.panelShowMode('agent')).toBe('choose')
  })

  it('表示したまま初期化しても、Agent は消えて次は尋ねる', async () => {
    await mount()

    act(() => controller.placePanel('agent', 'right'))
    act(() => controller.resetLayout())

    expect(collectPanelIds(controller.layout.root)).not.toContain('agent')
    expect(controller.panelShowMode('agent')).toBe('choose')
  })

  it('初期化の後でも、閉じれば再び席を控える', async () => {
    await mount()

    act(() => controller.placePanel('agent', 'left'))
    act(() => controller.resetLayout())
    act(() => controller.placePanel('agent', 'bottom'))
    act(() => controller.closePanel('agent'))
    expect(controller.panelShowMode('agent')).toBe('restore')

    act(() => controller.openPanel('agent'))
    expect(findPanelLocation(controller.layout.root, 'agent')?.group.size).toBe(240)
  })

  it('Agent 以外のパネルは尋ねず、今までどおりプリセットの位置へ戻る', async () => {
    await mount()

    act(() => controller.closePanel('terminal'))
    expect(controller.panelShowMode('terminal')).toBe('restore')
    expect(controller.panelShowMode('debug')).toBe('restore')

    act(() => controller.openPanel('terminal'))

    // 画面下いっぱい・高さ 220px（プリセットの位置）。
    const root = controller.layout.root

    expect(root.kind === 'split' && root.direction).toBe('column')
    expect(root.kind === 'split' && collectPanelIds(root.children[1])).toEqual(['terminal'])
    expect(findPanelLocation(root, 'terminal')?.group.size).toBe(220)
  })
})

describe('保存と復元', () => {
  it('席は配置と一緒に保存される。席が無い間は項目が無い', async () => {
    await mount()

    act(() => controller.closePanel('git'))
    expect(Object.keys((await savedDocument()).layout as object).sort()).toEqual([
      'presetId',
      'root'
    ])

    act(() => controller.placePanel('agent', 'right'))
    act(() => controller.closePanel('agent'))

    const saved = (await savedDocument()).layout as { panelSeats?: Record<string, unknown> }

    expect(Object.keys(saved.panelSeats ?? {})).toEqual(['agent'])
  })

  it('初期化すると、保存ファイルからも席が消える（再起動後も尋ねる）', async () => {
    await mount()

    act(() => controller.placePanel('agent', 'right'))
    act(() => controller.closePanel('agent'))
    const before = (await savedDocument()).layout as { panelSeats?: Record<string, unknown> }
    expect(Object.keys(before.panelSeats ?? {})).toEqual(['agent'])

    act(() => controller.resetLayout())
    const after = await savedDocument()
    expect(Object.keys(after.layout as object).sort()).toEqual(['presetId', 'root'])

    act(() => root.unmount())
    root = createRoot(container)
    await mount(JSON.parse(JSON.stringify(after)) as WorkspaceLayoutDocument)
    expect(controller.panelShowMode('agent')).toBe('choose')
  })

  it('初期化できるか（resettable）: 配置の変更か、席が残っているとき', async () => {
    const preset = getLayoutPreset(DEFAULT_LAYOUT_PRESET_ID).createLayout()
    const shown = placePanelAt(preset, 'agent', 'right')
    const closed = closePanelInLayout(shown, 'agent')

    // 再起動後: 配置は Default と同じ形、席だけが残っている。
    await mount(
      JSON.parse(
        JSON.stringify(serializeWorkspaceLayout(closed, DEFAULT_LAYOUT_PRESET_ID, { agent: shown }))
      ) as WorkspaceLayoutDocument
    )
    expect(controller.modified).toBe(false)
    expect(controller.resettable).toBe(true)

    act(() => controller.resetLayout())
    expect(controller.modified).toBe(false)
    expect(controller.resettable).toBe(false)
    expect(controller.panelShowMode('agent')).toBe('choose')

    // 配置を変えれば、席が無くても初期化できる。
    act(() => controller.closePanel('git'))
    expect(controller.resettable).toBe(true)
  })

  it('Default のままで席も無い起動では、初期化できない', async () => {
    await mount()

    expect(controller.modified).toBe(false)
    expect(controller.resettable).toBe(false)
  })

  it('起動時に席も戻り、再表示は尋ねずに最後の配置へ戻る', async () => {
    const preset = getLayoutPreset(DEFAULT_LAYOUT_PRESET_ID).createLayout()
    const shown = placePanelAt(preset, 'agent', 'right')
    const closed = closePanelInLayout(shown, 'agent')

    await mount(
      JSON.parse(
        JSON.stringify(serializeWorkspaceLayout(closed, DEFAULT_LAYOUT_PRESET_ID, { agent: shown }))
      ) as WorkspaceLayoutDocument
    )

    expect(controller.restored).toBe(true)
    expect(controller.panelShowMode('agent')).toBe('restore')

    act(() => controller.openPanel('agent'))

    const root = controller.layout.root

    expect(root.kind === 'split' && root.direction).toBe('row')
    expect(root.kind === 'split' && collectPanelIds(root.children[1])).toEqual(['agent'])
    expect(findPanelLocation(root, 'agent')?.group.size).toBe(360)
  })

  it('Agent が表示されたまま保存されていれば、初回扱いにしない（以前からの利用者）', async () => {
    const preset = getLayoutPreset(DEFAULT_LAYOUT_PRESET_ID).createLayout()
    const shown = placePanelAt(preset, 'agent', 'center')

    await mount(serializeWorkspaceLayout(shown, DEFAULT_LAYOUT_PRESET_ID, NO_PANEL_SEATS))

    expect(controller.panelShowMode('agent')).toBe('visible')

    act(() => controller.closePanel('agent'))
    expect(controller.panelShowMode('agent')).toBe('restore')
  })
})
