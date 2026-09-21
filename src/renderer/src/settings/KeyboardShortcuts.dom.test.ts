/**
 * @vitest-environment jsdom
 */
import { act, createElement, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { emptySettingsSections } from '@shared/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../commands/CommandProvider'
import { COMMAND_IDS } from '../commands/commandIds'
import { useCommand } from '../commands/useCommand'
import { EditorContext } from '../editor/context'
import type { EditorController } from '../editor/useEditorSession'
import { LanguageProvider } from '../i18n/LanguageProvider'
import { KeybindingProvider } from '../keybindings/KeybindingProvider'
import { WorkspaceFolderContext, type WorkspaceFolderController } from '../workspaceFolder/context'
import { SettingsOverlay } from './SettingsOverlay'

/**
 * Settings の Keyboard Shortcuts 一覧（Session 4-7C）。
 *
 * 純粋層（`buildShortcutRows` / `filterShortcutRows` / 目録 / 翻訳）は
 * 素のテストで見てあるので、ここで見るのは **DOM が絡む所だけ**にする。
 *
 *   - Settings の中から開けること
 *   - command が**1つ残らず**、カテゴリごとに並ぶこと
 *   - 割り当てのある18件と、未割り当ての見え方
 *   - 絞り込み
 *   - ja / en の切り替えがその場で効くこと
 *   - **押しても command が走らないこと**（閲覧専用）
 */

const settingsStore = vi.hoisted(() => ({
  load: vi.fn(),
  saveSection: vi.fn(),
  updateStatus: {
    status: 'idle',
    currentVersion: '1.0.0',
    updateVersion: null,
    releaseName: null,
    releaseDate: null,
    message: null,
    lastCheckedAt: null,
    progress: null,
    source: {
      provider: 'github',
      owner: 'thpiroc',
      repo: 'FluvixNexus'
    }
  },
  getUpdateStatus: vi.fn(),
  checkUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
  onUpdateStatusChanged: vi.fn()
}))

vi.mock('../api/fluvix', () => ({
  fluvix: {
    settings: {
      load: settingsStore.load,
      saveSection: settingsStore.saveSection
    },
    updates: {
      getStatus: settingsStore.getUpdateStatus,
      check: settingsStore.checkUpdates,
      download: settingsStore.downloadUpdate,
      install: settingsStore.installUpdate,
      onStatusChanged: settingsStore.onUpdateStatusChanged
    }
  }
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  settingsStore.load.mockResolvedValue({ ok: true, data: { sections: emptySettingsSections() } })
  settingsStore.saveSection.mockResolvedValue({ ok: true, data: undefined })
  settingsStore.getUpdateStatus.mockResolvedValue({
    ok: true,
    data: settingsStore.updateStatus
  })
  settingsStore.checkUpdates.mockResolvedValue({
    ok: true,
    data: settingsStore.updateStatus
  })
  settingsStore.downloadUpdate.mockResolvedValue({
    ok: true,
    data: settingsStore.updateStatus
  })
  settingsStore.installUpdate.mockResolvedValue({ ok: true, data: undefined })
  settingsStore.onUpdateStatusChanged.mockReturnValue(() => {})
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.documentElement.removeAttribute('data-fx-language')
  document.documentElement.removeAttribute('lang')
  vi.clearAllMocks()
})

function mockWorkspace(): WorkspaceFolderController {
  return {
    status: 'ready',
    workspace: {
      id: 'w1',
      rootPath: 'D:\\project',
      displayName: 'project',
      exists: true,
      openedAt: 0
    },
    unavailableRootPath: null,
    error: null,
    busy: false,
    openFolder: vi.fn(),
    closeWorkspace: vi.fn()
  }
}

function mockEditor(): EditorController {
  return { activeTab: null } as unknown as EditorController
}

/**
 * 本物と同じ順に Provider を積む（App.tsx）。
 *
 * `executed` を渡すと、その command に handler が付いた状態になる ──
 * **一覧の行を押しても走らない**ことを確かめるために使う。
 */
function Harness({ executed }: { readonly executed?: () => void }): ReactElement {
  const [, force] = useState(0)

  return createElement(
    LanguageProvider,
    null,
    createElement(
      CommandProvider,
      null,
      createElement(
        WorkspaceFolderContext.Provider,
        { value: mockWorkspace() },
        createElement(
          EditorContext.Provider,
          { value: mockEditor() },
          createElement(
            KeybindingProvider,
            null,
            executed === undefined ? null : createElement(Owner, { handler: executed }),
            createElement(SettingsOverlay, { onClose: () => force((n) => n + 1) })
          )
        )
      )
    )
  )
}

function Owner({ handler }: { readonly handler: () => void }): null {
  useCommand('git.push', handler)

  return null
}

async function render(executed?: () => void): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness, { executed }))
  })
}

