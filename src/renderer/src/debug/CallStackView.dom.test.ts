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

function render(snapshot: DebugCallStackSnapshot, openFileAt = vi.fn()): typeof openFileAt {
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
        { value: { snapshot } },
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

  it('keeps workspace-external frames visible but disabled', () => {
    const openFileAt = render({
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
              name: 'external',
              source: { kind: 'unavailable', name: 'External source', reason: 'outside-workspace' },
              line: 12,
              column: 1
            }
          ]
        }
      ]
    })

    const button = container.querySelector('button.fx-debug-call-stack__frame')

    expect(container.textContent).toContain('external')
    expect(button).toHaveProperty('disabled', true)

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(openFileAt).not.toHaveBeenCalled()
  })
})
