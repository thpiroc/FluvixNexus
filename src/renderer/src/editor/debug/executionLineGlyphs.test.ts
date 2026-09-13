import { describe, expect, it } from 'vitest'
import type { DebugCallStackSnapshot } from '@shared/debug'
import { toExecutionLineDecorations } from './executionLineDecorations'
import {
  createExecutionLineController,
  toExecutionLineModelDecorations,
  type ExecutionLineEditor,
  type ExecutionLineModelDecoration
} from './executionLineGlyphs'

/**
 * 実行位置の decoration を Monaco へ当てる層（Session 6-13）。**Monaco は読み込まない** ──
 * breakpointGlyphs.test.ts と同じく偽のエディタで通す。
 */

function snapshot(line: number, relativePath = 'src/main.py'): DebugCallStackSnapshot {
  return {
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
            name: 'main',
            line,
            column: 1,
            source: { kind: 'workspace', relativePath, name: 'main.py' }
          }
        ]
      }
    ],
    stop: { sequence: line, reason: 'step', exception: null }
  }
}

const IDLE: DebugCallStackSnapshot = {
  status: 'idle',
  activeThreadId: null,
  threads: [],
  stop: null
}

function createFakeEditor() {
  const applied: (readonly ExecutionLineModelDecoration[])[] = []
  const collections: number[] = []
  let clears = 0
  let lineCount = 100
  let hasModel = true

  const editor: ExecutionLineEditor = {
    createDecorationsCollection: () => {
      collections.push(collections.length)

      return {
        set: (decorations) => {
          applied.push(decorations)
        },
        clear: () => {
          clears += 1
        }
      }
    },
    getModel: () => (hasModel ? { getLineCount: () => lineCount } : null)
  }

  return {
    editor,
    applied,
    collections,
    clears: () => clears,
    setLineCount: (next: number) => {
      lineCount = next
    },
    setModel: (present: boolean) => {
      hasModel = present
    }
  }
}

const describe_ = (decoration: { readonly messageKey: string }): string =>
  `t:${decoration.messageKey}`

describe('toExecutionLineModelDecorations', () => {
  it('builds a whole-line band and a glyph with a translated hover', () => {
    expect(
      toExecutionLineModelDecorations(
        toExecutionLineDecorations(snapshot(7), 10, 'src/main.py'),
        100,
        describe_
      )
    ).toEqual([
      {
        range: { startLineNumber: 7, startColumn: 1, endLineNumber: 7, endColumn: 1 },
        options: {
          isWholeLine: true,
          className: 'fx-debug-execution-line fx-debug-execution-line--current',
          glyphMarginClassName: 'fx-debug-execution-glyph fx-debug-execution-glyph--current',
          glyphMarginHoverMessage: { value: 't:debug.executionLine.current' }
        }
      }
    ])
  })

  it('drops lines beyond the model (file shortened outside the app)', () => {
    expect(
      toExecutionLineModelDecorations(
        toExecutionLineDecorations(snapshot(50), 10, 'src/main.py'),
        20,
        describe_
      )
    ).toEqual([])
  })
})

describe('createExecutionLineController', () => {
  it('owns its own decorations collection (separate from breakpoints)', () => {
    const fake = createFakeEditor()

    createExecutionLineController(fake.editor, describe_)

    expect(fake.collections).toHaveLength(1)
  })

  it('applies the current line, updates on a new stop, and clears on continue', () => {
    const fake = createFakeEditor()
    const controller = createExecutionLineController(fake.editor, describe_)

    controller.render(toExecutionLineDecorations(snapshot(7), 10, 'src/main.py'))
    expect(fake.applied.at(-1)?.[0]?.range.startLineNumber).toBe(7)

    controller.render(toExecutionLineDecorations(snapshot(8), 10, 'src/main.py'))
    expect(fake.applied.at(-1)?.[0]?.range.startLineNumber).toBe(8)

    const clearsBefore = fake.clears()
    controller.render(toExecutionLineDecorations(IDLE, null, 'src/main.py'))
    expect(fake.clears()).toBe(clearsBefore + 1)
    expect(fake.applied).toHaveLength(2)
  })

  it('does not touch Monaco when the marks did not change', () => {
    const fake = createFakeEditor()
    const controller = createExecutionLineController(fake.editor, describe_)

    controller.render(toExecutionLineDecorations(snapshot(7), 10, 'src/main.py'))
    controller.render(toExecutionLineDecorations(snapshot(7), 10, 'src/main.py'))

    expect(fake.applied).toHaveLength(1)
  })

  it('re-applies after reset (file switch) and clears when there is no model', () => {
    const fake = createFakeEditor()
    const controller = createExecutionLineController(fake.editor, describe_)
    const marks = toExecutionLineDecorations(snapshot(7), 10, 'src/main.py')

    controller.render(marks)
    controller.reset()
    controller.render(marks)
    expect(fake.applied).toHaveLength(2)

    fake.setModel(false)
    controller.reset()
    const clears = fake.clears()
    controller.render(marks)
    expect(fake.clears()).toBe(clears + 1)
    expect(fake.applied).toHaveLength(2)
  })

  it('leaves nothing behind when disposed', () => {
    const fake = createFakeEditor()
    const controller = createExecutionLineController(fake.editor, describe_)

    controller.render(toExecutionLineDecorations(snapshot(7), 10, 'src/main.py'))
    const clears = fake.clears()
    controller.dispose()

    expect(fake.clears()).toBe(clears + 1)
  })
})
