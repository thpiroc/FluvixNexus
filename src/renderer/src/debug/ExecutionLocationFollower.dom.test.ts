/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DebugCallStackFrame, DebugCallStackSnapshot } from '@shared/debug'
import { EditorContext } from '../editor/context'
import type { EditorController } from '../editor/useEditorSession'
import { CallStackContext } from './callStackContext'
import { ExecutionLocationFollower } from './ExecutionLocationFollower'

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

function frame(id: number, line: number, inside = true): DebugCallStackFrame {
  return {
    id,
    name: `f${String(id)}`,
    line,
    column: 3,
    source: inside
      ? { kind: 'workspace', relativePath: 'src/main.py', name: 'main.py' }
      : { kind: 'unavailable', name: 'threading.py', reason: 'outside-workspace' }
  }
}

function stopped(
  sequence: number,
  frames: readonly DebugCallStackFrame[],
  status: DebugCallStackSnapshot['status'] = 'stopped'
): DebugCallStackSnapshot {
  return {
    status,
    activeThreadId: 1,
    threads: [{ id: 1, name: 'main', stopped: true, frames }],
    stop: { sequence, reason: 'breakpoint', exception: null }
  }
}

const IDLE: DebugCallStackSnapshot = {
  status: 'idle',
  activeThreadId: null,
  threads: [],
  stop: null
}

function createHarness() {
  const openFileAt = vi.fn()
  const editor = { openFileAt } as unknown as EditorController

  function show(
    snapshot: DebugCallStackSnapshot,
    version: number,
    selectedFrameId: number | null = null
  ): void {
    const node: ReactElement = createElement(
      EditorContext.Provider,
      { value: editor },
      createElement(
        CallStackContext.Provider,
        { value: { snapshot, version, selectedFrameId, selectFrame: () => {} } },
        createElement(ExecutionLocationFollower)
      )
    )

    act(() => root.render(node))
  }

  return { openFileAt, show }
}

describe('ExecutionLocationFollower', () => {
  it('opens the top frame once when the program stops, and draws nothing', () => {
    const harness = createHarness()

    harness.show(stopped(1, [], 'loading'), 1)
    expect(harness.openFileAt).not.toHaveBeenCalled()

    harness.show(stopped(1, [frame(10, 11), frame(11, 30)]), 2)
    expect(harness.openFileAt).toHaveBeenCalledTimes(1)
    expect(harness.openFileAt).toHaveBeenCalledWith({
      relativePath: 'src/main.py',
      name: 'main.py',
      line: 11,
      column: 3
    })
    expect(container.innerHTML).toBe('')
  })

  it('does not pull the editor back when the same stop is re-read or another frame is selected', () => {
    const harness = createHarness()

    harness.show(stopped(1, [frame(10, 11), frame(11, 30)]), 1)
    harness.show(stopped(1, [frame(10, 11), frame(11, 30)]), 2)
    harness.show(stopped(1, [frame(10, 11), frame(11, 30)]), 2, 11)

    expect(harness.openFileAt).toHaveBeenCalledTimes(1)
  })

  it('follows each new stop (step), after continue cleared the snapshot', () => {
    const harness = createHarness()

    harness.show(stopped(1, [frame(10, 11)]), 1)
    harness.show(IDLE, 2)
    harness.show(stopped(2, [frame(10, 12)]), 3)

    expect(harness.openFileAt).toHaveBeenCalledTimes(2)
    expect(harness.openFileAt).toHaveBeenLastCalledWith(expect.objectContaining({ line: 12 }))
  })

  it('does not open a frame outside the workspace, and does not open it later either', () => {
    const harness = createHarness()

    harness.show(stopped(1, [frame(10, 5, false)]), 1)
    harness.show(stopped(1, [frame(10, 5, false)]), 2)

    expect(harness.openFileAt).not.toHaveBeenCalled()
  })
})
