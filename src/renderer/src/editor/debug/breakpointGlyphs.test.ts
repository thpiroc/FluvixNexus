import { describe, expect, it, vi } from 'vitest'
import type { DebugBreakpoint } from '@shared/debug'
import { toBreakpointGlyphDecorations } from './breakpointDecorations'
import {
  changesLineCount,
  createBreakpointGlyphController,
  resolveCurrentBreakpointToggleLine,
  resolveBreakpointToggleLine,
  toModelDecorations,
  type BreakpointGlyphContentChangedEvent,
  type BreakpointGlyphEditor,
  type BreakpointGlyphModelDecoration,
  type BreakpointGlyphMouseEvent
} from './breakpointGlyphs'

/**
 * glyph margin の印。**Monaco は読み込まない** ── 叩く相手は構造的部分型で
 * 受けているため、偽のエディタで同じ経路を通せる（breakpointGlyphs.ts の冒頭）。
 */

/** Monaco の `MouseTargetType.GUTTER_GLYPH_MARGIN` にあたる値（試験用）。 */
const GLYPH_MARGIN = 2

function breakpoint(overrides: Partial<DebugBreakpoint> = {}): DebugBreakpoint {
  return { relativePath: 'src/a.ts', line: 3, enabled: true, verified: null, ...overrides }
}

function mouseEvent(
  overrides: {
    readonly type?: number
    readonly line?: number | null
    readonly leftButton?: boolean
  } = {}
): BreakpointGlyphMouseEvent {
  const line = overrides.line === undefined ? 3 : overrides.line

  return {
    target: {
      type: overrides.type ?? GLYPH_MARGIN,
      position: line === null ? null : { lineNumber: line }
    },
    event: { leftButton: overrides.leftButton ?? true }
  }
}

interface FakeEditor {
  readonly editor: BreakpointGlyphEditor
  readonly applied: readonly (readonly BreakpointGlyphModelDecoration[])[]
  readonly clears: () => number
  readonly mouseDown: (event: BreakpointGlyphMouseEvent) => void
  readonly changeContent: (event: BreakpointGlyphContentChangedEvent) => void
  readonly setLineCount: (lineCount: number) => void
  readonly setModel: (present: boolean) => void
  readonly setPosition: (line: number | null) => void
  readonly disposed: () => { mouse: number; content: number }
}

function createFakeEditor(): FakeEditor {
  const applied: (readonly BreakpointGlyphModelDecoration[])[] = []
  const mouseListeners: ((event: BreakpointGlyphMouseEvent) => void)[] = []
  const contentListeners: ((event: BreakpointGlyphContentChangedEvent) => void)[] = []
  const disposed = { mouse: 0, content: 0 }
  let clears = 0
  let lineCount = 100
  let hasModel = true
  let position: { readonly lineNumber: number } | null = { lineNumber: 3 }

  const editor: BreakpointGlyphEditor = {
    onMouseDown: (listener) => {
      mouseListeners.push(listener)

      return {
        dispose: () => {
          disposed.mouse += 1
        }
      }
    },
    onDidChangeModelContent: (listener) => {
      contentListeners.push(listener)

      return {
        dispose: () => {
          disposed.content += 1
        }
      }
    },
    createDecorationsCollection: () => ({
      set: (decorations) => {
        applied.push(decorations)
      },
      clear: () => {
        clears += 1
      }
    }),
    getModel: () => (hasModel ? { getLineCount: () => lineCount } : null),
    getPosition: () => position
  }

  return {
    editor,
    applied,
    clears: () => clears,
    mouseDown: (event) => {
      for (const listener of mouseListeners) {
        listener(event)
      }
    },
    changeContent: (event) => {
      for (const listener of contentListeners) {
        listener(event)
      }
    },
    setLineCount: (next) => {
      lineCount = next
    },
    setModel: (present) => {
      hasModel = present
    },
    setPosition: (line) => {
      position = line === null ? null : { lineNumber: line }
    },
    disposed: () => disposed
  }
}

function controllerFor(
  fake: FakeEditor,
  onToggle = vi.fn()
): {
  readonly controller: ReturnType<typeof createBreakpointGlyphController>
  readonly onToggle: typeof onToggle
} {
  return {
    onToggle,
    controller: createBreakpointGlyphController(fake.editor, {
      glyphMarginTargetType: GLYPH_MARGIN,
      onToggle,
      describe: (decoration) => decoration.messageKey
    })
  }
}

