import { describe, expect, it } from 'vitest'
import { SETTINGS_SECTION_IDS } from '@shared/settings'
import {
  DEFAULT_SETTINGS_CATEGORY_ID,
  getSettingsCategory,
  hasKnownSections,
  isSettingsCategoryId,
  listSettingsCategories,
  listSettingsItems,
  SETTINGS_CATEGORIES
} from './settingsCatalog'

/**
 * Settings 画面に何が並ぶか（Session 4-3B）。
 *
 * このプロジェクトのテストは React にも DOM にも依存しない層だけを対象にしている
 * （vitest.config.ts）。目録を settingsCatalog.ts へ出してあるのはそのためで、
 * ここで確かめるのは**画面を起動せずに確かめられること**に絞る。
 *
 *   - 5つのカテゴリが、決めた順で並ぶこと
 *   - **中身の無いカテゴリが1つも無いこと**（v1 で作らないと決めたもの）
 *   - まだ作らないと決めたカテゴリ（Git / Workspace / LSP / Debug）が紛れ込んでいないこと
 *   - 載せないと決めたもの（Files のカラムの幅）が並んでいないこと
 *   - 目録の section 名が、保存側の閉じた集合と食い違っていないこと
 *
 * 「変えた値が保存されて戻ってくるか」は settings.integration.test.ts が持つ。
 */

describe('SETTINGS_CATEGORIES', () => {
  it('General / Appearance / Editor / Files / Terminal がこの順に並ぶ', () => {
    expect(listSettingsCategories().map((category) => category.id)).toEqual([
      'general',
      'appearance',
      'editor',
      'files',
      'terminal'
    ])
  })

  it('General は先頭に置く', () => {
    const ids = listSettingsCategories().map((category) => category.id)

    expect(ids[0]).toBe('general')
  })

  /* 保存ファイルの section の並びとも同じにしてある。 */
  it('カテゴリの並びが、保存側の section の並びと一致する', () => {
    expect(listSettingsCategories().map((category) => category.id)).toEqual([
      ...SETTINGS_SECTION_IDS
    ])
  })

  it('カテゴリの名前が画面に出せる形で入っている', () => {
    for (const category of SETTINGS_CATEGORIES) {
      expect(category.titleKey.length).toBeGreaterThan(0)
      expect(category.descriptionKey.length).toBeGreaterThan(0)
    }
  })

  /*
    v1 で作らないと決めたもの。中身が1つも無いカテゴリは「まだ何も無い場所」を
    画面に作るだけになる（保存側で空の section を先に作らないのと同じ線）。
  */
  it('中身の無いカテゴリが無い', () => {
    for (const category of SETTINGS_CATEGORIES) {
      expect(category.items.length).toBeGreaterThan(0)
    }
  })

  it('まだ中身の無いカテゴリを先に置いていない', () => {
    const ids = SETTINGS_CATEGORIES.map((category) => category.id) as readonly string[]

    // `general` は Session 4-5A で中身ができたので、ここからは外れている。
    for (const absent of ['git', 'workspace', 'language', 'lsp', 'debug', 'dap']) {
      expect(ids).not.toContain(absent)
    }
  })

  it('カテゴリの名前が重複しない', () => {
    const ids = SETTINGS_CATEGORIES.map((category) => category.id)

    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('listSettingsItems', () => {
  /*
    Session 4-3B の5つ ＋ Theme ＋ Language。保存されている設定は8つあるが、
    Files のカラムの幅だけは画面に載せない（settingsCatalog.ts の冒頭）。
  */
  it('7つの設定が、カテゴリの順に並ぶ', () => {
    expect(listSettingsItems().map((item) => item.id)).toEqual([
      'general.language',
      'appearance.theme',
      'editor.autoSaveMode',
      'editor.autoSaveDelayMs',
      'files.viewMode',
      'terminal.fontSize',
      'terminal.scrollback'
    ])
  })

  it('カラムの幅は並べない（掴んで動かして決めるもの）', () => {
    expect(listSettingsItems().map((item) => item.id)).not.toContain('files.columnWidth')
  })

  it('項目の名前が重複しない', () => {
    const ids = listSettingsItems().map((item) => item.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('名前と説明が空でない', () => {
    for (const item of listSettingsItems()) {
      expect(item.titleKey.length).toBeGreaterThan(0)
      expect(item.descriptionKey.length).toBeGreaterThan(0)
    }
  })

  /*
    目録と保存形式が食い違っていないこと。section を増やしたり名前を変えたりした
    ときに、画面の側が古い名前を指したままにならないようにする。
  */
  it('項目の section がすべて既知', () => {
    expect(hasKnownSections()).toBe(true)

    for (const item of listSettingsItems()) {
      expect(SETTINGS_SECTION_IDS as readonly string[]).toContain(item.section)
    }
  })

  it('カテゴリの中の項目は、そのカテゴリと同じ section を指す', () => {
    for (const category of SETTINGS_CATEGORIES) {
      for (const item of category.items) {
        expect(item.section).toBe(category.id)
      }
    }
  })
})

describe('getSettingsCategory', () => {
  it('名前でカテゴリを取り出せる', () => {
    expect(getSettingsCategory('terminal').titleKey).toBe('settings.categories.terminal.title')
  })

  it('既定は General', () => {
    expect(DEFAULT_SETTINGS_CATEGORY_ID).toBe('general')
    expect(getSettingsCategory(DEFAULT_SETTINGS_CATEGORY_ID).id).toBe('general')
  })
})

describe('isSettingsCategoryId', () => {
  it('今あるカテゴリだけを受け入れる', () => {
    expect(isSettingsCategoryId('files')).toBe(true)
    expect(isSettingsCategoryId('appearance')).toBe(true)
    expect(isSettingsCategoryId('general')).toBe(true)
    expect(isSettingsCategoryId(null)).toBe(false)
    expect(isSettingsCategoryId(3)).toBe(false)
  })
})