async function openKeyboard(): Promise<void> {
  await render()
  await click('settings-category-keyboard')
}

async function click(testId: string): Promise<void> {
  await act(async () => {
    byTestId(testId).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function type(value: string): Promise<void> {
  await act(async () => {
    const input = byTestId<HTMLInputElement>('settings-keyboard-search')
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')

    descriptor?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function byTestId<T extends HTMLElement = HTMLElement>(testId: string): T {
  const element = container.querySelector<T>(`[data-testid="${testId}"]`)

  expect(element, testId).not.toBeNull()

  return element as T
}

function rows(): readonly HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.fx-shortcuts__row')]
}

function groups(): readonly string[] {
  return [...container.querySelectorAll<HTMLElement>('.fx-shortcuts__group')].map(
    (group) => group.dataset.group ?? ''
  )
}

describe('Settings から開く', () => {
  it('カテゴリの一覧に Keyboard Shortcuts が並ぶ', async () => {
    await render()

    expect(byTestId('settings-category-keyboard').textContent).toBe('キーボードショートカット')
  })

  it('選ぶと一覧が出る', async () => {
    await render()
    expect(container.querySelector('[data-testid="settings-keyboard"]')).toBeNull()

    await click('settings-category-keyboard')
    expect(container.querySelector('.fx-settings__content')?.getAttribute('data-category')).toBe(
      'keyboard'
    )
    expect(byTestId('settings-keyboard')).not.toBeNull()
  })

  it('他のカテゴリへ戻れる（値の設定が壊れていない）', async () => {
    await openKeyboard()

    await click('settings-category-general')
    expect(container.querySelector('[data-testid="settings-keyboard"]')).toBeNull()
    expect(byTestId('settings-general-language')).not.toBeNull()
  })
})

describe('並ぶもの', () => {
  it('登録されている 40 件が1つ残らず出る', async () => {
    await openKeyboard()

    expect(rows()).toHaveLength(COMMAND_IDS.length)
    expect(rows()).toHaveLength(40)

    const shown = rows().map((row) => row.dataset.command)
    expect([...shown].sort()).toEqual([...COMMAND_IDS].sort())
  })

  it('カテゴリごとに、決めた順で畳まれる', async () => {
    await openKeyboard()

    expect(groups()).toEqual(['workspace', 'editor', 'view', 'settings', 'debug', 'git', 'files'])
  })

  it('割り当てのある18件が打鍵を出す', async () => {
    await openKeyboard()

    const assigned = rows().filter((row) => row.dataset.unassigned === 'false')

    expect(assigned).toHaveLength(18)
    expect(byTestId('settings-keyboard-row-editor.save').textContent).toContain('Ctrl+S')
    expect(byTestId('settings-keyboard-row-editor.saveAs').textContent).toContain('Ctrl+Shift+S')
    expect(byTestId('settings-keyboard-row-workspace.openFolder').textContent).toContain('Ctrl+O')
    expect(byTestId('settings-keyboard-row-settings.open').textContent).toContain('Ctrl+,')
    expect(byTestId('settings-keyboard-row-view.togglePanel.terminal').textContent).toContain(
      'Ctrl+J'
    )
  })

  /*
    Session 5-12 の5件は、一般的な IDE と同じ打鍵で一覧に出る
    （keybindings/defaults.ts）── 利用者が「F12 は何に割り当たっているか」を
    この画面から引けることが要点にあたる。
  */
  it('Language Server の操作が IDE 標準の打鍵で出る', async () => {
    await openKeyboard()

    expect(byTestId('settings-keyboard-row-editor.goToDefinition').textContent).toContain('F12')
    expect(byTestId('settings-keyboard-row-editor.findReferences').textContent).toContain(
      'Shift+F12'
    )
    expect(byTestId('settings-keyboard-row-editor.renameSymbol').textContent).toContain('F2')
    expect(byTestId('settings-keyboard-row-editor.formatDocument').textContent).toContain(
      'Shift+Alt+F'
    )
    expect(byTestId('settings-keyboard-row-editor.triggerSuggest').textContent).toContain(
      'Ctrl+Space'
    )
  })

  /*
    Session 4-7B の Git 7件・Files 3件はどれも打鍵を持たない。
    **一覧に出ないのではなく「未割り当て」として出る**（keybindings/defaults.ts）。

    Session 5-12 の `editor.showHover` も同じ（Monaco の既定が2打鍵のため）。
    Session 6-5 の Debug panel toggle も、6-8 の Toolbar までは未割り当て。
  */
  it('未割り当ての22件が「未割り当て」として出る', async () => {
    await openKeyboard()

    const unassigned = rows().filter((row) => row.dataset.unassigned === 'true')

    expect(unassigned).toHaveLength(22)
    for (const row of unassigned) {
      expect(row.textContent, row.dataset.command).toContain('未割り当て')
      expect(row.querySelector('kbd')).toBeNull()
    }
  })

  it('Git パネルが開いていなくても Git の7件が並ぶ', async () => {
    await openKeyboard()

    const git = rows().filter((row) => row.dataset.category === 'git')

    expect(git).toHaveLength(7)
    expect(byTestId('settings-keyboard-row-git.commit').textContent).toContain('コミット')
  })

  it('Files の3件も並ぶ', async () => {
    await openKeyboard()

    expect(rows().filter((row) => row.dataset.category === 'files')).toHaveLength(3)
  })

  it('Debug command の12件が並び、操作用の既定打鍵を持つ', async () => {
    await openKeyboard()

    const debug = rows().filter((row) => row.dataset.category === 'debug')

    expect(debug).toHaveLength(12)
    expect(byTestId('settings-keyboard-row-debug.startOrContinue').textContent).toContain('F5')
    expect(byTestId('settings-keyboard-row-debug.stop').textContent).toContain('Shift+F5')
    expect(byTestId('settings-keyboard-row-debug.toggleBreakpoint').textContent).toContain('F9')
    expect(byTestId('settings-keyboard-row-debug.stepOver').textContent).toContain('F10')
    expect(byTestId('settings-keyboard-row-debug.stepInto').textContent).toContain('F11')
    expect(byTestId('settings-keyboard-row-debug.stepOut').textContent).toContain('Shift+F11')
    expect(byTestId('settings-keyboard-row-debug.start').textContent).toContain('デバッグを開始')
    expect(byTestId('settings-keyboard-row-debug.start').textContent).toContain('未割り当て')
  })

  /*
    v1 は Source 列を出さない（値が1種類しか無い）。構造としては行に残してあり、
    User / Workspace が入ったときに列を足すだけで済む。
  */
  it('Source は列に出ないが、行の属性としては出ている', async () => {
    await openKeyboard()

    expect(byTestId('settings-keyboard-row-editor.save').dataset.source).toBe('default')
    expect(byTestId('settings-keyboard-row-git.commit').dataset.source).toBe('none')
    expect(container.textContent).not.toContain('既定')
  })

  it('When も競合も Reset も出さない', async () => {
    await openKeyboard()

    expect(container.textContent).not.toContain('terminalFocused')
    expect(byTestId('settings-keyboard').querySelectorAll('button')).toHaveLength(0)
  })
})

describe('絞り込み', () => {
  it('表示名で絞れる', async () => {
    await openKeyboard()
    await type('コミット')

    expect(rows().map((row) => row.dataset.command)).toEqual(['git.commit', 'git.openHistory'])
  })

  it('command の id で絞れる（表示が日本語でも）', async () => {
    await openKeyboard()
    await type('files.')

    expect(rows()).toHaveLength(3)
    expect(groups()).toEqual(['files'])
  })

  it('打鍵で絞れる', async () => {
    await openKeyboard()
    await type('ctrl+shift')

    expect(rows().map((row) => row.dataset.command)).toEqual([
      'editor.saveAs',
      'view.togglePanel.files',
      'view.togglePanel.git'
    ])
  })

  it('空のカテゴリは見出しごと消える', async () => {
    await openKeyboard()
    await type('git.')

    expect(groups()).toEqual(['git'])
  })

  it('当たらなければ、その旨を検索語つきで出す', async () => {
    await openKeyboard()
    await type('zzzznope')

    expect(rows()).toHaveLength(0)
    expect(byTestId('settings-keyboard-empty').textContent).toContain('zzzznope')
  })

  it('消せば全件へ戻る', async () => {
    await openKeyboard()
    await type('git.')
    await click('settings-keyboard-search-clear')

    expect(rows()).toHaveLength(40)
    expect(byTestId<HTMLInputElement>('settings-keyboard-search').value).toBe('')
  })

  /* 次に開いたときに前の絞り込みが残っていると、一覧が欠けているように見える。 */
  it('カテゴリを離れて戻ると、絞り込みは残っていない', async () => {
    await openKeyboard()
    await type('git.')
    await click('settings-category-general')
    await click('settings-category-keyboard')

    expect(rows()).toHaveLength(40)
  })
})

describe('ja / en の切り替え', () => {
  it('言語を変えると、command 名も見出しも文言もその場で入れ替わる', async () => {
    await openKeyboard()

    expect(byTestId('settings-keyboard-row-editor.save').textContent).toContain('保存')
    expect(byTestId('settings-keyboard-row-git.refresh').textContent).toContain(
      'Git の状態を調べ直す'
    )
    expect(byTestId('settings-keyboard-row-view.resetLayout').textContent).toContain('未割り当て')

    await click('settings-category-general')
    await click('settings-general-language-en')
    await click('settings-category-keyboard')

    expect(byTestId('settings-category-keyboard').textContent).toBe('Keyboard Shortcuts')
    expect(byTestId('settings-keyboard-row-editor.save').textContent).toContain('Save')
    expect(byTestId('settings-keyboard-row-git.refresh').textContent).toContain(
      'Refresh Git Status'
    )
    expect(byTestId('settings-keyboard-row-view.resetLayout').textContent).toContain('Unassigned')

    /* 打鍵は言語に関係なく同じ表記のまま。 */
    expect(byTestId('settings-keyboard-row-editor.save').textContent).toContain('Ctrl+S')
  })

  it('切り替えても 40 件・7 グループのまま', async () => {
    await openKeyboard()
    await click('settings-category-general')
    await click('settings-general-language-en')
    await click('settings-category-keyboard')

    expect(rows()).toHaveLength(40)
    expect(groups()).toEqual(['workspace', 'editor', 'view', 'settings', 'debug', 'git', 'files'])
  })
})

describe('閲覧専用', () => {
  /*
    一覧から command を実行する経路を持たない（Session 4-7C の前提）。
    行を押しても、その command の handler は呼ばれない。
  */
  it('行を押しても command が走らない', async () => {
    const push = vi.fn()

    await render(push)
    await click('settings-category-keyboard')

    const row = byTestId('settings-keyboard-row-git.push')

    await act(async () => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(push).not.toHaveBeenCalled()
  })

  it('行が押せる要素になっていない', async () => {
    await openKeyboard()

    const row = byTestId('settings-keyboard-row-git.push')

    expect(row.tagName).toBe('DIV')
    expect(row.getAttribute('role')).toBe('listitem')
    expect(row.querySelector('button')).toBeNull()
    expect(row.querySelector('a')).toBeNull()
  })

  it('閲覧専用であることを画面が断っている', async () => {
    await openKeyboard()

    expect(byTestId('settings-keyboard').textContent).toContain('この版では打鍵を変更できません')
  })
})