describe('押した場所の判断', () => {
  it('glyph margin の左クリックだけを通す', () => {
    expect(resolveBreakpointToggleLine(mouseEvent(), GLYPH_MARGIN)).toBe(3)
  })

  it('本文や行番号の列では何も起きない', () => {
    expect(resolveBreakpointToggleLine(mouseEvent({ type: 6 }), GLYPH_MARGIN)).toBeNull()
    expect(resolveBreakpointToggleLine(mouseEvent({ type: 3 }), GLYPH_MARGIN)).toBeNull()
  })

  it('右クリックでは何も起きない', () => {
    expect(resolveBreakpointToggleLine(mouseEvent({ leftButton: false }), GLYPH_MARGIN)).toBeNull()
  })

  it('行が取れなければ何も起きない', () => {
    expect(resolveBreakpointToggleLine(mouseEvent({ line: null }), GLYPH_MARGIN)).toBeNull()
    expect(resolveBreakpointToggleLine(mouseEvent({ line: 0 }), GLYPH_MARGIN)).toBeNull()
  })
})

describe('現在カーソル行からの判断', () => {
  it('現在行を breakpoint の入れ替え対象にする', () => {
    const fake = createFakeEditor()

    fake.setPosition(8)

    expect(resolveCurrentBreakpointToggleLine(fake.editor)).toBe(8)
  })

  it('Model や位置が無いとき、または範囲外の行では何もしない', () => {
    const fake = createFakeEditor()

    fake.setPosition(null)
    expect(resolveCurrentBreakpointToggleLine(fake.editor)).toBeNull()

    fake.setPosition(0)
    expect(resolveCurrentBreakpointToggleLine(fake.editor)).toBeNull()

    fake.setPosition(101)
    expect(resolveCurrentBreakpointToggleLine(fake.editor)).toBeNull()

    fake.setPosition(1)
    fake.setModel(false)
    expect(resolveCurrentBreakpointToggleLine(fake.editor)).toBeNull()
  })
})

describe('行数が変わる編集', () => {
  it('改行を含む編集は行数が変わる', () => {
    expect(
      changesLineCount({
        changes: [{ range: { startLineNumber: 1, endLineNumber: 1 }, text: 'a\nb' }]
      })
    ).toBe(true)
  })

  it('複数行を消す編集は行数が変わる', () => {
    expect(
      changesLineCount({ changes: [{ range: { startLineNumber: 1, endLineNumber: 3 }, text: '' }] })
    ).toBe(true)
  })

  it('1行の中の打鍵では変わらない', () => {
    expect(
      changesLineCount({
        changes: [{ range: { startLineNumber: 2, endLineNumber: 2 }, text: 'x' }]
      })
    ).toBe(false)
  })
})

describe('Monaco の decoration への変換', () => {
  it('行の頭を指す範囲になる', () => {
    const decorations = toModelDecorations(
      toBreakpointGlyphDecorations([breakpoint({ line: 4 })], 'src/a.ts'),
      100,
      (decoration) => decoration.messageKey
    )

    expect(decorations).toEqual([
      {
        range: { startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 1 },
        options: {
          glyphMarginClassName: 'fx-breakpoint fx-breakpoint--pending',
          glyphMarginHoverMessage: { value: 'editor.breakpoint.pending' }
        }
      }
    ])
  })

  /* 保存された印は開いているファイルより長く生きる。短くなっていることは普通に起きる。 */
  it('モデルの範囲を超える行は落とす', () => {
    const decorations = toModelDecorations(
      toBreakpointGlyphDecorations(
        [breakpoint({ line: 4 }), breakpoint({ line: 900 })],
        'src/a.ts'
      ),
      10,
      (decoration) => decoration.messageKey
    )

    expect(decorations).toHaveLength(1)
  })
})

