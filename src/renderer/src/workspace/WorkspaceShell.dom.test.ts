/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentTaskState } from '@shared/agent'
import type { WorkspaceLayoutDocument } from '@shared/workspace'
import { AgentTaskProvider } from '../agentTask/AgentTaskProvider'
import type { CommandId } from '../commands/commandIds'
import { CommandContext, type CommandRegistryController } from '../commands/context'
import type { CommandHandler } from '../commands/types'
import { I18nContext } from '../i18n/context'
import { createTranslator } from '../i18n/messages'
import { KeybindingContext, type KeybindingController } from '../keybindings/context'
import { WorkspaceFolderContext, type WorkspaceFolderController } from '../workspaceFolder/context'
import { DEFAULT_WORKSPACE_LAYOUT } from './layout/defaultLayout'
import { placePanelAt } from './layout/panelSeats'
import { closePanelInLayout } from './layout/panelVisibility'
import { DEFAULT_LAYOUT_PRESET_ID } from './layout/presets'
import { serializeWorkspaceLayout } from './persistence/layoutDocument'
import { WorkspaceShell } from './WorkspaceShell'

/**
 * Workspace Shell を通した Agent パネルの導線（Agent パネルのドックパネル化）。
 *
 *   View メニュー / コマンド / ステータスバー → 置き場所の選択 → 表示 → 非表示 → 再表示
 *   レイアウトの初期化ボタン（配置が Default と同じでも、席が残っていれば押せる）
 *
 * パネルの中身は Agent 以外を小さな印に差し替える（Monaco・xterm を jsdom で動かさないため）。
 * Agent は本物の AgentTaskView を使い、下書きが再表示をまたいで残ることも見る。
 */

const api = vi.hoisted(() => ({
  agentTask: {
    start: vi.fn(),
    stop: vi.fn(),
    continueTask: vi.fn(),
    getState: vi.fn(),
    onStateChanged: vi.fn()
  },
  workspace: { loadLayout: vi.fn(), saveLayout: vi.fn() },
  system: { getAppInfo: vi.fn() }
}))

vi.mock('../api/fluvix', () => ({
  fluvix: {
    ...api,
    env: { platform: 'win32', versions: { electron: '0', chrome: '0', node: '0' } }
  }
}))

vi.mock('./panels/registry', async () => {
  const { createElement: h } = await import('react')
  const { AgentTaskView } = await import('../agentTask/AgentTaskView')
  const stub = (id: string) => () => h('div', { 'data-testid': `panel-${id}` })
  const definitions = {
    files: {
      id: 'files',
      title: 'Files',
      accent: 'blue',
      placement: 'preset',
      Component: stub('files')
    },
    editor: {
      id: 'editor',
      title: 'Editor',
      accent: 'neutral',
      placement: 'preset',
      Component: stub('editor')
    },
    terminal: {
      id: 'terminal',
      title: 'Terminal',
      accent: 'green',
      placement: 'preset',
      Component: stub('terminal')
    },
    git: { id: 'git', title: 'Git', accent: 'orange', placement: 'preset', Component: stub('git') },
    debug: {
      id: 'debug',
      title: 'Debug',
      accent: 'neutral',
      placement: 'preset',
      Component: stub('debug')
    },
    agent: {
      id: 'agent',
      title: 'Agent',
      accent: 'neutral',
      placement: 'user',
      Component: AgentTaskView
    }
  } as const
  const isPanelId = (value: string): boolean => Object.hasOwn(definitions, value)

  return {
    getPanelDefinition: (id: keyof typeof definitions) => definitions[id],
    isPanelId,
    isUserPlacedPanelId: (value: string) =>
      isPanelId(value) && definitions[value as keyof typeof definitions].placement === 'user',
    listPanelDefinitions: () => Object.values(definitions)
  }
})

vi.mock('../settings/SettingsOverlay', () => ({ SettingsOverlay: () => null }))
vi.mock('../feedback/FeedbackOverlay', () => ({ FeedbackOverlay: () => null }))
vi.mock('../feedback/feedbackSender', () => ({ ipcFeedbackSender: {} }))
vi.mock('../debug/DebugStatusItem', () => ({ DebugStatusItem: () => null }))
vi.mock('../lsp/LanguageServerStatusItem', () => ({ LanguageServerStatusItem: () => null }))

const IDLE: AgentTaskState = {
  status: 'idle',
  phase: null,
  subject: null,
  loopsUsed: 0,
  loopLimit: 20,
  finalAnswer: null,
  endReason: null,
  agentEnabled: true,
  providerAvailable: true
}

let container: HTMLDivElement
let root: Root
let emit: ((state: AgentTaskState) => void) | null
let handlers: Map<CommandId, CommandHandler>

function commands(): CommandRegistryController {
  return {
    register: (id, handler) => {
      handlers.set(id, handler)
      return () => handlers.delete(id)
    },
    execute: (id) => {
      const handler = handlers.get(id)
      handler?.()
      return handler !== undefined
    },
    isRegistered: (id) => handlers.has(id)
  } as CommandRegistryController
}

