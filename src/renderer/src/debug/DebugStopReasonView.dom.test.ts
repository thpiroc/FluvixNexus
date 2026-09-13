/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DebugCallStackSnapshot, DebugStopInfo } from '@shared/debug'
import { I18nContext } from '../i18n/context'
import { createTranslator } from '../i18n/messages'
import { CallStackContext } from './callStackContext'
import { DebugStopReasonView } from './DebugStopReasonView'

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
  document.body.innerHTML = ''
})

function snapshot(
  stop: DebugStopInfo | null,
  status: DebugCallStackSnapshot['status'] = 'stopped'
): DebugCallStackSnapshot {
  return { status, activeThreadId: status === 'idle' ? null : 1, threads: [], stop }
}

function render(value: DebugCallStackSnapshot, language: 'en' | 'ja' = 'en'): void {
  const t = createTranslator(language)
  const node: ReactElement = createElement(
    I18nContext.Provider,
    { value: { language, setLanguage: () => {}, t } },
    createElement(
      CallStackContext.Provider,
      { value: { snapshot: value, version: 1, selectedFrameId: null, selectFrame: () => {} } },
      createElement(DebugStopReasonView)
    )
  )

  act(() => root.render(node))
}

describe('DebugStopReasonView', () => {
  it('renders nothing while no session is paused', () => {
    render(snapshot(null, 'idle'))
    expect(container.innerHTML).toBe('')

    render(snapshot(null, 'stopped'))
    expect(container.innerHTML).toBe('')
  })

  it.each([
    ['breakpoint', 'Paused at breakpoint'],
    ['step', 'Paused after step'],
    ['pause', 'Paused manually'],
    ['entry', 'Paused on entry'],
    ['unknown', 'Paused']
  ] as const)('words the %s stop', (reason, text) => {
    render(snapshot({ sequence: 1, reason, exception: null }))

    const status = container.querySelector('[role="status"]')

    expect(status?.getAttribute('data-reason')).toBe(reason)
    expect(status?.getAttribute('aria-label')).toBe('Why the program is paused')
    expect(container.querySelector('.fx-debug-stop-reason__title')?.textContent).toBe(text)
    expect(container.querySelector('.fx-debug-stop-reason__exception')).toBeNull()
  })

  it('shows the exception type, message and break mode for an exception stop', () => {
    render(
      snapshot({
        sequence: 2,
        reason: 'exception',
        exception: { typeName: 'ValueError', message: 'bad value 42', breakMode: 'unhandled' }
      })
    )

    expect(container.querySelector('.fx-debug-stop-reason__title')?.textContent).toBe(
      'Paused on exception'
    )
    expect(container.querySelector('.fx-debug-stop-reason__type')?.textContent).toBe('ValueError')
    expect(container.querySelector('.fx-debug-stop-reason__message')?.textContent).toBe(
      'bad value 42'
    )
    expect(container.querySelector('.fx-debug-stop-reason__message')?.getAttribute('title')).toBe(
      'bad value 42'
    )
    expect(container.querySelector('.fx-debug-stop-reason__mode')?.textContent).toBe('Uncaught')
  })

  it('says details are unavailable when neither type nor message could be read', () => {
    render(
      snapshot({
        sequence: 3,
        reason: 'exception',
        exception: { typeName: null, message: null, breakMode: null }
      })
    )

    expect(container.querySelector('.fx-debug-stop-reason__notice')?.textContent).toBe(
      'Exception details are not available.'
    )
    expect(container.querySelector('.fx-debug-stop-reason__mode')).toBeNull()
  })

  it('follows the display language', () => {
    render(
      snapshot({
        sequence: 4,
        reason: 'exception',
        exception: { typeName: 'KeyError', message: "'k'", breakMode: 'always' }
      }),
      'ja'
    )

    expect(container.textContent).toContain('例外で一時停止中')
    expect(container.textContent).toContain('送出された例外')
    expect(container.textContent).toContain('KeyError')
  })

  it('renders exception text as text, not markup', () => {
    render(
      snapshot({
        sequence: 5,
        reason: 'exception',
        exception: { typeName: '<img src=x>', message: '<b>boom</b>', breakMode: null }
      })
    )

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<b>boom</b>')
  })
})
