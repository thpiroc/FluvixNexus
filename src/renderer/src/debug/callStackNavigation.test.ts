import { describe, expect, it, vi } from 'vitest'
import type { DebugCallStackFrame } from '@shared/debug'
import { openCallStackFrame } from './callStackNavigation'

function frame(overrides: Partial<DebugCallStackFrame> = {}): DebugCallStackFrame {
  return {
    id: 1,
    name: 'main',
    line: 10,
    column: 2,
    source: { kind: 'workspace', relativePath: 'src/app.ts', name: 'app.ts' },
    ...overrides
  }
}

describe('call stack frame navigation', () => {
  it('opens workspace frames through the existing editor opener shape', () => {
    const openFileAt = vi.fn()

    expect(openCallStackFrame(frame(), { openFileAt })).toBe(true)
    expect(openFileAt).toHaveBeenCalledWith({
      relativePath: 'src/app.ts',
      name: 'app.ts',
      line: 10,
      column: 2
    })
  })

  it('uses column 1 when the adapter column is invalid or missing', () => {
    const openFileAt = vi.fn()

    expect(openCallStackFrame(frame({ column: null }), { openFileAt })).toBe(true)
    expect(openFileAt).toHaveBeenCalledWith(expect.objectContaining({ column: 1 }))
  })

  it('does not open workspace-external or location-less frames', () => {
    const openFileAt = vi.fn()

    expect(
      openCallStackFrame(
        frame({
          source: { kind: 'unavailable', name: 'External source', reason: 'outside-workspace' }
        }),
        { openFileAt }
      )
    ).toBe(false)
    expect(openCallStackFrame(frame({ line: null }), { openFileAt })).toBe(false)
    expect(openFileAt).not.toHaveBeenCalled()
  })
})
