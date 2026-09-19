/**
 * @vitest-environment jsdom
 */
import { act, createElement, useMemo, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { LoadSettingsResponse, WorkspaceSettingsSnapshot } from '@shared/ipc'
import { emptySettingsSections, type SettingsSections } from '@shared/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_SAVE_SETTINGS_BINDING, createAutoSaveSetters } from '../editor/autoSave'
import { EditorContext } from '../editor/context'
import type { EditorController } from '../editor/useEditorSession'
import { TerminalContext } from '../terminal/context'
import { TerminalSettingsMenu } from '../terminal/TerminalSettingsMenu'
import { useTerminalSettings } from '../terminal/useTerminalSettings'
import type { TerminalTabsController } from '../terminal/useTerminalTabs'
import { WorkspaceFolderContext, type WorkspaceFolderController } from '../workspaceFolder/context'
import { WorkspaceTopBar } from '../workspace/shell/WorkspaceTopBar'
import type { PanelId } from '../workspace/panels/types'
import { FilesViewProvider } from '../files/FilesViewProvider'
import { useFilesLayout } from '../files/useFilesLayout'
import { toFilesViewChoice } from '../files/filesSettings'
import { LanguageProvider } from '../i18n/LanguageProvider'
import { LspSettingsProvider } from '../lsp/LspSettingsProvider'
import { readDocumentLanguage } from '../i18n/documentLanguage'
import { ThemeProvider } from '../theme/ThemeProvider'
import { readDocumentTheme } from '../theme/documentTheme'
import { SettingsOverlay } from './SettingsOverlay'
import { SettingsScopeProvider } from './SettingsScopeProvider'
import { useSettingsSection } from './useSettingsSection'

const settingsStore = vi.hoisted(() => ({
  sections: {
    general: {},
    editor: {},
    files: {},
    terminal: {},
    appearance: {}
  } as SettingsSections,
  load: vi.fn(),
  saveSection: vi.fn(),
  /** Main から届く「Workspace が切り替わった」の受け手（試験から流す）。 */
  workspaceListeners: [] as Array<(event: { workspaceId: string | null }) => void>,
  onWorkspaceChanged: vi.fn()
}))

vi.mock('../api/fluvix', () => ({
  fluvix: {
    settings: {
      load: settingsStore.load,
      saveSection: settingsStore.saveSection,
      onWorkspaceChanged: settingsStore.onWorkspaceChanged
    }
  }
}))

/** `settings:load` の応答を差し替える（ユーザー設定と、開いている Workspace の設定）。 */
function respondWith(user: SettingsSections, workspace: WorkspaceSettingsSnapshot | null): void {
  const data: LoadSettingsResponse = { user, workspace }

  settingsStore.sections = user
  settingsStore.load.mockResolvedValue({ ok: true, data })
}

/** 開いている Workspace のワークスペース設定（上書きの無い section は空）。 */
function workspaceSnapshot(
  sections: Partial<SettingsSections> = {},
  workspaceId = 'workspace-a',
  displayName = 'project-a'
): WorkspaceSettingsSnapshot {
  return { workspaceId, displayName, sections: { ...emptySettingsSections(), ...sections } }
}

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
  /*
    ユーザー設定 / ワークスペース設定の器（feature/settings-scope）。**実物を使う** ──
    確かめたいのが「Settings 画面で変えた値が、各機能の読む値そのものになること」で、
    その値はこの器にしか無い。中身は上の `settingsStore`（fluvix のモック）から読む。
  */
  return createElement(
    SettingsScopeProvider,
    null,
    createElement(
      /*
        Theme は実物の Provider を使う（Session 4-4）── 確かめたいのが
        「選ぶと `<html>` に当たること」なので、ここを差し替えるとその経路ごと
        試験の外に出てしまう。
      */
      ThemeProvider,
      null,
      createElement(LanguageProvider, null, createElement(SettingsDomHarnessBody))
    )
  )
}

