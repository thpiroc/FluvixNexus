import { describe, expect, it } from 'vitest'
import {
  compareDebugBreakpoints,
  DEBUG_BREAKPOINT_MAX_LINE,
  filterDebugBreakpointsForPath,
  findDebugBreakpointAt,
  isDebugBreakpointLine,
  isSameDebugBreakpointLocation,
  type DebugBreakpoint
} from './breakpoint'

function breakpoint(relativePath: string, line: number): DebugBreakpoint {
  return { relativePath, line, enabled: true, verified: null }
}

describe('isDebugBreakpointLine', () => {
  it('1起点の整数だけを受け取る', () => {
    expect(isDebugBreakpointLine(1)).toBe(true)
    expect(isDebugBreakpointLine(42)).toBe(true)
    expect(isDebugBreakpointLine(DEBUG_BREAKPOINT_MAX_LINE)).toBe(true)
  })

  it('0 起点・負・小数・桁違いを受け取らない', () => {
    expect(isDebugBreakpointLine(0)).toBe(false)
    expect(isDebugBreakpointLine(-1)).toBe(false)
    expect(isDebugBreakpointLine(1.5)).toBe(false)
    expect(isDebugBreakpointLine(DEBUG_BREAKPOINT_MAX_LINE + 1)).toBe(false)
  })

  it('数でない値を受け取らない', () => {
    expect(isDebugBreakpointLine('3')).toBe(false)
    expect(isDebugBreakpointLine(null)).toBe(false)
    expect(isDebugBreakpointLine(undefined)).toBe(false)
    expect(isDebugBreakpointLine(Number.NaN)).toBe(false)
    expect(isDebugBreakpointLine(Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('同一性と並び', () => {
  it('相対位置と行の組で同じ場所を判断する', () => {
    expect(
      isSameDebugBreakpointLocation({ relativePath: 'a.ts', line: 3 }, breakpoint('a.ts', 3))
    ).toBe(true)
    expect(
      isSameDebugBreakpointLocation({ relativePath: 'a.ts', line: 3 }, breakpoint('a.ts', 4))
    ).toBe(false)
    expect(
      isSameDebugBreakpointLocation({ relativePath: 'a.ts', line: 3 }, breakpoint('b.ts', 3))
    ).toBe(false)
  })

  it('相対位置 → 行の順に並ぶ', () => {
    const sorted = [
      breakpoint('src/b.ts', 2),
      breakpoint('src/a.ts', 10),
      breakpoint('src/a.ts', 2)
    ].sort(compareDebugBreakpoints)

    expect(sorted.map((entry) => `${entry.relativePath}:${entry.line}`)).toEqual([
      'src/a.ts:2',
      'src/a.ts:10',
      'src/b.ts:2'
    ])
  })
})

describe('取り出し', () => {
  const breakpoints = [breakpoint('src/a.ts', 2), breakpoint('src/b.ts', 5)]

  it('その相対位置のぶんだけを返す', () => {
    expect(filterDebugBreakpointsForPath(breakpoints, 'src/a.ts')).toEqual([
      breakpoint('src/a.ts', 2)
    ])
    expect(filterDebugBreakpointsForPath(breakpoints, 'src/c.ts')).toEqual([])
  })

  it('位置を指して1件を引ける', () => {
    expect(findDebugBreakpointAt(breakpoints, 'src/b.ts', 5)).toEqual(breakpoint('src/b.ts', 5))
    expect(findDebugBreakpointAt(breakpoints, 'src/b.ts', 6)).toBeNull()
  })
})
