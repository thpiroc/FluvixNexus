import { describe, expect, it } from 'vitest'
import type { DebugCallStackFrame, DebugCallStackSnapshot, DebugStopInfo } from '@shared/debug'
import {
  findCurrentExecutionFrame,
  isOpenableExecutionFrame,
  resolveExecutionFollowTarget
} from './executionLocation'

function frame(id: number, overrides: Partial<DebugCallStackFrame> = {}): DebugCallStackFrame {
  return {
    id,
    name: `frame-${String(id)}`,
    line: id,
    column: 1,
    source: { kind: 'workspace', relativePath: 'src/main.py', name: 'main.py' },
    ...overrides
  }
}

function stop(sequence: number, reason: DebugStopInfo['reason'] = 'breakpoint'): DebugStopInfo {
  return { sequence, reason, exception: null }
}

function stopped(
  frames: readonly DebugCallStackFrame[],
  overrides: Partial<DebugCallStackSnapshot> = {}
): DebugCallStackSnapshot {
  return {
    status: 'stopped',
    activeThreadId: 2,
    threads: [
      { id: 1, name: 'worker', stopped: false, frames: [frame(90)] },
      { id: 2, name: 'main', stopped: true, frames }
    ],
    stop: stop(1),
    ...overrides
  }
}

describe('findCurrentExecutionFrame', () => {
  it('is the top frame of the stopped thread, not of the first thread', () => {
    expect(findCurrentExecutionFrame(stopped([frame(10), frame(11)]))?.id).toBe(10)
  })

  it('is null while not stopped or when the stopped thread has no frames', () => {
    expect(findCurrentExecutionFrame(stopped([frame(10)], { status: 'loading' }))).toBeNull()
    expect(
      findCurrentExecutionFrame({ status: 'idle', activeThreadId: null, threads: [], stop: null })
    ).toBeNull()
    expect(findCurrentExecutionFrame(stopped([]))).toBeNull()
    expect(findCurrentExecutionFrame(stopped([frame(10)], { activeThreadId: null }))).toBeNull()
    expect(findCurrentExecutionFrame(stopped([frame(10)], { activeThreadId: 99 }))).toBeNull()
  })
})

describe('isOpenableExecutionFrame', () => {
  it('opens only workspace frames with a line', () => {
    expect(isOpenableExecutionFrame(frame(1))).toBe(true)
    expect(isOpenableExecutionFrame(frame(1, { line: null }))).toBe(false)
    expect(
      isOpenableExecutionFrame(
        frame(1, { source: { kind: 'unavailable', name: 'os.py', reason: 'outside-workspace' } })
      )
    ).toBe(false)
  })
})

describe('resolveExecutionFollowTarget', () => {
  it('follows a new stop once, to the top frame', () => {
    const snapshot = stopped([frame(10), frame(11)])
    const target = resolveExecutionFollowTarget(snapshot, null)

    expect(target?.sequence).toBe(1)
    expect(target?.frame?.id).toBe(10)
    expect(resolveExecutionFollowTarget(snapshot, 1)).toBeNull()
  })

  it('does not follow again when the same stop is re-read (thread event)', () => {
    const reread = stopped([frame(10), frame(11)], { stop: stop(1) })

    expect(resolveExecutionFollowTarget(reread, 1)).toBeNull()
  })

  it('follows the next stop (step) even when the location is the same line', () => {
    expect(
      resolveExecutionFollowTarget(stopped([frame(10)], { stop: stop(2, 'step') }), 1)?.sequence
    ).toBe(2)
  })

  it('waits while loading and never follows an idle snapshot', () => {
    expect(resolveExecutionFollowTarget(stopped([], { status: 'loading' }), null)).toBeNull()
    expect(
      resolveExecutionFollowTarget(
        { status: 'idle', activeThreadId: null, threads: [], stop: null },
        null
      )
    ).toBeNull()
    expect(resolveExecutionFollowTarget(stopped([frame(10)], { stop: null }), null)).toBeNull()
  })

  it('consumes the stop without a frame when the top frame is outside the workspace', () => {
    const target = resolveExecutionFollowTarget(
      stopped([
        frame(10, { source: { kind: 'unavailable', name: 'lib.py', reason: 'outside-workspace' } })
      ]),
      null
    )

    expect(target).toEqual({ sequence: 1, frame: null })
  })
})