const keybindings = {
  entries: [],
  setFlag: () => () => {},
  userKeybindings: { status: 'loading' },
  saveUserKeybindings: async () => false
} as unknown as KeybindingController

const workspaceFolder: WorkspaceFolderController = {
  status: 'ready',
  workspace: null,
  unavailableRootPath: null,
  error: null,
  busy: false,
  openFolder: vi.fn(),
  closeWorkspace: vi.fn()
}

function harness(): ReactElement {
  const registry = commands()

  return createElement(
    I18nContext.Provider,
    { value: { language: 'ja', setLanguage: () => {}, t: createTranslator('ja') } },
    createElement(
      CommandContext.Provider,
      { value: registry },
      createElement(
        WorkspaceFolderContext.Provider,
        { value: workspaceFolder },
        createElement(
          AgentTaskProvider,
          null,
          createElement(
            KeybindingContext.Provider,
            { value: keybindings },
            createElement(WorkspaceShell)
          )
        )
      )
    )
  )
}

async function mount(document: WorkspaceLayoutDocument | null = null): Promise<void> {
  api.workspace.loadLayout.mockResolvedValue({ ok: true, data: { document } })
  await act(async () => {
    root.render(harness())
  })
  await act(async () => {
    await Promise.resolve()
  })
}

const q = (selector: string): HTMLElement | null => container.querySelector(selector)
const byTestId = (id: string): HTMLElement | null => q(`[data-testid="${id}"]`)
const agentTab = (): HTMLElement | null => q('.fx-panel-tab[data-panel="agent"]')
const chooser = (): HTMLElement | null => byTestId('panel-placement-chooser')

function click(element: HTMLElement | null): void {
  expect(element).not.toBeNull()
  act(() => (element as HTMLElement).click())
}

function openViewMenuItem(label: string): void {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent === 'View'
  )
  click(button ?? null)
  const item = [...container.querySelectorAll<HTMLElement>('.fx-menu__item')].find(
    (candidate) => candidate.querySelector('.fx-menu__label')?.textContent === label
  )
  click(item ?? null)
}

function tabsWithAgent(): string[] {
  const group = agentTab()?.closest('.fx-panel-group')
  return [...(group?.querySelectorAll<HTMLElement>('.fx-panel-tab') ?? [])].map(
    (tab) => tab.dataset.panel ?? ''
  )
}

