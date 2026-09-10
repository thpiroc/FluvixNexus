import { describe, expect, it } from 'vitest'
import type { DebugBreakpoint } from '@shared/debug'
import {
  isSameBreakpointGlyphDecorations,
  toBreakpointGlyphDecorations,
  toBreakpointGlyphKind
} from './breakpointDecorations'

function breakpoint(overrides: Partial<DebugBreakpoint> = {}): DebugBreakpoint {
  return { relativePath: 'src/a.ts', line: 3, enabled: true, verified: null, ...overrides }
}

describe('印の見え方', () => {
  /*
    走らせる前はいつも null。そこを失敗の色にすると、始める前から
    間違っているように見える（breakpointDecorations.ts の冒頭）。
  */
  it('答えが来ていなければ pending', () => {
    expect(toBreakpointGlyphKind(breakpoint({ verified: null }))).toBe('pending')
  })

  it('adapter が置けたと答えたら verified', () => {
    expect(toBreakpointGlyphKind(breakpoint({ verified: true }))).toBe('verified')
  })

  it('adapter が置けないと答えたら unverified', () => {
    expect(toBreakpointGlyphKind(breakpoint({ verified: false }))).toBe('unverified')
  })

  it('無効なら verified より先に disabled', () => {
    expect(toBreakpointGlyphKind(breakpoint({ enabled: false, verified: true }))).toBe('disabled')
  })
})

describe('decoration への変換', () => {
  const breakpoints = [
    breakpoint({ relativePath: 'src/a.ts', line: 10 }),
    breakpoint({ relativePath: 'src/b.ts', line: 1 }),
    breakpoint({ relativePath: 'src/a.ts', line: 2, verified: true })
  ]

  it('そのファイルのぶんだけを行の昇順で返す', () => {
    const decorations = toBreakpointGlyphDecorations(breakpoints, 'src/a.ts')

    expect(decorations.map((decoration) => decoration.line)).toEqual([2, 10])
  })

  it('別のファイルの印は出ない', () => {
    expect(toBreakpointGlyphDecorations(breakpoints, 'src/c.ts')).toEqual([])
  })

  /* 色は theme.css の1箇所にしかない（Session 4-4）。ここが返すのはクラス名だけ。 */
  it('16進数の色を1つも持たない', () => {
    for (const decoration of toBreakpointGlyphDecorations(breakpoints, 'src/a.ts')) {
      expect(decoration.className).toMatch(/^fx-breakpoint fx-breakpoint--/)
      expect(decoration.className).not.toMatch(/#[0-9a-f]{3,6}/i)
    }
  })

  /* 文言にすると、言語を切り替えたときに前の言語のまま取り残される。 */
  it('文言ではなく翻訳キーを返す', () => {
    expect(toBreakpointGlyphDecorations(breakpoints, 'src/a.ts')[0]?.messageKey).toBe(
      'editor.breakpoint.verified'
    )
  })

  it('元の配列を並べ替えない', () => {
    const original = [...breakpoints]

    toBreakpointGlyphDecorations(breakpoints, 'src/a.ts')

    expect(breakpoints).toEqual(original)
  })
})

describe('置き直しの判断', () => {
  const decorations = toBreakpointGlyphDecorations(
    [breakpoint({ line: 1 }), breakpoint({ line: 5 })],
    'src/a.ts'
  )

  it('同じ内容なら置き直さない', () => {
    const same = toBreakpointGlyphDecorations(
      [breakpoint({ line: 1 }), breakpoint({ line: 5 })],
      'src/a.ts'
    )

    expect(isSameBreakpointGlyphDecorations(decorations, same)).toBe(true)
  })

  it('行が変われば置き直す', () => {
    const other = toBreakpointGlyphDecorations(
      [breakpoint({ line: 1 }), breakpoint({ line: 6 })],
      'src/a.ts'
    )

    expect(isSameBreakpointGlyphDecorations(decorations, other)).toBe(false)
  })

  /* verified が変わると色が変わる。件数が同じでも置き直す必要がある。 */
  it('verified が変われば置き直す', () => {
    const verified = toBreakpointGlyphDecorations(
      [breakpoint({ line: 1, verified: true }), breakpoint({ line: 5 })],
      'src/a.ts'
    )

    expect(isSameBreakpointGlyphDecorations(decorations, verified)).toBe(false)
  })

  it('件数が変われば置き直す', () => {
    expect(isSameBreakpointGlyphDecorations(decorations, [])).toBe(false)
  })
})
