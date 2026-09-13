/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EMPTY_DEBUG_CALL_STACK,
  type DebugCallStackSnapshot,
  type DebugEvaluateResult,
  type DebugVariablesResult
} from '@shared/debug'
import { I18nContext } from '../i18n/context'
import { createTranslator } from '../i18n/messages'
import { CallStackContext } from './callStackContext'
import { EvaluateView } from './EvaluateView'

type EvaluateReply = { ok: true; data: { result: DebugEvaluateResult } } | { ok: false }
type VariablesReply = { ok: true; data: { result: DebugVariablesResult } } | { ok: false }

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

const STOPPED: DebugCallStackSnapshot = {
  status: 'stopped',
  activeThreadId: 1,
  stop: { sequence: 1, reason: 'breakpoint', exception: null },
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

function unavailable(reason: 'not-stopped' | 'stale' | 'failed' | 'timeout'): EvaluateReply {
  return { ok: true, data: { result: { status: 'unavailable', reason } } }
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
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  evaluate = vi.fn(async () => leaf('3', 'number'))
  listVariables = vi.fn(async ({ handle }: { handle: string }) =>
    handle === 'dv-9'
      ? variablesOk([
          { name: 'name', value: '"Ada"', handle: null },
          { name: 'address', value: '{…}', handle: 'dv-10' }
        ])
      : variablesOk([{ name: 'city', value: '"London"', handle: null }])
  )
  ;(globalThis as { fluvix?: unknown }).fluvix = { debug: { evaluate, listVariables } }
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
      createElement(EvaluateView)
    )
  )

  act(() => root.render(node))
}

function input(): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('.fx-debug-evaluate__input')
}

