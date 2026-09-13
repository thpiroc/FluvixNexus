import { describe, expect, it } from 'vitest'
import type { DebugCallStackFrame, DebugCallStackSnapshot } from '@shared/debug'
import {
  isSameExecutionLineDecorations,
  toExecutionLineDecorations
} from './executionLineDecorations'

function frame(
  id: number,
  line: number | null,
  relativePath: string | null = 'src/main.py'
): DebugCallStackFrame {
  return {
    id,
    name: `frame-${String(id)}`,
    line,
    column: 1,
    source:
      relativePath === null
        ? { kind: 'unavailable', name: 'threading.py', reason: 'outside-workspace' }
        : { kind: 'workspace', relativePath, name: relativePath.split('/').at(-1) ?? relativePath }
  }
}

function stopped(frames: readonly DebugCallStackFrame[]): DebugCallStackSnapshot {
  return {
    status: 'stopped',
    activeThreadId: 1,
    threads: [{ id: 1, name: 'main', stopped: true, frames }],
    stop: { sequence: 1, reason: 'breakpoint', exception: null }
  }
}

describe('toExecutionLineDecorations', () => {
  it('marks the top frame line as the current execution line', () => {
    const decorations = toExecutionLineDecorations(
      stopped([frame(10, 11), frame(11, 20)]),
      10,
      'src/main.py'
    )

    expect(decorations).toEqual([
      {
        line: 11,
        kind: 'current',
        lineClassName: 'fx-debug-execution-line fx-debug-execution-line--current',
        glyphClassName: 'fx-debug-execution-glyph fx-debug-execution-glyph--current',
        messageKey: 'debug.executionLine.current'
      }
    ])
  })

  it('keeps the current line and adds a different mark for a selected lower frame', () => {
    const decorations = toExecutionLineDecorations(
      stopped([frame(10, 11), frame(11, 20)]),
      11,
      'src/main.py'
    )

    expect(decorations.map((d) => [d.line, d.kind])).toEqual([
      [11, 'current'],
      [20, 'selected']
    ])
    expect(decorations[1]?.glyphClassName).toContain('--selected')
    expect(decorations[1]?.messageKey).toBe('debug.executionLine.selected')
  })

  it('shows only the file that each frame belongs to', () => {
    const snapshot = stopped([frame(10, 2, 'src/helper.py'), frame(11, 20, 'src/main.py')])

    expect(toExecutionLineDecorations(snapshot, 11, 'src/helper.py').map((d) => d.kind)).toEqual([
      'current'
    ])
    expect(toExecutionLineDecorations(snapshot, 11, 'src/main.py').map((d) => d.kind)).toEqual([
      'selected'
    ])
    expect(toExecutionLineDecorations(snapshot, 11, 'src/other.py')).toEqual([])
  })

  it('does not stack a selected mark on the current line (recursion on the same line)', () => {
    expect(
      toExecutionLineDecorations(stopped([frame(10, 5), frame(11, 5)]), 11, 'src/main.py').map(
        (d) => d.kind
      )
    ).toEqual(['current'])
  })

  it('draws nothing for workspace-outside or location-less frames', () => {
    expect(toExecutionLineDecorations(stopped([frame(10, 3, null)]), 10, 'src/main.py')).toEqual([])
    expect(toExecutionLineDecorations(stopped([frame(10, null)]), 10, 'src/main.py')).toEqual([])
  })

  it('draws nothing while loading or idle (continue / stop / terminated clear the marks)', () => {
    expect(
      toExecutionLineDecorations(
        { ...stopped([frame(10, 11)]), status: 'loading' },
        10,
        'src/main.py'
      )
    ).toEqual([])
    expect(
      toExecutionLineDecorations(
        { status: 'idle', activeThreadId: null, threads: [], stop: null },
        null,
        'src/main.py'
      )
    ).toEqual([])
  })

  it('has no colors, only class names', () => {
    const serialized = JSON.stringify(
      toExecutionLineDecorations(stopped([frame(10, 11), frame(11, 20)]), 11, 'src/main.py')
    )

    expect(serialized).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/)
  })
})

describe('isSameExecutionLineDecorations', () => {
  it('compares line and kind only', () => {
    const a = toExecutionLineDecorations(stopped([frame(10, 11)]), 10, 'src/main.py')
    const b = toExecutionLineDecorations(stopped([frame(99, 11)]), 99, 'src/main.py')
    const c = toExecutionLineDecorations(stopped([frame(10, 12)]), 10, 'src/main.py')

    expect(isSameExecutionLineDecorations(a, b)).toBe(true)
    expect(isSameExecutionLineDecorations(a, c)).toBe(false)
    expect(isSameExecutionLineDecorations(a, [])).toBe(false)
  })
})
