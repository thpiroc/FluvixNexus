/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredKeybindingEntry } from '@shared/keybindings'
import { CommandProvider } from '../commands/CommandProvider'
import { useCommand } from '../commands/useCommand'
import { EditorContext } from '../editor/context'
import type { EditorController } from '../editor/useEditorSession'
import { WorkspaceFolderContext, type WorkspaceFolderController } from '../workspaceFolder/context'
import { useKeybindings, type KeybindingController } from './context'
import { DEFAULT_KEYBINDINGS } from './defaults'
import { KeybindingProvider } from './KeybindingProvider'
import { resolveKeybindings } from './resolve'

/**
 * `keybindings.json` を読んで表を作り直す（Shortcuts S3）。
 *
 * 読み替えの規則そのものは userKeybindings.test.ts で見てあるので、
 * ここで見るのは Provider が絡む所だけ。
 *
 *   - 読み込みが返るまで既定だけで動き、返ったら表が変わる
 *   - ユーザーの行が空なら、表は既定だけのときと同じ
 *   - 保存が受け付けられたら表が変わり、拒まれたら変わらない
 *   - 中身が分からない間（読み込み中・IPC 失敗）は保存しない
 */

const keybindingsApi = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn()
}))

vi.mock('../api/fluvix', () => ({
  fluvix: { keybindings: keybindingsApi }
}))

let container: HTMLDivElement
let root: Root
let controller: KeybindingController | null

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  keybindingsApi.save.mockResolvedValue({ ok: true, data: undefined })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  controller = null
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
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
    openFolder: () => {},
    closeWorkspace: () => {}
  }
}

function Probe(): null {
  controller = useKeybindings()

  return null
}

function Owner({ save, reset }: { save: () => void; reset: () => void }): null {
  useCommand('editor.save', save)
  useCommand('view.resetLayout', reset)

  return null
}

function harness(children: ReactElement[]): ReactElement {
  return createElement(
    CommandProvider,
    null,
    createElement(
      WorkspaceFolderContext.Provider,
      { value: mockWorkspace() },
      createElement(
        EditorContext.Provider,
        { value: { activeTab: null } as unknown as EditorController },
        createElement(KeybindingProvider, null, ...children)
      )
    )
  )
}

async function render(save = vi.fn(), reset = vi.fn()): Promise<void> {
  await act(async () => {
    root.render(
      harness([
        createElement(Probe, { key: 'probe' }),
        createElement(Owner, { key: 'owner', save, reset })
      ])
    )
  })
}

function current(): KeybindingController {
  if (controller === null) {
    throw new Error('Provider is not rendered.')
  }

  return controller
}

function press(init: { key: string; code: string; ctrlKey?: boolean; altKey?: boolean }): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  })
}

const CTRL_S = { key: 's', code: 'KeyS', ctrlKey: true }
const CTRL_ALT_R = { key: 'r', code: 'KeyR', ctrlKey: true, altKey: true }

function loaded(entries: readonly StoredKeybindingEntry[], skippedCount = 0): unknown {
  return { ok: true, data: { status: 'loaded', entries, skippedCount } }
}

