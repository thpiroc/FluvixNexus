/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EMPTY_DEBUG_CALL_STACK,
  type DebugCallStackSnapshot,
  type DebugConsoleEntry,
  type DebugEvaluateResult,
  type DebugVariablesResult
} from '@shared/debug'
import type { WorkspaceFolder } from '@shared/workspace'
import { I18nContext } from '../i18n/context'
import { createTranslator } from '../i18n/messages'
import { WorkspaceFolderContext, type WorkspaceFolderController } from '../workspaceFolder/context'
import { CallStackContext } from './callStackContext'
import { DebugConsoleView } from './DebugConsoleView'

type EvaluateReply = { ok: true; data: { result: DebugEvaluateResult } } | { ok: false }
type VariablesReply = { ok: true; data: { result: DebugVariablesResult } } | { ok: false }
type ConsoleListener = (event: {
  readonly workspaceId: string
  readonly entry: DebugConsoleEntry
}) => void

interface EvaluateRequest {
  readonly expression: string
  readonly frameId: number
  readonly context: string
}

let container: HTMLDivElement
let root: Root
let evaluate: ReturnType<typeof vi.fn<(request: EvaluateRequest) => Promise<EvaluateReply>>>
let listVariables: ReturnType<
  typeof vi.fn<(request: { handle: string }) => Promise<VariablesReply>>
>
let consoleListeners: ConsoleListener[]

const WORKSPACE: WorkspaceFolder = {
  id: 'workspace-1',
  rootPath: 'D:\\Workspace',
  displayName: 'Workspace',
  openedAt: 1,
  exists: true
}

const OTHER_WORKSPACE: WorkspaceFolder = {
  ...WORKSPACE,
  id: 'workspace-2',
  rootPath: 'D:\\Other'
}

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
        }
      ]
    }
  ]
}

function leaf(value: string, type: string | null = null): EvaluateReply {
  return {
    ok: true,
    data: {
      result: {
        status: 'ok',
        value: { handle: null, value, type, kind: 'other', namedCount: null, indexedCount: null }
      }
    }
  }
}

function expandable(value: string, handle: string): EvaluateReply {
  return {
    ok: true,
    data: {
      result: {
        status: 'ok',
        value: {
          handle,
          value,
          type: 'User',
          kind: 'class',
          namedCount: 1,
          indexedCount: null
        }
      }
    }
  }
}

function variablesOk(
  entries: { name: string; value: string; handle: string | null }[]
): VariablesReply {
  return {
    ok: true,
    data: {
      result: {
        status: 'ok',
        truncated: false,
        variables: entries.map((entry) => ({
          ...entry,
          type: null,
          kind: 'other' as const,
          namedCount: null,
          indexedCount: null
        }))
      }
    }
  }
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  consoleListeners = []
  evaluate = vi.fn(async () => leaf('3', 'number'))
  listVariables = vi.fn(async () => variablesOk([{ name: 'name', value: '"Ada"', handle: null }]))
  ;(globalThis as { fluvix?: unknown }).fluvix = {
    debug: {
      evaluate,
      listVariables,
      onConsoleEntry: (listener: ConsoleListener) => {
        consoleListeners.push(listener)

        return () => {
          consoleListeners = consoleListeners.filter((candidate) => candidate !== listener)
        }
      }
    }
  }
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  delete (globalThis as { fluvix?: unknown }).fluvix
})

function render(
  snapshot: DebugCallStackSnapshot = STOPPED,
  selectedFrameId: number | null = 10,
  workspace: WorkspaceFolder | null = WORKSPACE,
  version = 1
): void {
  const t = createTranslator('en')
  const workspaceController: WorkspaceFolderController = {
    status: 'ready',
    workspace,
    unavailableRootPath: null,
    error: null,
    busy: false,
    openFolder: () => {},
    closeWorkspace: () => {}
  }
  const node: ReactElement = createElement(
    I18nContext.Provider,
    { value: { language: 'en', setLanguage: () => {}, t } },
    createElement(
      WorkspaceFolderContext.Provider,
      { value: workspaceController },
      createElement(
        CallStackContext.Provider,
        { value: { snapshot, version, selectedFrameId, selectFrame: () => {} } },
        createElement(DebugConsoleView)
      )
    )
  )

  act(() => root.render(node))
}

