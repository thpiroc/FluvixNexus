import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LANGUAGE_ID,
  fromLanguageArguments,
  isLanguageId,
  LANGUAGE_IDS,
  normalizeLanguageId,
  toLanguageArgument
} from './language'

describe('Language', () => {
  it('選べる言語は日本語と English', () => {
    expect(LANGUAGE_IDS).toEqual(['ja', 'en'])
  })

  it('知らない値は日本語へ fallback する', () => {
    for (const value of ['fr', '', undefined, null, 42, {}, []]) {
      expect(normalizeLanguageId(value)).toBe(DEFAULT_LANGUAGE_ID)
    }
  })

  it('既知の言語だけを受け入れる', () => {
    expect(isLanguageId('ja')).toBe(true)
    expect(isLanguageId('en')).toBe(true)
    expect(isLanguageId('jp')).toBe(false)
  })

  it('Main から Preload へ渡す引数も同じ fallback を通る', () => {
    expect(fromLanguageArguments([toLanguageArgument('en')])).toBe('en')
    expect(fromLanguageArguments([toLanguageArgument('ja')])).toBe('ja')
    expect(fromLanguageArguments(['--fx-initial-language=fr'])).toBe('ja')
    expect(fromLanguageArguments(['--other=en'])).toBe('ja')
    expect(fromLanguageArguments([])).toBe('ja')
  })
})
