/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nContext } from '../i18n/context'
import { createTranslator } from '../i18n/messages'
import { TerminalTabs } from './TerminalTabs'
import { DEFAULT_TERMINAL_DISPLAY_SETTINGS } from './terminalSettings'
import {
  openTab,
  createTerminalTabsState,
  updateTab,
  type TerminalTabsState
} from './terminalTabsModel'

/**
 * タブ列の AI CLI モードの入口（v1.1 S1）。
 *
 * 確かめるのは「手前のタブにだけ効く」「ON のタブに印が付く」「タブが無ければ押せない」。
 * 打鍵の読み替えそのものは terminalInputMode.test.ts。
 */

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(state: TerminalTabsState, onAiCliModeChange = vi.fn()): typeof onAiCliModeChange {
  const t = createTranslator('ja')

  act(() =>
    root.render(
      createElement(
        I18nContext.Provider,
        { value: { language: 'ja', setLanguage: () => {}, t } },
        createElement(TerminalTabs, {
          tabs: state.tabs,
          activeTabId: state.activeTabId,
          workspaceId: null,
          shells: [],
          canOpen: true,
          onActivate: () => {},
          onClose: () => {},
          closingTabId: null,
          onOpen: () => {},
          onShellMenuOpen: () => {},
          display: DEFAULT_TERMINAL_DISPLAY_SETTINGS,
          onFontSizeChange: () => {},
          onAiCliModeChange
        })
      )
    )
  )

  return onAiCliModeChange
}

function toggle(): HTMLButtonElement {
  return container.querySelector('[data-testid="terminal-ai-cli-toggle"]') as HTMLButtonElement
}

function twoTabs(): TerminalTabsState {
  return openTab(
    openTab(createTerminalTabsState(), 'default', 'PowerShell'),
    'default',
    'PowerShell'
  )
}

describe('TerminalTabs — AI CLI モード', () => {
  it('既定は OFF で、印は出ない', () => {
    render(twoTabs())

    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('[data-testid="terminal-tab-ai-cli-badge"]')).toBeNull()
  })

  it('押すと手前のタブを ON にする', () => {
    const onChange = render(twoTabs())

    act(() => toggle().click())

    expect(onChange).toHaveBeenCalledWith('terminal-2', true)
  })

  it('ON のタブを手前にして押すと OFF にする', () => {
    const state = updateTab(twoTabs(), 'terminal-2', { aiCliMode: true })
    const onChange = render(state)

    expect(toggle().getAttribute('aria-pressed')).toBe('true')

    act(() => toggle().click())

    expect(onChange).toHaveBeenCalledWith('terminal-2', false)
  })

  it('印は ON のタブにだけ付く（手前でなくても）', () => {
    const state = updateTab(twoTabs(), 'terminal-1', { aiCliMode: true })
    render(state)

    const badges = container.querySelectorAll('[data-testid="terminal-tab-ai-cli-badge"]')
    expect(badges).toHaveLength(1)
    expect(badges[0].closest('[data-terminal-id]')?.getAttribute('data-terminal-id')).toBe(
      'terminal-1'
    )
    // 手前（terminal-2）は OFF なので、入口は押されていない表示のまま。
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
  })

  it('タブが無ければ押せない', () => {
    render(createTerminalTabsState())

    expect(toggle().disabled).toBe(true)
  })
})
