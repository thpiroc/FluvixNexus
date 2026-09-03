/**
 * @vitest-environment jsdom
 */
import { act, createElement, useMemo, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { emptySettingsSections, type SettingsSections } from '@shared/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AUTO_SAVE_SETTINGS,
  normalizeAutoSaveSettings,
  type AutoSaveMode
} from '../editor/autoSave'
import { EditorContext } from '../editor/context'
import type { EditorController } from '../editor/useEditorSession'
import {
  DEFAULT_TERMINAL_DISPLAY_SETTINGS,
  type TerminalDisplaySettings
} from '../terminal/terminalSettings'
import { TerminalContext } from '../terminal/context'
import { TerminalSettingsMenu } from '../terminal/TerminalSettingsMenu'
import type { TerminalTabsController } from '../terminal/useTerminalTabs'
import { WorkspaceFolderContext, type WorkspaceFolderController } from '../workspaceFolder/context'
import { WorkspaceTopBar } from '../workspace/shell/WorkspaceTopBar'
import type { PanelId } from '../workspace/panels/types'
import { FilesViewProvider } from '../files/FilesViewProvider'
import { useFilesLayout } from '../files/useFilesLayout'
import { toFilesViewChoice } from '../files/filesSettings'
import { SettingsOverlay } from './SettingsOverlay'

const settingsStore = vi.hoisted(() => ({
  sections: {
    editor: {},
    files: {},
    terminal: {}
  } as SettingsSections,
  load: vi.fn(),
  saveSection: vi.fn()
}))

vi.mock('../api/fluvix', () => ({
  fluvix: {
    settings: {
      load: settingsStore.load,
      saveSection: settingsStore.saveSection
    }
  }
}))

function mockWorkspace(): WorkspaceFolderController {
  return {
    status: 'ready',
    workspace: {
      id: 'workspace',
      rootPath: 'D:\\DEV\\PROJECTS\\Fluvix Nexus',
      displayName: 'Fluvix Nexus',
      openedAt: 1,
      exists: true
    },
    unavailableRootPath: null,
    error: null,
    busy: false,
    openFolder: vi.fn(),
    closeWorkspace: vi.fn()
  }
}

function FilesToolbarProbe(): ReactElement {
  const layout = useFilesLayout()
  const choice = toFilesViewChoice(layout.preference)

  return createElement(
    'div',
    { 'data-testid': 'files-toolbar-probe' },
    createElement('span', { 'data-testid': 'files-toolbar-choice' }, choice),
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'files-toolbar-tree',
        onClick: () => layout.chooseMode('tree')
      },
      'Files toolbar tree'
    ),
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'files-toolbar-columns',
        onClick: () => layout.chooseMode('columns')
      },
      'Files toolbar columns'
    ),
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'files-toolbar-auto',
        onClick: layout.followPanelShape
      },
      'Files toolbar auto'
    )
  )
}

