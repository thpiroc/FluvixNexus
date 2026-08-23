import { describe, expect, it } from 'vitest'
import {
  TERMINAL_MAX_COLUMNS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLUMNS,
  TERMINAL_MIN_ROWS
} from './session'
import { isSameTerminalSize, normalizeTerminalSize } from './size'

/**
 * ターミナルの大きさの正規化（size.ts）。
 *
 * 要点は「断る値」と「丸める値」の線引きにある。大きさは利用者が指した値ではなく
 * 画面から測った値なので、範囲外は断らずに丸める。
 */
describe('normalizeTerminalSize', () => {
  it('そのまま使える値は変えない', () => {
    expect(normalizeTerminalSize({ columns: 120, rows: 30 })).toEqual({ columns: 120, rows: 30 })
  })

  /*
    パネルが畳まれている / まだ描かれていない間は 0 が測られる。
    断ると「畳んだだけでターミナルが壊れる」ことになる。
  */
  it('小さすぎる値を下限まで丸める', () => {
    expect(normalizeTerminalSize({ columns: 0, rows: 0 })).toEqual({
      columns: TERMINAL_MIN_COLUMNS,
      rows: TERMINAL_MIN_ROWS
    })
    expect(normalizeTerminalSize({ columns: -50, rows: -1 })).toEqual({
      columns: TERMINAL_MIN_COLUMNS,
      rows: TERMINAL_MIN_ROWS
    })
  })

  it('大きすぎる値を上限まで丸める', () => {
    expect(normalizeTerminalSize({ columns: 999_999, rows: 999_999 })).toEqual({
      columns: TERMINAL_MAX_COLUMNS,
      rows: TERMINAL_MAX_ROWS
    })
  })

  it('小数を切り捨てる（文字数は整数）', () => {
    expect(normalizeTerminalSize({ columns: 80.9, rows: 24.4 })).toEqual({
      columns: 80,
      rows: 24
    })
  })

  /*
    丸めようが無いものは断る。呼び出し側（ipc/handlers/terminal.ts）は
    不正な要求として扱う。
  */
  it('数として読めない値は断る', () => {
    expect(normalizeTerminalSize({ columns: '80', rows: 24 })).toBeNull()
    expect(normalizeTerminalSize({ columns: Number.NaN, rows: 24 })).toBeNull()
    expect(normalizeTerminalSize({ columns: Number.POSITIVE_INFINITY, rows: 24 })).toBeNull()
    expect(normalizeTerminalSize({ columns: 80 })).toBeNull()
    expect(normalizeTerminalSize({})).toBeNull()
    expect(normalizeTerminalSize(null)).toBeNull()
    expect(normalizeTerminalSize(undefined)).toBeNull()
    expect(normalizeTerminalSize('80x24')).toBeNull()
  })
})

describe('isSameTerminalSize', () => {
  it('桁数と行数がどちらも同じときだけ同じとする', () => {
    expect(isSameTerminalSize({ columns: 80, rows: 24 }, { columns: 80, rows: 24 })).toBe(true)
    expect(isSameTerminalSize({ columns: 80, rows: 24 }, { columns: 81, rows: 24 })).toBe(false)
    expect(isSameTerminalSize({ columns: 80, rows: 24 }, { columns: 80, rows: 25 })).toBe(false)
  })
})
