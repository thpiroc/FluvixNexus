/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EMPTY_DEBUG_CALL_STACK,
  type DebugCallStackSnapshot,
  type DebugScopesResult,
  type DebugVariablesResult
} from '@shared/debug'
import { I18nContext } from '../i18n/context'
import { createTranslator } from '../i18n/messages'
import { CallStackContext } from './callStackContext'
import { VariablesView } from './VariablesView'

type ScopesReply = { ok: true; data: { result: DebugScopesResult } } | { ok: false }
type VariablesReply = { ok: true; data: { result: DebugVariablesResult } } | { ok: false }

let container: HTMLDivElement
let root: Root
let listScopes: ReturnType<typeof vi.fn<(request: { frameId: number }) => Promise<ScopesReply>>>
let listVariables: ReturnType<
  typeof vi.fn<(request: { handle: string }) => Promise<VariablesReply>>
>

const STOPPED: DebugCallStackSnapshot = {
  status: 'stopped',
  activeThreadId: 1,
  threads: [
    {
      id: 1,
      name: 'main',
      stopped: true,
      frames: [
        {
          id: 10,
          name: 'run',
          line: 3,
          column: 1,
          source: { kind: 'workspace', relativePath: 'src/app.ts', name: 'app.ts' }
        },
        {
          id: 11,
          name: 'external',
          line: 1,
          column: 1,
          source: { kind: 'unavailable', name: 'lib.ts', reason: 'outside-workspace' }
        }
      ]
    }
  ]
}

function scopesOk(): ScopesReply {
  return {
    ok: true,
    data: {
      result: {
        status: 'ok',
        scopes: [
          {
            handle: 'dv-1',
            name: 'Locals',
            kind: 'locals',
            expensive: false,
            namedCount: null,
            indexedCount: null
          },
          {
            handle: 'dv-2',
            name: 'Globals',
            kind: 'other',
            expensive: true,
            namedCount: null,
            indexedCount: null
          }
        ]
      }
    }
  }
}

function variablesOk(
  variables: { name: string; value: string; handle: string | null }[],
  truncated = false
): VariablesReply {
  return {
    ok: true,
    data: {
      result: {
        status: 'ok',
        truncated,
        variables: variables.map((variable) => ({
          ...variable,
          type: null,
          kind: 'other' as const,
          namedCount: null,
          indexedCount: null
        }))
      }
    }
  }
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })

  return { promise, resolve }
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  listScopes = vi.fn(async () => scopesOk())
  listVariables = vi.fn(async ({ handle }: { handle: string }) => {
    switch (handle) {
      case 'dv-1':
        return variablesOk([
          { name: 'count', value: '3', handle: null },
          { name: 'user', value: 'User', handle: 'dv-3' }
        ])
      case 'dv-3':
        return variablesOk([{ name: 'name', value: '"Ada"', handle: null }])
      default:
        return variablesOk([])
    }
  })
  ;(globalThis as { fluvix?: unknown }).fluvix = { debug: { listScopes, listVariables } }
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  delete (globalThis as { fluvix?: unknown }).fluvix
})

function render(
  snapshot: DebugCallStackSnapshot,
  selectedFrameId: number | null = 10,
  version = 1
): void {
  const t = createTranslator('en')
  const node: ReactElement = createElement(
    I18nContext.Provider,
    { value: { language: 'en', setLanguage: () => {}, t } },
    createElement(
      CallStackContext.Provider,
      { value: { snapshot, version, selectedFrameId, selectFrame: () => {} } },
      createElement(VariablesView)
    )
  )

  act(() => root.render(node))
}

function treeItems(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')]
}

function rowTexts(): string[] {
  return [...container.querySelectorAll('.fx-debug-variables__row')].map(
    (row) => row.textContent ?? ''
  )
}

function click(element: Element | undefined): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function key(element: Element | undefined, name: string): void {
  act(() => {
    element?.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }))
  })
}