describe('面の張り方', () => {
  it('glyph margin を押すと入れ替えが呼ばれる', () => {
    const fake = createFakeEditor()
    const { onToggle } = controllerFor(fake)

    fake.mouseDown(mouseEvent({ line: 7 }))

    expect(onToggle).toHaveBeenCalledWith(7)
  })

  it('本文を押しても呼ばれない', () => {
    const fake = createFakeEditor()
    const { onToggle } = controllerFor(fake)

    fake.mouseDown(mouseEvent({ type: 6 }))

    expect(onToggle).not.toHaveBeenCalled()
  })

  it('印を足すと decoration が増える', () => {
    const fake = createFakeEditor()
    const { controller } = controllerFor(fake)

    controller.render(toBreakpointGlyphDecorations([breakpoint({ line: 2 })], 'src/a.ts'))

    expect(fake.applied).toHaveLength(1)
    expect(fake.applied[0]).toHaveLength(1)

    controller.render(
      toBreakpointGlyphDecorations([breakpoint({ line: 2 }), breakpoint({ line: 5 })], 'src/a.ts')
    )

    expect(fake.applied[1]).toHaveLength(2)
  })

  it('印を外すと decoration が減る', () => {
    const fake = createFakeEditor()
    const { controller } = controllerFor(fake)

    controller.render(toBreakpointGlyphDecorations([breakpoint({ line: 2 })], 'src/a.ts'))
    controller.render([])

    expect(fake.applied[1]).toEqual([])
  })

  it('同じ内容なら Monaco に触れない', () => {
    const fake = createFakeEditor()
    const { controller } = controllerFor(fake)

    controller.render(toBreakpointGlyphDecorations([breakpoint({ line: 2 })], 'src/a.ts'))
    controller.render(toBreakpointGlyphDecorations([breakpoint({ line: 2 })], 'src/a.ts'))

    expect(fake.applied).toHaveLength(1)
  })

  it('verified が変われば当て直す', () => {
    const fake = createFakeEditor()
    const { controller } = controllerFor(fake)

    controller.render(toBreakpointGlyphDecorations([breakpoint({ line: 2 })], 'src/a.ts'))
    controller.render(
      toBreakpointGlyphDecorations([breakpoint({ line: 2, verified: true })], 'src/a.ts')
    )

    expect(fake.applied).toHaveLength(2)
    expect(fake.applied[1]?.[0]?.options.glyphMarginClassName).toContain('verified')
  })

  /* ファイルを切り替えたら必ず当て直す（前のファイルの印を残さない）。 */
  it('reset の後は同じ内容でも当て直す', () => {
    const fake = createFakeEditor()
    const { controller } = controllerFor(fake)

    controller.render(toBreakpointGlyphDecorations([breakpoint({ line: 2 })], 'src/a.ts'))
    controller.reset()
    controller.render(toBreakpointGlyphDecorations([breakpoint({ line: 2 })], 'src/a.ts'))

    expect(fake.applied).toHaveLength(2)
    expect(fake.clears()).toBeGreaterThan(0)
  })

  it('Model が載っていなければ何も置かない', () => {
    const fake = createFakeEditor()
    const { controller } = controllerFor(fake)

    fake.setModel(false)
    controller.render(toBreakpointGlyphDecorations([breakpoint({ line: 2 })], 'src/a.ts'))

    expect(fake.applied).toHaveLength(0)
  })

  /* 行数が変わる編集では、保存された行へ置き直す（v1 の制約）。 */
  it('行数が変わる編集の後に置き直す', () => {
    const fake = createFakeEditor()
    const { controller } = controllerFor(fake)

    controller.render(toBreakpointGlyphDecorations([breakpoint({ line: 2 })], 'src/a.ts'))
    fake.changeContent({
      changes: [{ range: { startLineNumber: 1, endLineNumber: 1 }, text: '\n' }]
    })

    expect(fake.applied).toHaveLength(2)
    expect(fake.applied[1]?.[0]?.range.startLineNumber).toBe(2)
  })

  it('1行の中の打鍵では置き直さない', () => {
    const fake = createFakeEditor()
    const { controller } = controllerFor(fake)

    controller.render(toBreakpointGlyphDecorations([breakpoint({ line: 2 })], 'src/a.ts'))
    fake.changeContent({
      changes: [{ range: { startLineNumber: 2, endLineNumber: 2 }, text: 'x' }]
    })

    expect(fake.applied).toHaveLength(1)
  })

  it('捨てると購読も decoration も残らない', () => {
    const fake = createFakeEditor()
    const { controller, onToggle } = controllerFor(fake)

    controller.render(toBreakpointGlyphDecorations([breakpoint({ line: 2 })], 'src/a.ts'))
    controller.dispose()

    expect(fake.disposed()).toEqual({ mouse: 1, content: 1 })
    expect(fake.clears()).toBeGreaterThan(0)

    // 器を捨てた後の描画は Monaco に触れない（呼ばれても増えない）。
    expect(onToggle).not.toHaveBeenCalled()
  })
})
