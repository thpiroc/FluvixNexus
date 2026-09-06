import { describe, expect, it } from 'vitest'
import type { StoredLspSettings } from '../settings/sections'
import { LANGUAGE_SERVER_IDS, isLanguageServerId } from './server'
import {
  DEFAULT_LANGUAGE_SERVER_PREFERENCES,
  isLanguageServerEnabled,
  isSameLanguageServerPreferences,
  normalizeLanguageServerPreferences,
  toStoredLspSettings
} from './serverSettings'

/**
 * Language Server を使うかどうか（Session 5-4）。
 *
 * この読み方は **Main と Renderer の両方が通る**（shared/lsp/serverSettings.ts）
 * ので、ここが唯一の検証になる。確かめたいのは3つ。
 *
 *   - **無い ＝ 有効**（設定を足したことで、既存の利用者の診断が消えない）
 *   - **読めない値も有効**（設定が読めないことは、機能を止める理由にならない）
 *   - **key ごとに独立**（1つ読めなくても、他の3つは残る）
 */

/** 素の JSON を、保存形式を名乗る値として渡す（境界の外から届く形）。 */
function stored(raw: unknown): StoredLspSettings {
  return raw as StoredLspSettings
}

describe('normalizeLanguageServerPreferences', () => {
  it('保存が無ければ、全部「使う」', () => {
    expect(normalizeLanguageServerPreferences(undefined)).toEqual(
      DEFAULT_LANGUAGE_SERVER_PREFERENCES
    )
    expect(normalizeLanguageServerPreferences({})).toEqual(DEFAULT_LANGUAGE_SERVER_PREFERENCES)
  })

  it('保存されている真偽値をそのまま読む', () => {
    expect(
      normalizeLanguageServerPreferences({
        enabled: false,
        typescriptEnabled: true,
        pythonEnabled: false,
        csharpEnabled: false
      })
    ).toEqual({
      enabled: false,
      servers: { typescript: true, python: false, csharp: false }
    })
  })

  /*
    真偽値として読めない値。`'true'` も `1` も**読み替えない**
    （main/store/settingsSections.ts と同じ判断）── 寛容に読むと、
    書いた側の誤りが設定ファイルの中で正しい値に化ける。
  */
  it('真偽値でない値は「使う」へ落とす', () => {
    for (const value of ['true', 'false', 0, 1, null, [], {}]) {
      expect(normalizeLanguageServerPreferences(stored({ enabled: value })).enabled).toBe(true)
    }
  })

  it('1つ読めなくても、他の key は残る', () => {
    const preferences = normalizeLanguageServerPreferences(
      stored({ enabled: 'no', typescriptEnabled: false, pythonEnabled: false })
    )

    expect(preferences.enabled).toBe(true)
    expect(preferences.servers).toEqual({ typescript: false, python: false, csharp: true })
  })

  it('知らない key は無視する（この版が意味を決めてよいものではない）', () => {
    expect(
      normalizeLanguageServerPreferences(stored({ rustEnabled: false, enabled: false }))
    ).toEqual({
      enabled: false,
      servers: { typescript: true, python: true, csharp: true }
    })
  })
})

describe('toStoredLspSettings', () => {
  /*
    書くときは**省略しない**。「無い ＝ 有効」と読む側の約束はあるが、
    書く側でそれに頼らないことで、「有効に戻した」と「一度も触っていない」を
    ファイルの上で区別できるようにしておく。
  */
  it('4つの key をすべて書く', () => {
    expect(toStoredLspSettings(DEFAULT_LANGUAGE_SERVER_PREFERENCES)).toEqual({
      enabled: true,
      typescriptEnabled: true,
      pythonEnabled: true,
      csharpEnabled: true
    })
  })

  it('読んで書いても内容が変わらない', () => {
    const raw = {
      enabled: false,
      typescriptEnabled: false,
      pythonEnabled: true,
      csharpEnabled: false
    }

    expect(toStoredLspSettings(normalizeLanguageServerPreferences(raw))).toEqual(raw)
  })
})

describe('isLanguageServerEnabled', () => {
  it('全体と言語の両方が有効なときだけ true', () => {
    const preferences = normalizeLanguageServerPreferences({ pythonEnabled: false })

    expect(isLanguageServerEnabled(preferences, 'typescript')).toBe(true)
    expect(isLanguageServerEnabled(preferences, 'python')).toBe(false)
  })

  it('全体が無効なら、言語ごとの値に関わらず false', () => {
    const preferences = normalizeLanguageServerPreferences({ enabled: false })

    for (const id of LANGUAGE_SERVER_IDS) {
      expect(isLanguageServerEnabled(preferences, id)).toBe(false)
    }
  })
})

describe('isSameLanguageServerPreferences', () => {
  it('中身が同じなら true（別の object でも）', () => {
    expect(
      isSameLanguageServerPreferences(
        normalizeLanguageServerPreferences({ pythonEnabled: false }),
        normalizeLanguageServerPreferences({ pythonEnabled: false })
      )
    ).toBe(true)
  })

  it('1つでも違えば false', () => {
    const base = normalizeLanguageServerPreferences({})

    expect(
      isSameLanguageServerPreferences(base, normalizeLanguageServerPreferences({ enabled: false }))
    ).toBe(false)
    expect(
      isSameLanguageServerPreferences(
        base,
        normalizeLanguageServerPreferences({ csharpEnabled: false })
      )
    ).toBe(false)
  })
})

describe('isLanguageServerId', () => {
  it('表の行だけを受け入れる', () => {
    for (const id of LANGUAGE_SERVER_IDS) {
      expect(isLanguageServerId(id)).toBe(true)
    }

    for (const value of ['rust', '', null, 3, {}]) {
      expect(isLanguageServerId(value)).toBe(false)
    }
  })
})
