import { describe, expect, it } from 'vitest'
import { TERMINAL_SETTINGS_SCHEMA_VERSION } from '@shared/settings'
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
  toTerminalSettingsDocument
} from './terminalSettings'

/**
 * Terminal の見え方の設定と、保存形式との行き来（Session 3-7-5）。
 *
 * 確かめたいのは2つ。
 *   - **壊れた設定ファイルで端末が使えなくならないこと**。読めない値は既定へ落ちる
 *   - **範囲の外の値がディスクにも画面にも回らないこと**。読むときも書くときも丸める
 */

describe('toTerminalDisplaySettings', () => {
  it('保存が無ければ既定', () => {
    expect(toTerminalDisplaySettings(null)).toEqual(DEFAULT_TERMINAL_DISPLAY_SETTINGS)
  })

  it('保存された値をそのまま読む', () => {
    expect(
      toTerminalDisplaySettings({
        schemaVersion: TERMINAL_SETTINGS_SCHEMA_VERSION,
        display: { fontSize: 18, scrollback: 12_000 }
      })
    ).toEqual({ fontSize: 18, scrollback: 12_000 })
  })

  it('範囲の外の値は丸める', () => {
    expect(
      toTerminalDisplaySettings({
        schemaVersion: TERMINAL_SETTINGS_SCHEMA_VERSION,
        display: { fontSize: 999, scrollback: 10_000_000 }
      })
    ).toEqual({ fontSize: TERMINAL_FONT_SIZE_MAX, scrollback: TERMINAL_SCROLLBACK_MAX })

    expect(
      toTerminalDisplaySettings({
        schemaVersion: TERMINAL_SETTINGS_SCHEMA_VERSION,
        display: { fontSize: 0, scrollback: -1 }
      })
    ).toEqual({ fontSize: TERMINAL_FONT_SIZE_MIN, scrollback: TERMINAL_SCROLLBACK_MIN })
  })

  /*
    手で書き換えたファイルや、アプリのダウングレードで起きうる。**片方が読めなくても
    もう片方は活かす** ── 端末が開けなくなる理由にしない。
  */
  it('数として読めない値だけが既定へ落ちる', () => {
    expect(
      toTerminalDisplaySettings({
        schemaVersion: TERMINAL_SETTINGS_SCHEMA_VERSION,
        display: { fontSize: Number.NaN, scrollback: 9000 }
      })
    ).toEqual({ fontSize: TERMINAL_FONT_SIZE_DEFAULT, scrollback: 9000 })
  })
})

describe('toTerminalSettingsDocument', () => {
  it('今の schemaVersion で書く', () => {
    expect(toTerminalSettingsDocument({ fontSize: 15, scrollback: 7000 })).toEqual({
      schemaVersion: TERMINAL_SETTINGS_SCHEMA_VERSION,
      display: { fontSize: 15, scrollback: 7000 }
    })
  })

  /* 書く前にも丸める（読む側が必ずいることを当てにしない）。 */
  it('範囲の外の値をディスクへ残さない', () => {
    expect(toTerminalSettingsDocument({ fontSize: 999, scrollback: 0 }).display).toEqual({
      fontSize: TERMINAL_FONT_SIZE_MAX,
      scrollback: TERMINAL_SCROLLBACK_MIN
    })
  })

  it('読んで書いても変わらない', () => {
    const document = toTerminalSettingsDocument({ fontSize: 20, scrollback: 20_000 })

    expect(toTerminalSettingsDocument(toTerminalDisplaySettings(document))).toEqual(document)
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