function input(): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('.fx-debug-console__input')
}

function type(text: string): void {
  const element = input()

  if (element === null) {
    throw new Error('no input')
  }

  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set

    setter?.call(element, text)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function submit(): void {
  const form = container.querySelector('.fx-debug-console__form')

  act(() => {
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

function keyDown(key: string): void {
  act(() => {
    input()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

function click(element: Element | null | undefined): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function emitConsole(workspaceId: string, entry: DebugConsoleEntry): void {
  act(() => {
    for (const listener of consoleListeners) {
      listener({ workspaceId, entry })
    }
  })
}

function entryText(): string {
  return container.querySelector('.fx-debug-console__entries')?.textContent ?? ''
}

describe('DebugConsoleView', () => {
  it('evaluates typed input through the safe repl evaluate API', async () => {
    render()
    type('count')
    submit()
    await flush()

    expect(evaluate).toHaveBeenCalledWith({ expression: 'count', frameId: 10, context: 'repl' })
    expect(entryText()).toContain('>count')
    expect(entryText()).toContain('<count:3(number)')
  })

  it('keeps input disabled until a stopped frame is selected', () => {
    render(EMPTY_DEBUG_CALL_STACK, null)
    expect(input()?.disabled).toBe(true)
    expect(container.textContent).toContain(
      'Debug Console evaluates expressions while the program is paused.'
    )

    render(STOPPED, null)
    expect(input()?.disabled).toBe(true)
    expect(container.textContent).toContain('Select a stack frame to evaluate an expression.')
  })

  it('renders output events for the active workspace only and clears on workspace switch', () => {
    render()

    emitConsole('workspace-2', {
      id: 'remote-ignored',
      kind: 'stdout',
      text: 'other',
      timestamp: 1,
      source: null,
      handle: null
    })
    emitConsole('workspace-1', {
      id: 'remote-1',
      kind: 'stderr',
      text: 'boom',
      timestamp: 2,
      source: {
        source: { kind: 'workspace', relativePath: 'src/app.ts', name: 'app.ts' },
        line: 7,
        column: null
      },
      handle: null
    })

    expect(entryText()).toContain('errboomsrc/app.ts:7')
    expect(entryText()).not.toContain('other')

    render(STOPPED, 10, OTHER_WORKSPACE, 2)

    expect(entryText()).toContain('No console output.')
    expect(entryText()).not.toContain('boom')
  })

  it('keeps command history and clears entries without clearing history', async () => {
    render()
    type('first')
    submit()
    await flush()
    type('second')
    submit()
    await flush()

    click(container.querySelector('.fx-debug-console__button'))

    expect(entryText()).toContain('No console output.')

    keyDown('ArrowUp')
    expect(input()?.value).toBe('second')
    keyDown('ArrowUp')
    expect(input()?.value).toBe('first')
    keyDown('ArrowDown')
    expect(input()?.value).toBe('second')
  })

  it('expands result handles through the variables API and hides raw handles', async () => {
    evaluate.mockImplementationOnce(async () => expandable('{ name: "Ada" }', 'dv-9'))
    render()
    type('user')
    submit()
    await flush()

    expect(JSON.stringify(entryText())).not.toContain('dv-9')

    click(container.querySelector('.fx-debug-console__entry[data-expandable="true"]'))
    await flush()

    expect(listVariables).toHaveBeenCalledWith({ handle: 'dv-9' })
    expect(container.querySelector('.fx-debug-variables__row')?.textContent).toBe('name:"Ada"')
  })

  it('shows evaluate failures as console error entries', async () => {
    evaluate.mockImplementationOnce(async () => ({
      ok: true,
      data: { result: { status: 'unavailable', reason: 'timeout' } }
    }))
    render()
    type('slow')
    submit()
    await flush()

    expect(entryText()).toContain('The debug adapter did not answer in time.')
  })
})
