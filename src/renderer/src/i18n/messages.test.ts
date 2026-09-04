import { describe, expect, it } from 'vitest'
import { enMessages } from './locales/en'
import { jaMessages } from './locales/ja'
import { createTranslator } from './messages'

describe('i18n messages', () => {
  it('日本語辞書と英語辞書のキーが一致する', () => {
    expect(flattenKeys(jaMessages)).toEqual(flattenKeys(enMessages))
  })

  it('翻訳キーと埋め込み値を解決できる', () => {
    const t = createTranslator('en')

    expect(t('settings.title')).toBe('Settings')
    expect(t('workspace.layoutMenu', { title: 'Default' })).toBe('Layout: Default')
  })
})

function flattenKeys(value: unknown, prefix = ''): readonly string[] {
  if (typeof value !== 'object' || value === null) {
    return prefix === '' ? [] : [prefix]
  }

  return Object.entries(value)
    .flatMap(([key, child]) => flattenKeys(child, prefix === '' ? key : `${prefix}.${key}`))
    .sort()
}
