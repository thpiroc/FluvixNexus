import { describe, expect, it } from 'vitest'
import {
  TERMINAL_FONT_SIZE_DEFAULT,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_SCROLLBACK_DEFAULT,
  TERMINAL_SCROLLBACK_MAX,
  TERMINAL_SCROLLBACK_MIN
} from './terminalDisplay'
import {
  DEFAULT_TERMINAL_DISPLAY_SETTINGS,
  isSameTerminalDisplaySettings,
  toTerminalDisplaySettings,
  toTerminalSettingsSection
} from './terminalSettings'

/**
 * Terminal の見え方の設定と、保存形式との行き来
 * （Session 3-7-5 / 保存形式は Session 4-3A の `terminal` section）。
 *
 * 確かめたいのは2つ。
 *   - **壊れた設定ファイルで端末が使えなくならないこと**。読めない値は既定へ落ちる
 *   - **範囲の外の値がディスクにも画面にも回らないこと**。読むときも書くときも丸める
 */

describe('toTerminalDisplaySettings', () => {
  it('保存が無ければ既定', () => {
    expect(toTerminalDisplaySettings({})).toEqual(DEFAULT_TERMINAL_DISPLAY_SETTINGS)
  })

  it('保存された値をそのまま読む', () => {
    expect(toTerminalDisplaySettings({ fontSize: 18, scrollback: 12_000 })).toEqual({
      fontSize: 18,
      scrollback: 12_000
    })
  })

  it('範囲の外の値は丸める', () => {
    expect(toTerminalDisplaySettings({ fontSize: 999, scrollback: 10_000_000 })).toEqual({
      fontSize: TERMINAL_FONT_SIZE_MAX,
      scrollback: TERMINAL_SCROLLBACK_MAX
    })

    expect(toTerminalDisplaySettings({ fontSize: 0, scrollback: -1 })).toEqual({
      fontSize: TERMINAL_FONT_SIZE_MIN,
      scrollback: TERMINAL_SCROLLBACK_MIN
    })
  })

  /*
    手で書き換えたファイルや、アプリのダウングレードで起きうる。**片方が読めなくても
    もう片方は活かす** ── 端末が開けなくなる理由にしない。

    数として読めない値（NaN）は Main が落とすため、ここへは「無い」として届く
    （store/settingsSections.ts）。どちらの経路でも結果は同じになる。
  */
  it('片方が無くても、もう片方は活きる', () => {
    expect(toTerminalDisplaySettings({ scrollback: 9000 })).toEqual({
      fontSize: TERMINAL_FONT_SIZE_DEFAULT,
      scrollback: 9000
    })

    expect(toTerminalDisplaySettings({ fontSize: Number.NaN, scrollback: 9000 })).toEqual({
      fontSize: TERMINAL_FONT_SIZE_DEFAULT,
      scrollback: 9000
    })
  })
})

describe('toTerminalSettingsSection', () => {
  it('値をそのまま保存形式へ写す', () => {
    expect(toTerminalSettingsSection({ fontSize: 15, scrollback: 7000 })).toEqual({
      fontSize: 15,
      scrollback: 7000
    })
  })

  /* 書く前にも丸める（読む側が必ずいることを当てにしない）。 */
  it('範囲の外の値をディスクへ残さない', () => {
    expect(toTerminalSettingsSection({ fontSize: 999, scrollback: 0 })).toEqual({
      fontSize: TERMINAL_FONT_SIZE_MAX,
      scrollback: TERMINAL_SCROLLBACK_MIN
    })
  })

  it('読んで書いても変わらない', () => {
    const stored = toTerminalSettingsSection({ fontSize: 20, scrollback: 20_000 })

    expect(toTerminalSettingsSection(toTerminalDisplaySettings(stored))).toEqual(stored)
  })
})

describe('isSameTerminalDisplaySettings', () => {
  it('両方同じなら同じ', () => {
    expect(
      isSameTerminalDisplaySettings(
        { fontSize: 13, scrollback: 5000 },
        DEFAULT_TERMINAL_DISPLAY_SETTINGS
      )
    ).toBe(true)
  })

  it('片方でも違えば違う', () => {
    expect(
      isSameTerminalDisplaySettings(
        { fontSize: 14, scrollback: 5000 },
        { fontSize: 13, scrollback: 5000 }
      )
    ).toBe(false)

    expect(
      isSameTerminalDisplaySettings(
        { fontSize: 13, scrollback: 6000 },
        { fontSize: 13, scrollback: 5000 }
      )
    ).toBe(false)
  })
})

describe('既定値', () => {
  it('既定は範囲の中にある', () => {
    expect(DEFAULT_TERMINAL_DISPLAY_SETTINGS.fontSize).toBeGreaterThanOrEqual(
      TERMINAL_FONT_SIZE_MIN
    )
    expect(DEFAULT_TERMINAL_DISPLAY_SETTINGS.fontSize).toBeLessThanOrEqual(TERMINAL_FONT_SIZE_MAX)
    expect(DEFAULT_TERMINAL_DISPLAY_SETTINGS.scrollback).toBe(TERMINAL_SCROLLBACK_DEFAULT)
    expect(DEFAULT_TERMINAL_DISPLAY_SETTINGS.scrollback).toBeGreaterThanOrEqual(
      TERMINAL_SCROLLBACK_MIN
    )
    expect(DEFAULT_TERMINAL_DISPLAY_SETTINGS.scrollback).toBeLessThanOrEqual(
      TERMINAL_SCROLLBACK_MAX
    )
  })
})