function type(text: string): void {
  const textarea = byTestId('agent-task-prompt') as HTMLTextAreaElement
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set

  act(() => {
    setter?.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function push(state: Partial<AgentTaskState>): void {
  act(() => emit?.({ ...IDLE, ...state }))
}

const resetButton = (): HTMLButtonElement => byTestId('workspace-reset-layout') as HTMLButtonElement

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  emit = null
  handlers = new Map()

  api.agentTask.onStateChanged.mockImplementation((listener) => {
    emit = listener
    return () => {}
  })
  api.agentTask.getState.mockResolvedValue({ ok: true, data: IDLE })
  api.workspace.saveLayout.mockResolvedValue({ ok: true, data: undefined })
  api.system.getAppInfo.mockResolvedValue({
    ok: true,
    data: { name: 'Fluvix Nexus', version: '0' }
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('View メニューからの導線', () => {
  it('初回は置き場所を尋ね、選んだ場所に出て、閉じて出し直すと尋ねずに同じ場所へ戻る', async () => {
    await mount()
    expect(agentTab()).toBeNull()

    openViewMenuItem('Agent')
    expect(chooser()).not.toBeNull()
    expect(chooser()?.textContent).toContain('Agent をどこに表示しますか')

    click(byTestId('panel-placement-center'))
    expect(chooser()).toBeNull()
    expect(tabsWithAgent()).toEqual(['editor', 'agent'])
    expect(agentTab()?.dataset.active).toBe('true')

    type('書きかけの指示')
    click(q('.fx-panel-tab[data-panel="agent"] .fx-panel-tab__close'))
    expect(agentTab()).toBeNull()

    openViewMenuItem('Agent')
    expect(chooser()).toBeNull()
    expect(tabsWithAgent()).toEqual(['editor', 'agent'])
    expect((byTestId('agent-task-prompt') as HTMLTextAreaElement).value).toBe('書きかけの指示')
  })

  it('View メニューのチェックで非表示にでき、出し直しても尋ねない', async () => {
    await mount()

    openViewMenuItem('Agent')
    click(byTestId('panel-placement-right'))
    const split = q('.fx-workspace__main > .fx-dock-split')
    expect(split?.dataset.direction).toBe('row')
    expect(split?.lastElementChild?.querySelector('[data-panel="agent"]')).not.toBeNull()

    openViewMenuItem('Agent')
    expect(agentTab()).toBeNull()

    openViewMenuItem('Agent')
    expect(chooser()).toBeNull()
    expect(
      q('.fx-workspace__main > .fx-dock-split')?.lastElementChild?.querySelector(
        '[data-panel="agent"]'
      )
    ).not.toBeNull()
  })

  it('取り消すと閉じたまま、Esc でも閉じたまま', async () => {
    await mount()

    openViewMenuItem('Agent')
    click(byTestId('panel-placement-cancel'))
    expect(chooser()).toBeNull()
    expect(agentTab()).toBeNull()

    openViewMenuItem('Agent')
    act(() => {
      byTestId('panel-placement-right')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
    })
    expect(chooser()).toBeNull()
    expect(agentTab()).toBeNull()
  })
})

describe('コマンドからの導線', () => {
  it('view.togglePanel.agent は View メニューと同じ判断をする', async () => {
    await mount()

    act(() => {
      handlers.get('view.togglePanel.agent')?.()
    })
    expect(chooser()).not.toBeNull()
    click(byTestId('panel-placement-bottom'))
    expect(agentTab()).not.toBeNull()

    act(() => {
      handlers.get('view.togglePanel.agent')?.()
    })
    expect(agentTab()).toBeNull()

    act(() => {
      handlers.get('view.togglePanel.agent')?.()
    })
    expect(chooser()).toBeNull()
    expect(agentTab()).not.toBeNull()
  })
})

describe('ステータスバーからの導線', () => {
  it('席が無ければ、押したときに置き場所を尋ねる（出ているだけでは何もしない）', async () => {
    await mount()

    push({ status: 'running', phase: 'reading' })
    expect(byTestId('statusbar-agent')?.textContent).toBe('Agent: 動作中')
    expect(chooser()).toBeNull()
    expect(agentTab()).toBeNull()

    click(byTestId('statusbar-agent'))
    expect(chooser()).not.toBeNull()
    click(byTestId('panel-placement-left'))
    expect(agentTab()).not.toBeNull()
    expect(api.agentTask.stop).not.toHaveBeenCalled()
  })

  it('確認待ちで隠れていても勝手に開かず、押すと最後の席へ戻って質問が見える', async () => {
    await mount()

    openViewMenuItem('Agent')
    click(byTestId('panel-placement-right'))
    click(q('.fx-panel-tab[data-panel="agent"] .fx-panel-tab__close'))

    push({ status: 'awaiting-continue', loopsUsed: 20, loopLimit: 20 })
    expect(byTestId('statusbar-agent')?.textContent).toBe('Agent: 確認待ち')
    expect(agentTab()).toBeNull()

    click(byTestId('statusbar-agent'))
    expect(chooser()).toBeNull()
    expect(
      q('.fx-workspace__main > .fx-dock-split')?.lastElementChild?.querySelector(
        '[data-panel="agent"]'
      )
    ).not.toBeNull()
    expect(byTestId('agent-task-limit')).not.toBeNull()
    expect(api.agentTask.continueTask).not.toHaveBeenCalled()
  })

  it('表示中で裏のタブなら、押すと前面に出る（配置は変わらない）', async () => {
    await mount()

    openViewMenuItem('Agent')
    click(byTestId('panel-placement-center'))
    click(q('.fx-panel-tab[data-panel="editor"] .fx-panel-tab__label'))
    expect(agentTab()?.dataset.active).toBe('false')

    push({ status: 'running', phase: 'searching' })
    click(byTestId('statusbar-agent'))

    expect(agentTab()?.dataset.active).toBe('true')
    expect(tabsWithAgent()).toEqual(['editor', 'agent'])
  })
})

describe('レイアウトの初期化ボタン', () => {
  it('Default のままで席も無ければ押せない', async () => {
    await mount()

    expect(resetButton().disabled).toBe(true)
  })

  it('配置が Default と違えば押せる', async () => {
    await mount()

    openViewMenuItem('Agent')
    click(byTestId('panel-placement-right'))

    expect(resetButton().disabled).toBe(false)
  })

  it('再起動後、配置が Default と同じでも席が残っていれば押せ、初期化すると次は尋ねる', async () => {
    const shown = placePanelAt(DEFAULT_WORKSPACE_LAYOUT, 'agent', 'right')
    const closed = closePanelInLayout(shown, 'agent')
    // 閉じた後の配置は Default と同じ形（保存して再起動した状態）。
    await mount(
      JSON.parse(
        JSON.stringify(serializeWorkspaceLayout(closed, DEFAULT_LAYOUT_PRESET_ID, { agent: shown }))
      ) as WorkspaceLayoutDocument
    )

    // 「変更あり」は配置の話なので出ない。ボタンだけが押せる。
    expect(container.textContent).not.toContain('変更あり')
    expect(resetButton().disabled).toBe(false)

    click(resetButton())
    expect(resetButton().disabled).toBe(true)

    openViewMenuItem('Agent')
    expect(chooser()).not.toBeNull()
  })
})
