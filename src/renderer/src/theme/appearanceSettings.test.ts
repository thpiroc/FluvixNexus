import { describe, expect, it } from 'vitest'
import { emptySettingsSections } from '@shared/settings'
import { THEME_IDS } from '@shared/theme'
import {
  APPEARANCE_THEME_CHOICES,
  DEFAULT_APPEARANCE_SETTINGS,
  describeTheme,
  isSameAppearanceSettings,
  toAppearanceSection,
  toAppearanceSettings
} from './appearanceSettings'

/**
 * Appearance 設定と保存形式の行き来（Session 4-4）。
 *
 * 分担は Editor（`autoSave.test.ts`）・Files（`filesSettings.test.ts`）・
 * Terminal（`terminalSettings.test.ts`）とまったく同じで、確かめるのは
 *
 *   - 保存が無ければ既定（Dark）で始まること
 *   - 知らない名前が**読むときも書くときも**落ちること
 *   - 往復して同じものへ戻ること
 *
 * 「切り替えたら画面が変わるか」は実機での確認に任せる（docs/DEVELOPMENT.md §4）。
 */

describe('toAppearanceSettings（保存 → 実行時）', () => {
  it('保存が無ければ Dark', () => {
    expect(toAppearanceSettings(emptySettingsSections().appearance)).toEqual({ theme: 'dark' })
    expect(DEFAULT_APPEARANCE_SETTINGS).toEqual({ theme: 'dark' })
  })

  it('保存された Theme を読む', () => {
    expect(toAppearanceSettings({ theme: 'light' })).toEqual({ theme: 'light' })
    expect(toAppearanceSettings({ theme: 'dark' })).toEqual({ theme: 'dark' })
  })

  /*
    アプリのダウングレードや、ファイルを手で直した場合。**設定が読めないことは、
    アプリの見た目が決まらない理由にならない。**
  */
  it('知らない名前は Dark へ落ちる', () => {
    for (const theme of ['solarized', 'system', 'Light', '']) {
      expect(toAppearanceSettings({ theme })).toEqual({ theme: 'dark' })
    }
  })
})

describe('toAppearanceSection（実行時 → 保存）', () => {
  it('往復して同じものへ戻る', () => {
    for (const theme of THEME_IDS) {
      expect(toAppearanceSettings(toAppearanceSection({ theme }))).toEqual({ theme })
    }
  })

  /*
    書く前にも落とす。読むときだけ落とす形にすると、**次に読む側が必ずいること**を
    当てにすることになる（範囲の外の値をディスクへ残さない、という他の3つと同じ判断）。
  */
  it('知らない名前はディスクへ残らない', () => {
    expect(toAppearanceSection({ theme: 'solarized' as never })).toEqual({ theme: 'dark' })
  })
})

describe('isSameAppearanceSettings', () => {
  it('同じ Theme なら同じ', () => {
    expect(isSameAppearanceSettings({ theme: 'dark' }, { theme: 'dark' })).toBe(true)
    expect(isSameAppearanceSettings({ theme: 'dark' }, { theme: 'light' })).toBe(false)
  })
})

describe('Settings 画面へ出すもの', () => {
  it('並ぶのは Dark → Light の2つ', () => {
    expect(APPEARANCE_THEME_CHOICES).toEqual(['dark', 'light'])
  })

  it('どちらにも画面に出せる名前がある', () => {
    for (const theme of APPEARANCE_THEME_CHOICES) {
      expect(describeTheme(theme).length).toBeGreaterThan(0)
    }

    expect(describeTheme('dark')).not.toBe(describeTheme('light'))
  })
})