describe('読み込み', () => {
  it('ユーザーの行が空なら、表は既定だけのときと同じ', async () => {
    keybindingsApi.load.mockResolvedValue({
      ok: true,
      data: { status: 'missing', entries: [], skippedCount: 0 }
    })

    await render()

    expect(current().entries).toEqual(resolveKeybindings(DEFAULT_KEYBINDINGS).entries)
    expect(current().userKeybindings).toEqual({
      status: 'missing',
      entries: [],
      skippedCount: 0,
      invalid: []
    })
  })

  it('読み込みが返るまでは既定だけで動き、返ったら表が作り直される', async () => {
    let resolveLoad: (value: unknown) => void = () => {}
    keybindingsApi.load.mockReturnValue(new Promise((resolve) => (resolveLoad = resolve)))

    const save = vi.fn()
    const reset = vi.fn()
    await render(save, reset)

    expect(current().userKeybindings.status).toBe('loading')
    press(CTRL_S)
    expect(save).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveLoad(
        loaded([
          { key: 'ctrl+s', command: '-editor.save' },
          { key: 'ctrl+alt+r', command: 'view.resetLayout' }
        ])
      )
    })

    expect(current().userKeybindings.status).toBe('loaded')
    press(CTRL_S)
    press(CTRL_ALT_R)
    expect(save).toHaveBeenCalledTimes(1)
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('読めない行は invalid に出て、残りの行は効く', async () => {
    keybindingsApi.load.mockResolvedValue(
      loaded(
        [
          { key: 'ctrl+1', command: 'nope.command' },
          { key: 'ctrl+alt+r', command: 'view.resetLayout' }
        ],
        2
      )
    )

    const reset = vi.fn()
    await render(vi.fn(), reset)

    expect(current().userKeybindings.skippedCount).toBe(2)
    expect(current().userKeybindings.invalid).toEqual([
      { index: 0, entry: { key: 'ctrl+1', command: 'nope.command' }, problem: 'unknownCommand' }
    ])
    press(CTRL_ALT_R)
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('IPC が失敗しても既定の割り当ては効く', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    keybindingsApi.load.mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL', message: 'boom' }
    })

    const save = vi.fn()
    await render(save)

    expect(current().userKeybindings.status).toBe('failed')
    press(CTRL_S)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('壊れたファイル（unreadable）でも既定の割り当ては効く', async () => {
    keybindingsApi.load.mockResolvedValue({
      ok: true,
      data: { status: 'unreadable', entries: [], skippedCount: 0 }
    })

    const save = vi.fn()
    await render(save)

    press(CTRL_S)
    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('保存', () => {
  it('受け付けられたら表が作り直される', async () => {
    keybindingsApi.load.mockResolvedValue(loaded([]))

    const save = vi.fn()
    const reset = vi.fn()
    await render(save, reset)

    const next = [
      { key: 'ctrl+s', command: '-editor.save' },
      { key: 'ctrl+alt+r', command: 'view.resetLayout' }
    ]

    let saved = false
    await act(async () => {
      saved = await current().saveUserKeybindings(next)
    })

    expect(saved).toBe(true)
    expect(keybindingsApi.save).toHaveBeenCalledWith({ entries: next })
    expect(current().userKeybindings.entries).toEqual(next)

    press(CTRL_S)
    press(CTRL_ALT_R)
    expect(save).not.toHaveBeenCalled()
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('空の並びを保存すると既定へ戻る', async () => {
    keybindingsApi.load.mockResolvedValue(loaded([{ key: 'ctrl+s', command: '-editor.save' }]))

    const save = vi.fn()
    await render(save)
    press(CTRL_S)
    expect(save).not.toHaveBeenCalled()

    await act(async () => {
      await current().saveUserKeybindings([])
    })

    expect(current().entries).toEqual(resolveKeybindings(DEFAULT_KEYBINDINGS).entries)
    press(CTRL_S)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('Main に拒まれたら表は変わらない', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    keybindingsApi.load.mockResolvedValue(loaded([]))
    keybindingsApi.save.mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'not storable' }
    })

    const save = vi.fn()
    await render(save)

    let saved = true
    await act(async () => {
      saved = await current().saveUserKeybindings([{ key: 'ctrl+s', command: '-editor.save' }])
    })

    expect(saved).toBe(false)
    expect(current().userKeybindings.entries).toEqual([])
    press(CTRL_S)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('読み込み中は保存しない（中身を知らないまま上書きしない）', async () => {
    keybindingsApi.load.mockReturnValue(new Promise(() => {}))

    await render()

    let saved = true
    await act(async () => {
      saved = await current().saveUserKeybindings([])
    })

    expect(saved).toBe(false)
    expect(keybindingsApi.save).not.toHaveBeenCalled()
  })

  it('読み込みの IPC が失敗していたら保存しない', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    keybindingsApi.load.mockResolvedValue({ ok: false, error: { code: 'INTERNAL', message: 'x' } })

    await render()

    let saved = true
    await act(async () => {
      saved = await current().saveUserKeybindings([])
    })

    expect(saved).toBe(false)
    expect(keybindingsApi.save).not.toHaveBeenCalled()
  })

  it('壊れたファイルの上へは保存してよい（退避は Main が行う）', async () => {
    keybindingsApi.load.mockResolvedValue({
      ok: true,
      data: { status: 'unreadable', entries: [], skippedCount: 0 }
    })

    await render()

    let saved = false
    await act(async () => {
      saved = await current().saveUserKeybindings([
        { key: 'ctrl+alt+r', command: 'view.resetLayout' }
      ])
    })

    expect(saved).toBe(true)
    expect(current().userKeybindings.status).toBe('loaded')
  })
})