describe('VariablesView', () => {
  it('shows the not-stopped state without asking Main', () => {
    render(EMPTY_DEBUG_CALL_STACK, null)

    expect(container.textContent).toBe('Variables are shown while the program is paused.')
    expect(listScopes).not.toHaveBeenCalled()
  })

  it('shows loading while the call stack or scopes are loading', async () => {
    render({ ...STOPPED, status: 'loading' }, null)
    expect(container.textContent).toBe('Loading variables…')

    const waiting = deferred<ScopesReply>()
    listScopes.mockImplementationOnce(() => waiting.promise)
    render(STOPPED)
    expect(container.textContent).toBe('Loading variables…')

    waiting.resolve(scopesOk())
    await flush()
    expect(treeItems().length).toBeGreaterThan(0)
  })

  it('renders scopes and auto-expands the first non-expensive scope only', async () => {
    render(STOPPED)
    await flush()

    expect(listScopes).toHaveBeenCalledWith({ frameId: 10 })
    expect(listVariables).toHaveBeenCalledTimes(1)
    expect(listVariables).toHaveBeenCalledWith({ handle: 'dv-1' })
    expect(rowTexts()).toEqual(['▾Locals', '▸count:3', '▸user:User', '▸Globals'].map(fixLeaf))

    const tree = container.querySelector('[role="tree"]')
    expect(tree?.getAttribute('aria-label')).toBe('Variables')
    expect(
      treeItems().map((item) => [
        item.getAttribute('aria-level'),
        item.getAttribute('aria-expanded')
      ])
    ).toEqual([
      ['1', 'true'],
      ['2', null],
      ['2', 'false'],
      ['1', 'false']
    ])
    expect(container.innerHTML).not.toContain('dv-')
  })

  it('expands and collapses nested variables lazily', async () => {
    render(STOPPED)
    await flush()

    const user = treeItems()[2]
    click(user)
    expect(rowTexts()).toContain('Loading variables…')
    await flush()

    expect(listVariables).toHaveBeenLastCalledWith({ handle: 'dv-3' })
    expect(rowTexts()).toContain(fixLeaf('▸name:"Ada"'))
    expect(treeItems()[3]?.getAttribute('aria-level')).toBe('3')

    click(treeItems()[2])
    expect(rowTexts()).not.toContain(fixLeaf('▸name:"Ada"'))

    click(treeItems()[2])
    expect(rowTexts()).toContain(fixLeaf('▸name:"Ada"'))
    // 同じ停止の中で開き直しても、もう一度は頼まない
    expect(listVariables.mock.calls.filter(([request]) => request.handle === 'dv-3')).toHaveLength(
      1
    )
  })

  it('loads an expensive scope only when the user expands it', async () => {
    render(STOPPED)
    await flush()

    expect(listVariables).not.toHaveBeenCalledWith({ handle: 'dv-2' })

    click(treeItems().at(-1))
    await flush()

    expect(listVariables).toHaveBeenCalledWith({ handle: 'dv-2' })
    expect(rowTexts().at(-1)).toBe('No variables.')
  })

  it('shows empty scopes, unavailable scopes, and IPC failures', async () => {
    listScopes.mockResolvedValueOnce({ ok: true, data: { result: { status: 'ok', scopes: [] } } })
    render(STOPPED)
    await flush()
    expect(container.textContent).toBe('This stack frame has no scopes.')

    listScopes.mockResolvedValueOnce({
      ok: true,
      data: { result: { status: 'unavailable', reason: 'stale' } }
    })
    render(STOPPED, 10, 2)
    await flush()
    expect(container.textContent).toBe('These variables are no longer current.')

    listScopes.mockResolvedValueOnce({ ok: false })
    render(STOPPED, 10, 3)
    await flush()
    expect(container.textContent).toBe('The debug adapter could not provide these variables.')
  })

  it('shows unavailable and truncated notices inside the tree', async () => {
    listVariables.mockResolvedValueOnce({
      ok: true,
      data: { result: { status: 'unavailable', reason: 'limit' } }
    })
    render(STOPPED)
    await flush()
    expect(rowTexts()[1]).toBe('Too many variables are expanded for this pause.')

    listVariables.mockResolvedValueOnce(
      variablesOk([{ name: 'first', value: '1', handle: null }], true)
    )
    render(STOPPED, 10, 2)
    await flush()
    expect(rowTexts().slice(1, 3)).toEqual([fixLeaf('▸first:1'), 'Only the first items are shown.'])
  })

  it('clears the tree and ignores late responses when the call stack snapshot changes', async () => {
    const lateScopes = deferred<ScopesReply>()
    listScopes.mockImplementationOnce(() => lateScopes.promise)
    render(STOPPED, 10, 1)

    // continue → running: snapshot は idle に戻る
    render(EMPTY_DEBUG_CALL_STACK, null, 2)
    lateScopes.resolve(scopesOk())
    await flush()

    expect(container.textContent).toBe('Variables are shown while the program is paused.')
    expect(treeItems()).toHaveLength(0)
    expect(listVariables).not.toHaveBeenCalled()
  })

  it('refetches for a new stop even when the frame id is reused', async () => {
    render(STOPPED, 10, 1)
    await flush()
    click(treeItems()[2])
    await flush()
    expect(rowTexts()).toContain(fixLeaf('▸name:"Ada"'))

    render(STOPPED, 10, 2)
    // 前の停止の展開は持ち越さない
    expect(container.textContent).toBe('Loading variables…')
    await flush()

    expect(listScopes).toHaveBeenCalledTimes(2)
    expect(rowTexts()).not.toContain(fixLeaf('▸name:"Ada"'))
  })

  it('follows the call stack frame selection, including frames outside the workspace', async () => {
    render(STOPPED, 10, 1)
    await flush()

    render(STOPPED, 11, 1)
    await flush()

    expect(listScopes).toHaveBeenLastCalledWith({ frameId: 11 })
  })

  it('supports keyboard navigation with the ARIA tree pattern', async () => {
    render(STOPPED)
    await flush()

    const locals = treeItems()[0]
    expect(locals?.getAttribute('tabindex')).toBe('0')
    expect(treeItems()[1]?.getAttribute('tabindex')).toBe('-1')

    key(locals, 'ArrowLeft')
    expect(treeItems()[0]?.getAttribute('aria-expanded')).toBe('false')

    key(treeItems()[0], 'ArrowRight')
    expect(treeItems()[0]?.getAttribute('aria-expanded')).toBe('true')

    key(treeItems()[0], 'ArrowDown')
    expect(document.activeElement).toBe(treeItems()[1])

    key(treeItems()[1], 'ArrowDown')
    key(treeItems()[2], 'Enter')
    await flush()
    expect(treeItems()[2]?.getAttribute('aria-expanded')).toBe('true')

    key(treeItems()[3], 'ArrowLeft')
    expect(document.activeElement).toBe(treeItems()[2])
  })
})

/** 葉には twisty の記号が出ない（空）。期待値の書きやすさのために `▸` を外す。 */
function fixLeaf(text: string): string {
  return text.startsWith('▸count') || text.startsWith('▸name') || text.startsWith('▸first')
    ? text.slice(1)
    : text
}