function SettingsDomHarness(): ReactElement {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [autoSave, setAutoSave] = useState(DEFAULT_AUTO_SAVE_SETTINGS)
  const [terminal, setTerminal] = useState<TerminalDisplaySettings>(
    DEFAULT_TERMINAL_DISPLAY_SETTINGS
  )

  const editorController = useMemo(
    () =>
      ({
        autoSave,
        setAutoSaveMode: (mode: AutoSaveMode) =>
          setAutoSave((previous) => normalizeAutoSaveSettings({ ...previous, mode })),
        setAutoSaveDelayMs: (delayMs: number) =>
          setAutoSave((previous) => normalizeAutoSaveSettings({ ...previous, delayMs }))
      }) as unknown as EditorController,
    [autoSave]
  )

  const terminalController = useMemo(
    () =>
      ({
        display: terminal,
        setFontSize: (fontSize: number) => setTerminal((previous) => ({ ...previous, fontSize })),
        setScrollback: (scrollback: number) =>
          setTerminal((previous) => ({ ...previous, scrollback }))
      }) as unknown as TerminalTabsController,
    [terminal]
  )

  const visiblePanelIds: ReadonlySet<PanelId> = new Set(['files', 'editor', 'terminal', 'git'])

  return createElement(
    WorkspaceFolderContext.Provider,
    { value: mockWorkspace() },
    createElement(
      EditorContext.Provider,
      { value: editorController },
      createElement(
        TerminalContext.Provider,
        { value: terminalController },
        createElement(
          FilesViewProvider,
          null,
          createElement(
            'div',
            null,
            createElement(WorkspaceTopBar, {
              visiblePanelIds,
              presetId: 'default',
              modified: false,
              onTogglePanel: vi.fn(),
              onApplyPreset: vi.fn(),
              onResetLayout: vi.fn(),
              settingsOpen,
              onOpenSettings: () => setSettingsOpen(true)
            }),
            createElement(FilesToolbarProbe),
            createElement(TerminalSettingsMenu, {
              display: terminal,
              onFontSizeChange: (fontSize) => setTerminal((previous) => ({ ...previous, fontSize }))
            }),
            createElement('span', { 'data-testid': 'editor-auto-save-mode' }, autoSave.mode),
            createElement('span', { 'data-testid': 'editor-auto-save-delay' }, autoSave.delayMs),
            createElement('span', { 'data-testid': 'terminal-font-size-value' }, terminal.fontSize),
            createElement(
              'span',
              { 'data-testid': 'terminal-scrollback-value' },
              terminal.scrollback
            ),
            settingsOpen &&
              createElement(SettingsOverlay, { onClose: () => setSettingsOpen(false) })
          )
        )
      )
    )
  )
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  settingsStore.sections = emptySettingsSections()
  settingsStore.load.mockResolvedValue({ ok: true, data: { sections: settingsStore.sections } })
  settingsStore.saveSection.mockResolvedValue({ ok: true, data: undefined })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

async function renderHarness(): Promise<void> {
  await act(async () => {
    root.render(createElement(SettingsDomHarness))
  })
}

function byTestId<T extends HTMLElement = HTMLElement>(testId: string): T {
  const element = container.querySelector<T>(`[data-testid="${testId}"]`)

  expect(element, testId).not.toBeNull()

  return element as T
}

async function click(testId: string): Promise<void> {
  await act(async () => {
    byTestId<HTMLButtonElement>(testId).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function selectValue(testId: string, value: string): Promise<void> {
  await act(async () => {
    const select = byTestId<HTMLSelectElement>(testId)
    setNativeValue(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function commitNumber(testId: string, value: string): Promise<void> {
  await act(async () => {
    const input = byTestId<HTMLInputElement>(testId)
    setNativeValue(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

  await act(async () => {
    byTestId<HTMLInputElement>(testId).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
  })
}

function setNativeValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype =
    element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')

  descriptor?.set?.call(element, value)
}

describe('SettingsOverlay DOM', () => {
  it('トップバーから開き、カテゴリを切り替え、閉じるボタンと Esc で閉じる', async () => {
    await renderHarness()

    expect(container.querySelector('[data-testid="settings"]')).toBeNull()

    await click('topbar-settings')
    expect(byTestId('settings').getAttribute('aria-modal')).toBe('false')
    expect(byTestId('topbar-settings').dataset.open).toBe('true')
    expect(container.querySelector('.fx-settings__content')?.getAttribute('data-category')).toBe(
      'editor'
    )

    await click('settings-category-files')
    expect(container.querySelector('.fx-settings__content')?.getAttribute('data-category')).toBe(
      'files'
    )

    await click('settings-category-terminal')
    expect(container.querySelector('.fx-settings__content')?.getAttribute('data-category')).toBe(
      'terminal'
    )

    await click('settings-close')
    expect(container.querySelector('[data-testid="settings"]')).toBeNull()

    await click('topbar-settings')
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('[data-testid="settings"]')).toBeNull()
  })

  it('各設定コントロールが既存 setter と同じ値へ接続される', async () => {
    await renderHarness()
    await click('topbar-settings')

    await selectValue('settings-editor-auto-save-mode', 'afterDelay')
    expect(byTestId('editor-auto-save-mode').textContent).toBe('afterDelay')

    await commitNumber('settings-editor-auto-save-delay', '2500')
    expect(byTestId('editor-auto-save-delay').textContent).toBe('2500')

    await click('settings-category-files')
    await click('settings-files-view-columns')
    expect(byTestId('files-toolbar-choice').textContent).toBe('columns')

    await click('files-toolbar-tree')
    expect(byTestId('files-toolbar-choice').textContent).toBe('tree')
    expect(byTestId('settings-files-view-tree').dataset.active).toBe('true')

    await click('settings-category-terminal')
    await commitNumber('settings-terminal-font-size', '18')
    expect(byTestId('terminal-font-size-value').textContent).toBe('18')

    await commitNumber('settings-terminal-scrollback', '12000')
    expect(byTestId('terminal-scrollback-value').textContent).toBe('12000')

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="ターミナルの設定"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await commitNumber('terminal-font-size', '11')
    expect(byTestId('terminal-font-size-value').textContent).toBe('11')
    expect(byTestId<HTMLInputElement>('settings-terminal-font-size').value).toBe('11')
  })
})