function submitButton(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('.fx-debug-evaluate__submit')
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
  const form = container.querySelector('.fx-debug-evaluate__form')

  act(() => {
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

function click(element: Element | null | undefined): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function rowTexts(): string[] {
  return [...container.querySelectorAll('.fx-debug-variables__row')].map(
    (row) => row.textContent ?? ''
  )
}

function resultText(): string {
  return container.querySelector('.fx-debug-evaluate__value')?.textContent ?? ''
}

describe('EvaluateView', () => {
  it('does not offer evaluation while nothing is stopped', () => {
    render(EMPTY_DEBUG_CALL_STACK, null)

    expect(container.textContent).toBe('Expressions are evaluated while the program is paused.')
    expect(input()).toBeNull()
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('asks for a frame before offering evaluation', () => {
    render(STOPPED, null)

    expect(container.textContent).toBe('Select a stack frame to evaluate an expression.')
    expect(input()).toBeNull()
  })

  it('evaluates the typed expression in the selected frame, as repl', async () => {
    render(STOPPED)

    expect(submitButton()?.disabled).toBe(true)

    type('count')
    expect(submitButton()?.disabled).toBe(false)

    submit()
    await flush()

    expect(evaluate).toHaveBeenCalledWith({ expression: 'count', frameId: 10, context: 'repl' })
    expect(resultText()).toContain('count')
    expect(resultText()).toContain('3')
    expect(resultText()).toContain('(number)')
  })

  it('sends nothing for a blank expression', () => {
    render(STOPPED)
    type('   ')

    expect(submitButton()?.disabled).toBe(true)

    submit()

    expect(evaluate).not.toHaveBeenCalled()
  })

  it('shows a pending state while the adapter is thinking', async () => {
    const waiting = deferred<EvaluateReply>()
    evaluate.mockImplementationOnce(() => waiting.promise)
    render(STOPPED)
    type('count')
    submit()

    expect(container.textContent).toContain('Evaluating…')

    waiting.resolve(leaf('3'))
    await flush()

    expect(container.textContent).not.toContain('Evaluating…')
  })

  it('expands the result through the Session 6-6 variables path', async () => {
    evaluate.mockImplementationOnce(async () => expandable('{ name: "Ada" }', 'dv-9'))
    render(STOPPED)
    type('user')
    submit()
    await flush()

    expect(listVariables).not.toHaveBeenCalled()

    click(container.querySelector('.fx-debug-evaluate__value'))
    await flush()

    expect(listVariables).toHaveBeenCalledWith({ handle: 'dv-9' })
    expect(rowTexts()).toEqual(['name:"Ada"', '▸address:{…}'])

    /* さらに1段（子の handle も同じ経路に載る）。 */
    click(container.querySelectorAll('.fx-debug-variables__row')[1])
    await flush()

    expect(listVariables).toHaveBeenCalledWith({ handle: 'dv-10' })
    expect(rowTexts()).toEqual(['name:"Ada"', '▾address:{…}', 'city:"London"'])
  })

  it('does not offer expansion for a leaf result', async () => {
    render(STOPPED)
    type('count')
    submit()
    await flush()

    click(container.querySelector('.fx-debug-evaluate__value'))
    await flush()

    expect(listVariables).not.toHaveBeenCalled()
    expect(
      container.querySelector('.fx-debug-evaluate__value')?.getAttribute('data-expandable')
    ).toBe('false')
  })

  it.each([
    ['stale', 'This result is no longer current.'],
    ['failed', 'The debug adapter could not evaluate this expression.'],
    ['timeout', 'The debug adapter did not answer in time.'],
    ['not-stopped', 'Expressions are evaluated while the program is paused.']
  ] as const)('shows the %s reason without any adapter wording', async (reason, message) => {
    evaluate.mockImplementationOnce(async () => unavailable(reason))
    render(STOPPED)
    type('count')
    submit()
    await flush()

    expect(container.textContent).toContain(message)
    expect(container.querySelector('.fx-debug-evaluate__value')).toBeNull()
  })

  it('treats a failed IPC call as a failure, not a crash', async () => {
    evaluate.mockImplementationOnce(async () => ({ ok: false }))
    render(STOPPED)
    type('count')
    submit()
    await flush()

    expect(container.textContent).toContain('The debug adapter could not evaluate this expression.')
  })

  /**
   * 新しい要求が古い要求を追い越した。**最後に送ったものの答えだけ**を当てる
   * （EvaluateView の要求の通し番号）。
   */
  it('ignores an answer that a newer request has overtaken', async () => {
    const slow = deferred<EvaluateReply>()
    evaluate.mockImplementationOnce(() => slow.promise)
    render(STOPPED)
    type('slow')
    submit()

    evaluate.mockImplementationOnce(async () => leaf('fast'))
    type('fast')
    submit()
    await flush()

    expect(resultText()).toContain('fast')

    slow.resolve(leaf('slow'))
    await flush()

    expect(resultText()).toContain('fast')
    expect(resultText()).not.toContain('slow')
  })

  /** 停止 / Workspace / セッションが変わると版が進み、面ごと作り直される。 */
  it('drops the previous result when the call stack snapshot is replaced', async () => {
    render(STOPPED)
    type('count')
    submit()
    await flush()

    expect(resultText()).toContain('3')

    render(STOPPED, 10, 2)

    expect(container.querySelector('.fx-debug-evaluate__value')).toBeNull()
    expect(input()?.value).toBe('')
    expect(container.textContent).toContain(
      'Enter an expression to evaluate it in the selected stack frame.'
    )
  })

  it('drops the previous result when another frame is selected', async () => {
    evaluate.mockImplementationOnce(async () => expandable('{ name: "Ada" }', 'dv-9'))
    render(STOPPED)
    type('user')
    submit()
    await flush()
    click(container.querySelector('.fx-debug-evaluate__value'))
    await flush()

    expect(rowTexts().length).toBeGreaterThan(0)

    render(STOPPED, 11)

    expect(container.querySelector('.fx-debug-evaluate__value')).toBeNull()
    expect(rowTexts()).toEqual([])
  })

  it('drops the previous result when the program resumes', async () => {
    render(STOPPED)
    type('count')
    submit()
    await flush()

    render(EMPTY_DEBUG_CALL_STACK, null, 2)

    expect(container.textContent).toBe('Expressions are evaluated while the program is paused.')
  })

  /** 前の式の展開を、新しい結果の下に持ち越さない。 */
  it('drops the previous expansion when a new expression is evaluated', async () => {
    evaluate.mockImplementationOnce(async () => expandable('{ name: "Ada" }', 'dv-9'))
    render(STOPPED)
    type('user')
    submit()
    await flush()
    click(container.querySelector('.fx-debug-evaluate__value'))
    await flush()

    expect(rowTexts().length).toBe(2)

    evaluate.mockImplementationOnce(async () => leaf('3'))
    type('count')
    submit()
    await flush()

    expect(rowTexts()).toEqual([])
  })

  it('never asks main for anything but the three evaluate fields', async () => {
    render(STOPPED)
    type('user.name')
    submit()
    await flush()

    for (const call of evaluate.mock.calls) {
      expect(Object.keys(call[0]).sort()).toEqual(['context', 'expression', 'frameId'])
    }
  })
})
