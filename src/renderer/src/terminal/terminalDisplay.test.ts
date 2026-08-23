import { describe, expect, it } from 'vitest'
import {
  clampTerminalFontSize,
  clampTerminalScrollback,
  nextTerminalFontSize,
  terminalFontSizeCommand,
  TERMINAL_FONT_SIZE_DEFAULT,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_SCROLLBACK_DEFAULT,
  TERMINAL_SCROLLBACK_MAX,
  TERMINAL_SCROLLBACK_MIN,
  type TerminalKeyStroke
} from './terminalDisplay'

/**
 * 端末のフォントの大きさ（Session 3-7-3）。
 *
 * 確かめたいのは2つ。
 *   - **横取りする打鍵が増えていないこと**。端末は打鍵をそのまま渡すのが約束で、
 *     ここが広がるとシェル側のキー操作が黙って効かなくなる
 *   - **範囲の外へ出ないこと**。0px の端末は桁数が測れず、器が壊れる
 */

function stroke(overrides: Partial<TerminalKeyStroke>): TerminalKeyStroke {
  return { key: '', ctrlKey: false, altKey: false, metaKey: false, ...overrides }
}

describe('terminalFontSizeCommand', () => {
  it('Ctrl + + / = で大きくする', () => {
    expect(terminalFontSizeCommand(stroke({ key: '+', ctrlKey: true }))).toBe('increase')
    expect(terminalFontSizeCommand(stroke({ key: '=', ctrlKey: true }))).toBe('increase')
  })

  it('Ctrl + - / _ で小さくする', () => {
    expect(terminalFontSizeCommand(stroke({ key: '-', ctrlKey: true }))).toBe('decrease')
    expect(terminalFontSizeCommand(stroke({ key: '_', ctrlKey: true }))).toBe('decrease')
  })

  it('Ctrl + 0 で既定へ戻す', () => {
    expect(terminalFontSizeCommand(stroke({ key: '0', ctrlKey: true }))).toBe('reset')
  })

  /* Ctrl が無ければ、ただの文字としてシェルへ流れる打鍵にほかならない。 */
  it('Ctrl が無ければ横取りしない', () => {
    expect(terminalFontSizeCommand(stroke({ key: '-' }))).toBeNull()
    expect(terminalFontSizeCommand(stroke({ key: '0' }))).toBeNull()
  })

  /* Alt / Meta が付いていれば別の組み合わせ。端末側へ通す。 */
  it('Alt / Meta が付いていれば横取りしない', () => {
    expect(terminalFontSizeCommand(stroke({ key: '-', ctrlKey: true, altKey: true }))).toBeNull()
    expect(terminalFontSizeCommand(stroke({ key: '-', ctrlKey: true, metaKey: true }))).toBeNull()
  })

  /* Ctrl + C / Ctrl + D のような、端末に要る打鍵を取り込んでいないこと。 */
  it('端末で使う Ctrl の組み合わせは横取りしない', () => {
    for (const key of ['c', 'd', 'l', 'z', 'r', '1', '9']) {
      expect(terminalFontSizeCommand(stroke({ key, ctrlKey: true }))).toBeNull()
    }
  })
})

describe('nextTerminalFontSize', () => {
  it('1px ずつ動く', () => {
    expect(nextTerminalFontSize(13, 'increase')).toBe(14)
    expect(nextTerminalFontSize(13, 'decrease')).toBe(12)
  })

  it('上限 / 下限を越えない', () => {
    expect(nextTerminalFontSize(TERMINAL_FONT_SIZE_MAX, 'increase')).toBe(TERMINAL_FONT_SIZE_MAX)
    expect(nextTerminalFontSize(TERMINAL_FONT_SIZE_MIN, 'decrease')).toBe(TERMINAL_FONT_SIZE_MIN)
  })

  it('reset は既定へ戻す', () => {
    expect(nextTerminalFontSize(TERMINAL_FONT_SIZE_MAX, 'reset')).toBe(TERMINAL_FONT_SIZE_DEFAULT)
    expect(nextTerminalFontSize(TERMINAL_FONT_SIZE_MIN, 'reset')).toBe(TERMINAL_FONT_SIZE_DEFAULT)
  })
})

describe('clampTerminalFontSize', () => {
  it('範囲の中はそのまま', () => {
    expect(clampTerminalFontSize(13)).toBe(13)
  })

  it('範囲の外は丸める', () => {
    expect(clampTerminalFontSize(0)).toBe(TERMINAL_FONT_SIZE_MIN)
    expect(clampTerminalFontSize(999)).toBe(TERMINAL_FONT_SIZE_MAX)
  })

  it('端数は丸める', () => {
    expect(clampTerminalFontSize(13.4)).toBe(13)
    expect(clampTerminalFontSize(13.6)).toBe(14)
  })

  /* 保存された値（Session 3-7-5）が壊れていても、その1つで端末が開けなくならないこと。 */
  it('数として読めない値は既定へ戻す', () => {
    expect(clampTerminalFontSize(Number.NaN)).toBe(TERMINAL_FONT_SIZE_DEFAULT)
    expect(clampTerminalFontSize(Number.POSITIVE_INFINITY)).toBe(TERMINAL_FONT_SIZE_DEFAULT)
  })
})

/**
 * さかのぼれる行数（Session 3-7-5 から設定できる）。
 *
 * 丸め方は文字の大きさと同じ形にしてある ── 保存ファイルからの読み込みと
 * 設定 UI への入力が**同じ関数を通る**ことが要点で、片方だけに掛けると
 * 「UI では止まるのに、ファイルを直接書けば通る」が生まれる。
 */
describe('clampTerminalScrollback', () => {
  it('範囲の中はそのまま', () => {
    expect(clampTerminalScrollback(TERMINAL_SCROLLBACK_DEFAULT)).toBe(TERMINAL_SCROLLBACK_DEFAULT)
  })

  it('範囲の外は丸める', () => {
    expect(clampTerminalScrollback(0)).toBe(TERMINAL_SCROLLBACK_MIN)
    expect(clampTerminalScrollback(-1)).toBe(TERMINAL_SCROLLBACK_MIN)
    expect(clampTerminalScrollback(10_000_000)).toBe(TERMINAL_SCROLLBACK_MAX)
  })

  it('端数は丸める', () => {
    expect(clampTerminalScrollback(1000.4)).toBe(1000)
    expect(clampTerminalScrollback(1000.6)).toBe(1001)
  })

  it('数として読めない値は既定へ戻す', () => {
    expect(clampTerminalScrollback(Number.NaN)).toBe(TERMINAL_SCROLLBACK_DEFAULT)
    expect(clampTerminalScrollback(Number.POSITIVE_INFINITY)).toBe(TERMINAL_SCROLLBACK_DEFAULT)
  })
})
