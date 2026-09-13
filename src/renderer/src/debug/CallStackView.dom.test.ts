/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DebugCallStackSnapshot } from '@shared/debug'
import { EditorContext } from '../editor/context'
import type { EditorController } from '../editor/useEditorSession'
import { I18nContext } from '../i18n/context'
import { createTranslator } from '../i18n/messages'
import { CallStackContext } from './callStackContext'
import { CallStackView } from './CallStackView'

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

function render(
  snapshot: DebugCallStackSnapshot,
  openFileAt = vi.fn(),
  selectFrame = vi.fn(),
  selectedFrameId: number | null = null
): typeof openFileAt {
  const t = createTranslator('en')
  const editor = { openFileAt } as unknown as EditorController
  const node: ReactElement = createElement(
    I18nContext.Provider,
    { value: { language: 'en', setLanguage: () => {}, t } },
    createElement(
      EditorContext.Provider,
      { value: editor },
      createElement(
        CallStackContext.Provider,
        { value: { snapshot, version: 1, selectedFrameId, selectFrame } },
        createElement(CallStackView)
      )
    )
  )

  act(() => root.render(node))

  return openFileAt
}

describe('CallStackView', () => {
  it('renders stack frames and opens workspace frames through EditorContext', () => {
    const openFileAt = render({
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
              source: { kind: 'workspace', relativePath: 'src/app.ts', name: 'app.ts' },
              line: 12,
              column: 4
            }
          ]
        }
      ]
    })

    expect(container.textContent).toContain('run')
    expect(container.textContent).toContain('src/app.ts:12')

    const button = container.querySelector('button.fx-debug-call-stack__frame')
    expect(button).not.toBeNull()

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(openFileAt).toHaveBeenCalledWith({
      relativePath: 'src/app.ts',
      name: 'app.ts',
      line: 12,
      column: 4
    })
  })

  it('selects workspace-external frames for Variables but never opens them (Session 6-6)', () => {
    const selectFrame = vi.fn()
    const openFileAt = render(
      {
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
                name: 'external',
                source: {
                  kind: 'unavailable',
                  name: 'External source',
                  reason: 'outside-workspace'
                },
                line: 12,
                column: 1
              }
            ]
          }
        ]
      },
      vi.fn(),
      selectFrame
    )

    const button = container.querySelector('button.fx-debug-call-stack__frame')

    expect(container.textContent).toContain('external')
    expect(button?.getAttribute('data-openable')).toBe('false')
    expect(button?.getAttribute('title')).toBe('Source is outside the Workspace or unavailable.')

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(selectFrame).toHaveBeenCalledWith(10)
    expect(openFileAt).not.toHaveBeenCalled()
  })

  it('marks the selected frame with aria-current and selects on click (Session 6-6)', () => {
    const selectFrame = vi.fn()
    const frame = (id: number, name: string) => ({
      id,
      name,
      source: { kind: 'workspace' as const, relativePath: 'src/app.ts', name: 'app.ts' },
      line: id,
      column: 1
    })

    render(
      {
        status: 'stopped',
        activeThreadId: 1,
        stop: { sequence: 1, reason: 'breakpoint', exception: null },
        threads: [
          { id: 1, name: 'main', stopped: true, frames: [frame(10, 'top'), frame(11, 'caller')] }
        ]
      },
      vi.fn(),
      selectFrame,
      11
    )

    const buttons = [...container.querySelectorAll('button.fx-debug-call-stack__frame')]

    expect(buttons.map((button) => button.getAttribute('aria-current'))).toEqual([null, 'true'])

    act(() => {
      buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(selectFrame).toHaveBeenCalledWith(10)
  })

  it('marks the actual execution frame separately from the selected frame (Session 6-13)', () => {
    const frame = (id: number, name: string) => ({
      id,
      name,
      source: { kind: 'workspace' as const, relativePath: 'src/app.ts', name: 'app.ts' },
      line: id,
      column: 1
    })

    render(
      {
        status: 'stopped',
        activeThreadId: 2,
        stop: { sequence: 3, reason: 'step', exception: null },
        threads: [
          { id: 1, name: 'worker', stopped: false, frames: [] },
          { id: 2, name: 'main', stopped: true, frames: [frame(10, 'top'), frame(11, 'caller')] }
        ]
      },
      vi.fn(),
      vi.fn(),
      11
    )

    const buttons = [...container.querySelectorAll('button.fx-debug-call-stack__frame')]

    expect(buttons.map((button) => button.getAttribute('data-current'))).toEqual(['true', 'false'])
    expect(buttons.map((button) => button.getAttribute('data-selected'))).toEqual(['false', 'true'])
    expect(buttons[0]?.querySelector('.fx-debug-call-stack__frame-badge')?.textContent).toBe(
      'Current'
    )
    expect(buttons[1]?.querySelector('.fx-debug-call-stack__frame-badge')).toBeNull()
  })
})
