import { describe, expect, it } from 'vitest'
import { EMPTY_DEBUG_CALL_STACK, type DebugCallStackSnapshot } from '@shared/debug'
import {
  findCallStackFrame,
  resolveSelectedFrameId,
  selectDefaultFrameId
} from './callStackSelection'

function frame(id: number) {
  return {
    id,
    name: `frame${String(id)}`,
    line: 1,
    column: 1,
    source: { kind: 'workspace' as const, relativePath: 'src/app.ts', name: 'app.ts' }
  }
}

const SNAPSHOT: DebugCallStackSnapshot = {
  status: 'stopped',
  activeThreadId: 2,
  threads: [
    { id: 1, name: 'worker', stopped: false, frames: [] },
    { id: 2, name: 'main', stopped: true, frames: [frame(20), frame(21)] }
  ]
}

describe('call stack frame selection', () => {
  it('defaults to the top frame of the stopped thread', () => {
    expect(selectDefaultFrameId(SNAPSHOT)).toBe(20)
    expect(selectDefaultFrameId({ ...SNAPSHOT, activeThreadId: null })).toBe(20)
  })

  it('has no default while idle, loading, or without frames', () => {
    expect(selectDefaultFrameId(EMPTY_DEBUG_CALL_STACK)).toBeNull()
    expect(selectDefaultFrameId({ ...SNAPSHOT, status: 'loading' })).toBeNull()
    expect(
      selectDefaultFrameId({ status: 'stopped', activeThreadId: null, threads: [] })
    ).toBeNull()
  })

  it('keeps a user selection only for the same snapshot version', () => {
    expect(resolveSelectedFrameId(SNAPSHOT, 3, { version: 3, frameId: 21 })).toBe(21)
    // 次の停止では frame id が再利用されうるため、同じ数でも持ち越さない
    expect(resolveSelectedFrameId(SNAPSHOT, 4, { version: 3, frameId: 21 })).toBe(20)
  })

  it('falls back to the top frame when the selected frame is gone', () => {
    expect(resolveSelectedFrameId(SNAPSHOT, 3, { version: 3, frameId: 99 })).toBe(20)
    expect(
      resolveSelectedFrameId(EMPTY_DEBUG_CALL_STACK, 3, { version: 3, frameId: 20 })
    ).toBeNull()
  })

  it('finds frames across threads', () => {
    expect(findCallStackFrame(SNAPSHOT, 21)?.name).toBe('frame21')
    expect(findCallStackFrame(SNAPSHOT, 1)).toBeNull()
  })
})
