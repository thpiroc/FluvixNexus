import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LANGUAGE_SETTINGS,
  isSameLanguageSettings,
  toGeneralSection,
  toLanguageSettings
} from './languageSettings'

describe('language settings', () => {
  it('保存が無ければ日本語で始まる', () => {
    expect(toLanguageSettings({})).toEqual(DEFAULT_LANGUAGE_SETTINGS)
  })

  it('English を保存形式と往復できる', () => {
    expect(toLanguageSettings(toGeneralSection({ language: 'en' }))).toEqual({ language: 'en' })
  })

  it('知らない言語値は日本語へ fallback し、保存にも残さない', () => {
    expect(toLanguageSettings({ language: 'fr' })).toEqual({ language: 'ja' })
    expect(toGeneralSection({ language: 'ja' })).toEqual({ language: 'ja' })
  })

  it('同じ設定かを判定できる', () => {
    expect(isSameLanguageSettings({ language: 'ja' }, { language: 'ja' })).toBe(true)
    expect(isSameLanguageSettings({ language: 'ja' }, { language: 'en' })).toBe(false)
  })
})
