import { describe, expect, it } from 'vitest'
import { SETTINGS_SECTION_IDS } from '@shared/settings'
import {
  DEFAULT_SETTINGS_CATEGORY_ID,
  getSettingsCategory,
  hasKnownSections,
  isSettingsCategoryId,
  listSettingsCategories,
  listSettingsItems,
  listSettingsValueCategories,
  SETTINGS_CATEGORIES
} from './settingsCatalog'

/**
 * Settings 画面に何が並ぶか（Session 4-3B、カテゴリの2種類は 4-7C）。
 *
 * このプロジェクトのテストは React にも DOM にも依存しない層だけを対象にしている
 * （vitest.config.ts）。目録を settingsCatalog.ts へ出してあるのはそのためで、
 * ここで確かめるのは**画面を起動せずに確かめられること**に絞る。
 *
 *   - 6つのカテゴリが、決めた順で並ぶこと
 *   - **中身の無いカテゴリが1つも無いこと**（v1 で作らないと決めたもの）
 *   - まだ作らないと決めたカテゴリ（Git / Workspace / LSP / Debug）が紛れ込んでいないこと
 *   - 載せないと決めたもの（Files のカラムの幅）が並んでいないこと
 *   - 目録の section 名が、保存側の閉じた集合と食い違っていないこと
 *
 * 「変えた値が保存されて戻ってくるか」は settings.integration.test.ts が持つ。
 */

describe('SETTINGS_CATEGORIES', () => {
  it('General / Appearance / Editor / LSP / Files / Terminal / Keyboard がこの順に並ぶ', () => {
    expect(listSettingsCategories().map((category) => category.id)).toEqual([
      'general',
      'appearance',
      'editor',
      'lsp',
      'files',
      'terminal',
      'keyboard'
    ])
  })

  it('General は先頭に置く', () => {
    const ids = listSettingsCategories().map((category) => category.id)

    expect(ids[0]).toBe('general')
  })

  /*
    Session 4-7C まで、カテゴリは section と**ID も並びも1対1**だった。
    Keyboard Shortcuts はそこから外れる最初のカテゴリになる（保存するものが
    1つも無い）。**1対1の約束は消えていない** ── 掛かる相手が
    「すべてのカテゴリ」から「値カテゴリ」へ移っただけで、保存ファイルの
    section の並びと一致することは今も成り立つ（settingsCatalog.ts）。
  */
  it('値カテゴリの並びが、保存側の section の並びと一致する', () => {
    expect(listSettingsValueCategories().map((category) => category.id)).toEqual([
      ...SETTINGS_SECTION_IDS
    ])
  })

  it('一覧表のカテゴリは Keyboard Shortcuts の1つだけで、末尾に置く', () => {
    const shortcuts = SETTINGS_CATEGORIES.filter((category) => category.kind === 'shortcuts')

    expect(shortcuts.map((category) => category.id)).toEqual(['keyboard'])
    expect(SETTINGS_CATEGORIES[SETTINGS_CATEGORIES.length - 1].id).toBe('keyboard')
  })

  /* 値カテゴリの並びが `SETTINGS_SECTION_IDS` の前方一致のまま残ること。 */
  it('値カテゴリが配列の前方にまとまっている', () => {
    const kinds = SETTINGS_CATEGORIES.map((category) => category.kind)

    expect(kinds.indexOf('shortcuts')).toBe(kinds.lastIndexOf('items') + 1)
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

    Keyboard Shortcuts はこれに当たらない ── `items` を持たないのは
    「まだ中身が無い」からではなく、**並べるものが目録ではなく
    Command Registry から実行時に組み立てられる**ためになる。
  */
  it('中身の無い値カテゴリが無い', () => {
    for (const category of listSettingsValueCategories()) {
      expect(category.items.length).toBeGreaterThan(0)
    }
  })

  it('まだ中身の無いカテゴリを先に置いていない', () => {
    const ids = SETTINGS_CATEGORIES.map((category) => category.id) as readonly string[]

    /*
      `general` は Session 4-5A、`lsp` は Session 5-4 で中身ができたので、
      ここからは外れている。`language` が残っているのは、LSP のカテゴリに
      その名前を使っていないことを言うため（`general.language`（表示言語）と
      紛らわしい ── 別の設定にほかならない）。
    */
    for (const absent of ['git', 'workspace', 'language', 'debug', 'dap']) {
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

    Keyboard Shortcuts は項目を1つも足していない ── 一覧表であって設定ではない。
  */
  it('9つの設定が、カテゴリの順に並ぶ', () => {
    expect(listSettingsItems().map((item) => item.id)).toEqual([
      'general.language',
      'appearance.theme',
      'editor.autoSaveMode',
      'editor.autoSaveDelayMs',
      'lsp.enabled',
      'lsp.servers',
      'files.viewMode',
      'terminal.fontSize',
      'terminal.scrollback'
    ])
  })

  /*
    保存形式には言語ごとの key が3つあるが（`typescriptEnabled` ほか）、
    画面の項目は1つにまとめてある（settings/SettingsOverlay.tsx）。
    **目録の項目と保存形式の key は1対1ではない**という例が、Files の
    カラムの幅に続いて2つめになる。
  */
  it('言語ごとの切り替えは、項目としては1つにまとめる', () => {
    const ids = listSettingsItems().map((item) => item.id)

    expect(ids).toContain('lsp.servers')

    for (const absent of ['lsp.typescript', 'lsp.python', 'lsp.csharp']) {
      expect(ids).not.toContain(absent)
    }
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

  it('値カテゴリの中の項目は、そのカテゴリと同じ section を指す', () => {
    for (const category of listSettingsValueCategories()) {
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

  it('Keyboard Shortcuts は一覧表として取り出せる', () => {
    const category = getSettingsCategory('keyboard')

    expect(category.kind).toBe('shortcuts')
    expect(category.titleKey).toBe('settings.categories.keyboard.title')
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
    expect(isSettingsCategoryId('keyboard')).toBe(true)
    expect(isSettingsCategoryId(null)).toBe(false)
    expect(isSettingsCategoryId(3)).toBe(false)
  })
})