function SettingsDomHarnessBody(): ReactElement {
  const [settingsOpen, setSettingsOpen] = useState(false)

  /*
    Editor / Terminal は本物の器ごと立てると Monaco / xterm まで要るので、
    **設定の部分だけ本物の hook を使う。** Editor（useEditorSession）と同じ
    binding・同じ変え方、Terminal は useTerminalSettings そのもの ── 読む値は
    アプリ本体と同じ「実際に効く値」になる。
  */
  const { value: autoSave, update: updateAutoSave } = useSettingsSection(AUTO_SAVE_SETTINGS_BINDING)
  const terminal = useTerminalSettings()

  const editorController = useMemo(
    () => ({ autoSave, ...createAutoSaveSetters(updateAutoSave) }) as unknown as EditorController,
    [autoSave, updateAutoSave]
  )

  const terminalController = useMemo(
    () =>
      ({
        display: terminal.settings,
        setFontSize: terminal.setFontSize,
        setScrollback: terminal.setScrollback
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
            /*
              Language Server の設定（Session 5-4）。実物の Provider を使う
              ── 確かめたいのが「押すと保存され、その値が画面に出ること」で、
              差し替えるとその経路ごと試験の外に出てしまう。
            */
            LspSettingsProvider,
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
                onOpenSettings: () => setSettingsOpen(true),
                feedbackOpen: false,
                onOpenFeedback: vi.fn()
              }),
              createElement(FilesToolbarProbe),
              createElement(TerminalSettingsMenu, {
                display: terminal.settings,
                onFontSizeChange: terminal.setFontSize
              }),
              createElement('span', { 'data-testid': 'editor-auto-save-mode' }, autoSave.mode),
              createElement('span', { 'data-testid': 'editor-auto-save-delay' }, autoSave.delayMs),
              createElement(
                'span',
                { 'data-testid': 'terminal-font-size-value' },
                terminal.settings.fontSize
              ),
              createElement(
                'span',
                { 'data-testid': 'terminal-scrollback-value' },
                terminal.settings.scrollback
              ),
              settingsOpen &&
                createElement(SettingsOverlay, { onClose: () => setSettingsOpen(false) })
            )
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
  respondWith(emptySettingsSections(), null)
  settingsStore.saveSection.mockResolvedValue({ ok: true, data: undefined })
  settingsStore.workspaceListeners = []
  settingsStore.onWorkspaceChanged.mockImplementation(
    (listener: (event: { workspaceId: string | null }) => void) => {
      settingsStore.workspaceListeners.push(listener)
      return () => {
        settingsStore.workspaceListeners = settingsStore.workspaceListeners.filter(
          (entry) => entry !== listener
        )
      }
    }
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  /*
    `<html>` の属性は React が管理していない場所にあり（theme/ThemeProvider.tsx）、
    unmount しても残る。次の試験へ持ち越さないようここで剥がす ── 実物では
    Preload が起動のたびに当て直すので、剥がす経路はここにしか要らない。
  */
  document.documentElement.removeAttribute('data-fx-theme')
  document.documentElement.removeAttribute('data-fx-language')
  document.documentElement.removeAttribute('lang')
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
      'general'
    )

    await click('settings-category-appearance')
    expect(container.querySelector('.fx-settings__content')?.getAttribute('data-category')).toBe(
      'appearance'
    )

    await click('settings-category-editor')
    expect(container.querySelector('.fx-settings__content')?.getAttribute('data-category')).toBe(
      'editor'
    )

    await click('settings-category-files')
    expect(container.querySelector('.fx-settings__content')?.getAttribute('data-category')).toBe(
      'files'
    )

    await click('settings-category-lsp')
    expect(container.querySelector('.fx-settings__content')?.getAttribute('data-category')).toBe(
      'lsp'
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

  it('Language を選ぶと Settings と Topbar がその場で切り替わり、保存される', async () => {
    await renderHarness()

    expect(readDocumentLanguage()).toBe('ja')
    expect(byTestId('topbar-settings').textContent).toBe('設定')

    await click('topbar-settings')
    expect(container.querySelector('.fx-settings__title')?.textContent).toBe('設定')
    expect(byTestId('settings-general-language-ja').dataset.active).toBe('true')

    await click('settings-general-language-en')

    expect(readDocumentLanguage()).toBe('en')
    expect(document.documentElement.getAttribute('lang')).toBe('en')
    expect(container.querySelector('.fx-settings__title')?.textContent).toBe('Settings')
    expect(byTestId('topbar-settings').textContent).toBe('Settings')
    expect(byTestId('settings-category-general').textContent).toBe('General')
    expect(byTestId('settings-general-language-en').dataset.active).toBe('true')
    expect(settingsStore.saveSection).toHaveBeenCalledWith({
      scope: 'user',
      section: 'general',
      value: { language: 'en' }
    })
  })

  it('保存されている Language が知らない値なら、日本語で出る', async () => {
    settingsStore.sections = { ...emptySettingsSections(), general: { language: 'fr' } }
    respondWith(settingsStore.sections, null)

    await renderHarness()

    expect(readDocumentLanguage()).toBe('ja')

    await click('topbar-settings')
    expect(container.querySelector('.fx-settings__title')?.textContent).toBe('設定')
    expect(byTestId('settings-general-language-ja').dataset.active).toBe('true')
  })

  it('各設定コントロールが既存 setter と同じ値へ接続される', async () => {
    await renderHarness()
    await click('topbar-settings')

    await click('settings-category-editor')
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

  /*
    Theme（Session 4-4）。

    確かめるのは**押した瞬間に `<html>` へ当たること**で、そこが CSS・Monaco・
    xterm の3つすべての入口になる（それぞれの見え方そのものは実機で見る ──
    Monaco も xterm も jsdom では動かない）。
  */
  it('Theme を選ぶと、その場で <html> に当たり、保存される', async () => {
    await renderHarness()

    // 保存が無い状態。既定の Dark で始まる。
    expect(readDocumentTheme()).toBe('dark')

    await click('topbar-settings')
    await click('settings-category-appearance')

    expect(byTestId('settings-appearance-theme-dark').dataset.active).toBe('true')
    expect(byTestId('settings-appearance-theme-light').dataset.active).toBe('false')

    await click('settings-appearance-theme-light')

    // 即時反映（「適用」も「OK」も無い）。
    expect(readDocumentTheme()).toBe('light')
    expect(byTestId('settings-appearance-theme-light').dataset.active).toBe('true')
    expect(settingsStore.saveSection).toHaveBeenCalledWith({
      scope: 'user',
      section: 'appearance',
      value: { theme: 'light' }
    })

    // 面を閉じて開き直しても、選んだ方が現在値として出る（画面は値を持たない）。
    await click('settings-close')
    await click('topbar-settings')
    await click('settings-category-appearance')
    expect(byTestId('settings-appearance-theme-light').dataset.active).toBe('true')

    await click('settings-appearance-theme-dark')
    expect(readDocumentTheme()).toBe('dark')
  })

  /*
    アプリのダウングレードや、保存ファイルを手で直した場合。
    **知らない Theme 名は Dark として扱われ、`<html>` にも残らない。**
  */
  it('保存されている Theme が知らない値なら、Dark で出る', async () => {
    settingsStore.sections = { ...emptySettingsSections(), appearance: { theme: 'solarized' } }
    respondWith(settingsStore.sections, null)

    await renderHarness()

    expect(readDocumentTheme()).toBe('dark')

    await click('topbar-settings')
    await click('settings-category-appearance')
    expect(byTestId('settings-appearance-theme-dark').dataset.active).toBe('true')
  })

  /* 保存されている Theme は、起動時にそのまま出る（再起動での復元にあたる）。 */
  it('保存されている Theme で始まる', async () => {
    settingsStore.sections = { ...emptySettingsSections(), appearance: { theme: 'light' } }
    respondWith(settingsStore.sections, null)

    await renderHarness()

    expect(readDocumentTheme()).toBe('light')
  })

  /*
    **起動時のちらつき**（Session 4-4 の D）。

    Preload は `settings:load` より早く `<html>` へ Theme を当てる
    （preload/theme.ts）。React の初期値を既定（Dark）にしていると、
    最初の描画がそれを Dark で塗り直し、読み込みが返ってから Light へ戻る ──
    利用者からは「起動のたびに一瞬 Dark が出る」形で見える。

    ここでは Preload の当てた状態（`data-fx-theme="light"`）を先に作り、
    **読み込みが返らないまま**描画して、Dark へ倒れないことを見る。
  */
  it('読み込みが返る前でも、Preload が当てた Theme を塗り直さない', async () => {
    document.documentElement.setAttribute('data-fx-theme', 'light')
    // 応答を返さない（起動直後の、まだ読めていない状態にあたる）。
    settingsStore.load.mockReturnValue(new Promise(() => {}))

    await renderHarness()

    expect(readDocumentTheme()).toBe('light')

    await click('topbar-settings')
    await click('settings-category-appearance')
    expect(byTestId('settings-appearance-theme-light').dataset.active).toBe('true')
  })

  /* Preload が当てられなかった場合は、他の3つと同じ「読めなければ既定」に戻る。 */
  it('Preload が当てていなければ Dark で始まる', async () => {
    settingsStore.load.mockReturnValue(new Promise(() => {}))

    await renderHarness()

    expect(readDocumentTheme()).toBe('dark')
  })

  /*
    Language Server（Session 5-4）。

    確かめたいのは3つで、どれも**この面が値を持たない**ことに掛かっている。

      - 既定は「使う」（Session 5-3 までと同じ振る舞い）
      - 押すと保存要求が出る（そこから先は Main が受け持つ）
      - 全体を切っても、言語ごとの選択は残り、押せるまま

    「切ったらサーバが止まる」は Main の側の話で、ここでは見ない
    （main/lsp/languageServerSettings.ts）。
  */
  it('Language Server の既定は「使う」で、切ると保存される', async () => {
    await renderHarness()
    await click('topbar-settings')
    await click('settings-category-lsp')

    expect(byTestId('settings-lsp-enabled-on').dataset.active).toBe('true')
    expect(byTestId('settings-lsp-enabled-off').dataset.active).toBe('false')

    for (const id of ['typescript', 'python', 'csharp']) {
      expect(byTestId(`settings-lsp-server-${id}`).dataset.active).toBe('true')
    }

    await click('settings-lsp-enabled-off')

    expect(byTestId('settings-lsp-enabled-off').dataset.active).toBe('true')
    // 書くのは変わった key だけ（他の key は既定のまま＝書かない。feature/settings-scope）。
    expect(settingsStore.saveSection).toHaveBeenCalledWith({
      scope: 'user',
      section: 'lsp',
      value: { enabled: false }
    })
  })

  it('全体を切っても、言語ごとの選択は残り、押せるまま', async () => {
    await renderHarness()
    await click('topbar-settings')
    await click('settings-category-lsp')

    await click('settings-lsp-server-python')
    expect(byTestId('settings-lsp-server-python').dataset.active).toBe('false')

    await click('settings-lsp-enabled-off')

    // 効いていないことは薄さで示すだけで、値も操作も残す（settings.css）。
    expect(byTestId('settings-lsp-servers').dataset.inactive).toBe('true')
    expect(byTestId('settings-lsp-server-typescript').dataset.active).toBe('true')
    expect(byTestId('settings-lsp-server-python').dataset.active).toBe('false')

    await click('settings-lsp-server-csharp')
    expect(byTestId('settings-lsp-server-csharp').dataset.active).toBe('false')

    await click('settings-lsp-enabled-on')

    expect(byTestId('settings-lsp-servers').dataset.inactive).toBe('false')
    expect(byTestId('settings-lsp-server-typescript').dataset.active).toBe('true')
    expect(byTestId('settings-lsp-server-python').dataset.active).toBe('false')
    expect(byTestId('settings-lsp-server-csharp').dataset.active).toBe('false')
  })

  it('保存されている値が読めなければ「使う」で出る', async () => {
    settingsStore.sections = {
      ...emptySettingsSections(),
      lsp: { enabled: 'no' } as unknown as SettingsSections['lsp']
    }
    respondWith(settingsStore.sections, null)

    await renderHarness()
    await click('topbar-settings')
    await click('settings-category-lsp')

    expect(byTestId('settings-lsp-enabled-on').dataset.active).toBe('true')
  })
})

/*
  ユーザー設定 / ワークスペース設定（feature/settings-scope）。

  確かめるのは、画面の切り替えと「どちらの値が効くか」が同じ答えになること。
    - 今どちらを編集しているかが見える
    - Workspace が無くてもワークスペースを選べ、案内が出る（落ちない）
    - ワークスペース設定がユーザー設定より優先され、戻せばユーザー設定へ戻る
    - Workspace を切り替えると、その Workspace の設定へ入れ替わる
*/
describe('ユーザー設定 / ワークスペース設定', () => {
  async function openSettings(category?: string): Promise<void> {
    await renderHarness()
    await click('topbar-settings')

    if (category !== undefined) {
      await click(`settings-category-${category}`)
    }
  }

  async function notifyWorkspaceChanged(workspaceId: string | null): Promise<void> {
    await act(async () => {
      for (const listener of settingsStore.workspaceListeners) {
        listener({ workspaceId })
      }
    })
  }

  it('開くとユーザー設定から始まり、どちらを編集しているかが見える', async () => {
    respondWith(emptySettingsSections(), workspaceSnapshot())
    await openSettings()

    expect(byTestId('settings-scope').dataset.scope).toBe('user')
    expect(byTestId('settings-scope-user').getAttribute('aria-selected')).toBe('true')
    expect(byTestId('settings-scope-workspace').getAttribute('aria-selected')).toBe('false')
    expect(byTestId('settings-scope-description').textContent).toContain('すべてのプロジェクト')

    await click('settings-scope-workspace')

    expect(byTestId('settings-scope').dataset.scope).toBe('workspace')
    expect(byTestId('settings-content').dataset.scope).toBe('workspace')
    expect(byTestId('settings-scope-workspace').getAttribute('aria-selected')).toBe('true')
    expect(byTestId('settings-scope-description').textContent).toContain('「project-a」')
  })

  it('Workspace を開いていなければ、ワークスペースを選んでも案内だけが出る', async () => {
    respondWith(emptySettingsSections(), null)
    await openSettings('terminal')

    await click('settings-scope-workspace')

    expect(byTestId('settings-workspace-unavailable').textContent).toContain(
      'ワークスペースを開くと、このプロジェクト専用の設定を変更できます'
    )
    expect(container.querySelector('[data-testid="settings-terminal-font-size"]')).toBeNull()

    // 他のカテゴリへ移っても、ユーザー設定へ戻しても壊れない。
    await click('settings-category-editor')
    expect(byTestId('settings-workspace-unavailable')).not.toBeNull()

    await click('settings-scope-user')
    await click('settings-category-terminal')
    expect(byTestId<HTMLInputElement>('settings-terminal-font-size').value).toBe('13')
    expect(settingsStore.saveSection).not.toHaveBeenCalled()
  })

  it('ワークスペース設定で変えると、その値が効き、ユーザー設定は変わらない', async () => {
    respondWith({ ...emptySettingsSections(), terminal: { fontSize: 14 } }, workspaceSnapshot())
    await openSettings('terminal')

    expect(byTestId('terminal-font-size-value').textContent).toBe('14')

    await click('settings-scope-workspace')
    expect(byTestId('settings-scope-status-terminal.fontSize').dataset.state).toBe('inherited')
    expect(byTestId<HTMLInputElement>('settings-terminal-font-size').value).toBe('14')

    await commitNumber('settings-terminal-font-size', '20')

    // 効く値はワークスペース設定の方。
    expect(byTestId('terminal-font-size-value').textContent).toBe('20')
    expect(byTestId('settings-scope-status-terminal.fontSize').dataset.state).toBe('overridden')
    // 変えたのは文字の大きさだけ。さかのぼれる行数はワークスペースへ固定しない。
    expect(settingsStore.saveSection).toHaveBeenCalledTimes(1)
    expect(settingsStore.saveSection).toHaveBeenCalledWith({
      scope: 'workspace',
      workspaceId: 'workspace-a',
      section: 'terminal',
      value: { fontSize: 20 }
    })
    expect(byTestId('settings-scope-status-terminal.scrollback').dataset.state).toBe('inherited')

    // ユーザー設定の側から見ると、値は 14 のまま・上書きされていることが出る。
    await click('settings-scope-user')
    expect(byTestId<HTMLInputElement>('settings-terminal-font-size').value).toBe('14')
    expect(byTestId('settings-scope-status-terminal.fontSize').dataset.state).toBe('shadowed')
  })

  it('両方にあればワークスペース設定が優先され、ユーザー設定を変えても効く値は動かない', async () => {
    respondWith(
      { ...emptySettingsSections(), appearance: { theme: 'dark' } },
      workspaceSnapshot({ appearance: { theme: 'light' } })
    )
    await openSettings('appearance')

    expect(readDocumentTheme()).toBe('light')
    // ユーザー設定の側はユーザー設定の値（Dark）を出す。
    expect(byTestId('settings-appearance-theme-dark').dataset.active).toBe('true')

    await click('settings-appearance-theme-light')
    await click('settings-appearance-theme-dark')

    expect(settingsStore.saveSection).toHaveBeenLastCalledWith({
      scope: 'user',
      section: 'appearance',
      value: { theme: 'dark' }
    })
    expect(readDocumentTheme()).toBe('light')
  })

  it('「ユーザー設定に戻す」でワークスペース設定が消え、ユーザー設定へ戻る', async () => {
    respondWith(
      { ...emptySettingsSections(), terminal: { fontSize: 15 } },
      workspaceSnapshot({ terminal: { fontSize: 22 } })
    )
    await openSettings('terminal')

    expect(byTestId('terminal-font-size-value').textContent).toBe('22')

    await click('settings-scope-workspace')
    await click('settings-scope-reset-terminal.fontSize')

    expect(byTestId('terminal-font-size-value').textContent).toBe('15')
    expect(byTestId('settings-scope-status-terminal.fontSize').dataset.state).toBe('inherited')
    expect(settingsStore.saveSection).toHaveBeenCalledWith({
      scope: 'workspace',
      workspaceId: 'workspace-a',
      section: 'terminal',
      value: {}
    })
  })

  it('画面の外から変えると、その値を今決めている scope へ書く', async () => {
    respondWith(emptySettingsSections(), workspaceSnapshot({ files: { viewMode: 'columns' } }))
    await renderHarness()

    expect(byTestId('files-toolbar-choice').textContent).toBe('columns')

    // ワークスペース設定で決まっている値は、ワークスペース設定が変わる。
    await click('files-toolbar-tree')
    expect(byTestId('files-toolbar-choice').textContent).toBe('tree')
    expect(settingsStore.saveSection).toHaveBeenLastCalledWith({
      scope: 'workspace',
      workspaceId: 'workspace-a',
      section: 'files',
      value: { viewMode: 'tree' }
    })

    // 上書きの無い値は、今までどおりユーザー設定が変わる。
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="ターミナルの設定"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await commitNumber('terminal-font-size', '16')
    expect(settingsStore.saveSection).toHaveBeenLastCalledWith({
      scope: 'user',
      section: 'terminal',
      value: { fontSize: 16 }
    })
  })

  it('表示言語はワークスペース設定では変えられない（押せず、理由が出る）', async () => {
    respondWith(emptySettingsSections(), workspaceSnapshot())
    await openSettings('general')

    await click('settings-scope-workspace')

    expect(byTestId('settings-scope-status-general.language').dataset.state).toBe('locked')
    expect(
      container.querySelector<HTMLFieldSetElement>(
        '[data-item="general.language"] .fx-settings__row-fieldset'
      )?.disabled
    ).toBe(true)
  })

  it('Workspace を切り替えると、その Workspace のワークスペース設定へ入れ替わる', async () => {
    const user = { ...emptySettingsSections(), terminal: { fontSize: 13 } }

    respondWith(user, workspaceSnapshot({ terminal: { fontSize: 20 } }, 'workspace-a', 'project-a'))
    await openSettings('terminal')
    expect(byTestId('terminal-font-size-value').textContent).toBe('20')

    // Main が別の Workspace を開いた（B には上書きが無い）。
    respondWith(user, workspaceSnapshot({}, 'workspace-b', 'project-b'))
    await notifyWorkspaceChanged('workspace-b')

    expect(byTestId('terminal-font-size-value').textContent).toBe('13')

    await click('settings-scope-workspace')
    expect(byTestId('settings-scope-description').textContent).toContain('「project-b」')
    expect(byTestId('settings-scope-status-terminal.fontSize').dataset.state).toBe('inherited')

    // B で変えた値は B に向けて保存される（A には混ざらない）。
    await commitNumber('settings-terminal-font-size', '17')
    expect(settingsStore.saveSection).toHaveBeenLastCalledWith({
      scope: 'workspace',
      workspaceId: 'workspace-b',
      section: 'terminal',
      value: { fontSize: 17 }
    })

    // Workspace を閉じると、ユーザー設定だけに戻る（落ちない）。
    respondWith(user, null)
    await notifyWorkspaceChanged(null)

    expect(byTestId('terminal-font-size-value').textContent).toBe('13')
    expect(byTestId('settings-workspace-unavailable')).not.toBeNull()
  })
})
