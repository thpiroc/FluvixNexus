import { describe, expect, it } from 'vitest'
import { SETTINGS_SCHEMA_VERSION, classifySettingsSchemaVersion } from '@shared/settings'
import {
  defaultSettingsDocument,
  parseSettingsDocument,
  toStoredSettings,
  withSettingsSection
} from './settingsDocument'
import { migrateStoredSettings } from './settingsMigration'

/**
 * 設定文書の検証（Session 4-3A）。
 *
 * 確かめたいのは4つ。
 *   - **落とす単位が段階になっていること**（文書 / section / key）
 *   - **版を取り違えないこと**（現在 / 古い / 新しすぎる / 読めない）
 *   - **知らないものが書き戻されること**（新しい版で足した設定を消さない）
 *   - **1つの section を保存しても、他を巻き込まないこと**
 */

const valid = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  sections: {
    editor: { autoSaveMode: 'afterDelay', autoSaveDelayMs: 1000 },
    files: { viewMode: 'columns', columnWidth: 240 },
    terminal: { fontSize: 15, scrollback: 7000 }
  }
}

describe('parseSettingsDocument', () => {
  it('正しい文書はそのまま読む', () => {
    const { document, issues } = parseSettingsDocument(valid)

    expect(document.sections).toEqual(valid.sections)
    expect(issues).toEqual([])
  })

  /* 文書ごと捨てるのは、この3つだけ（一番大きな捨て方を増やさない）。 */
  it('文書として読めなければ、全 section が既定', () => {
    for (const raw of [null, undefined, 42, 'x', [], true]) {
      expect(parseSettingsDocument(raw).document.sections).toEqual({
        editor: {},
        files: {},
        terminal: {}
      })
    }
  })

  it('schemaVersion が読めなければ、全 section が既定', () => {
    for (const schemaVersion of [0, -1, 1.5, '1', null, undefined, Number.NaN]) {
      expect(parseSettingsDocument({ ...valid, schemaVersion }).document.sections.editor).toEqual(
        {}
      )
    }
  })

  it('sections が object でなければ、全 section が既定', () => {
    for (const sections of [null, 42, 'x', [], true]) {
      expect(parseSettingsDocument({ ...valid, sections }).document.sections).toEqual({
        editor: {},
        files: {},
        terminal: {}
      })
    }
  })

  /* ここから下が「壊れたところだけを捨てる」側（Session 4-3A の要点）。 */
  it('1つの section が壊れていても、他の section は残る', () => {
    const { document, issues } = parseSettingsDocument({
      ...valid,
      sections: { ...valid.sections, files: 'broken' }
    })

    expect(document.sections.files).toEqual({})
    expect(document.sections.editor).toEqual(valid.sections.editor)
    expect(document.sections.terminal).toEqual(valid.sections.terminal)
    expect(issues).toContain('section "files" is not an object')
  })

  it('1つの key が壊れていても、他の key は残る', () => {
    const { document, issues } = parseSettingsDocument({
      ...valid,
      sections: { ...valid.sections, terminal: { fontSize: 'big', scrollback: 7000 } }
    })

    expect(document.sections.terminal).toEqual({ scrollback: 7000 })
    expect(issues).toContain('dropped "terminal.fontSize"')
  })

  it('section が無いのは正常（未保存 ＝ 既定）', () => {
    const { document, issues } = parseSettingsDocument({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      sections: { terminal: { fontSize: 15 } }
    })

    expect(document.sections).toEqual({ editor: {}, files: {}, terminal: { fontSize: 15 } })
    expect(issues).toEqual([])
  })

  it('知らない section と知らない key を持ち回す', () => {
    const { document } = parseSettingsDocument({
      ...valid,
      workspace: { trustPrompt: false },
      sections: {
        ...valid.sections,
        appearance: { theme: 'dark' },
        editor: { ...valid.sections.editor, minimap: true }
      }
    })

    expect(document.preserved.sections).toEqual({ appearance: { theme: 'dark' } })
    expect(document.preserved.fields.editor).toEqual({ minimap: true })
    expect(document.preserved.document).toEqual({ workspace: { trustPrompt: false } })
  })

  it('桁違いに大きな文書では、知らない内容を持ち回さない（既知の設定は読む）', () => {
    const { document, issues } = parseSettingsDocument({
      ...valid,
      sections: { ...valid.sections, huge: 'x'.repeat(100_000) }
    })

    expect(document.sections.editor).toEqual(valid.sections.editor)
    expect(document.preserved.sections).toEqual({})
    expect(issues).toContain('document exceeds the size limit; unknown contents are not kept')
  })
})

/**
 * 版の扱い（Session 4-3A）。
 *
 * 「正の整数なら受け入れる」だけでは、新しい版のファイルを現在の形として
 * 読んでしまう。区別できることそのものを確かめる。
 */
describe('schemaVersion', () => {
  it('現在 / 古い / 新しすぎる / 読めない を区別する', () => {
    expect(classifySettingsSchemaVersion(SETTINGS_SCHEMA_VERSION)).toEqual({ kind: 'current' })
    expect(classifySettingsSchemaVersion(SETTINGS_SCHEMA_VERSION + 1)).toEqual({
      kind: 'future',
      version: SETTINGS_SCHEMA_VERSION + 1
    })
    expect(classifySettingsSchemaVersion(0)).toEqual({ kind: 'invalid' })
    expect(classifySettingsSchemaVersion('1')).toEqual({ kind: 'invalid' })
  })

  /*
    ダウングレードの経路。既知の key の意味は版をまたいで変えない約束なので
    読める分は読み、知らない内容は書き戻す（新しい版の設定を消さない）。
  */
  it('新しすぎる版でも、既知の設定は読み、知らない内容は残す', () => {
    const { document, issues } = parseSettingsDocument({
      schemaVersion: SETTINGS_SCHEMA_VERSION + 5,
      sections: {
        terminal: { fontSize: 20, cursorStyle: 'bar' },
        appearance: { theme: 'dark' }
      }
    })

    expect(document.sections.terminal).toEqual({ fontSize: 20 })
    expect(document.preserved.fields.terminal).toEqual({ cursorStyle: 'bar' })
    expect(document.preserved.sections).toEqual({ appearance: { theme: 'dark' } })
    expect(issues.some((issue) => issue.includes('newer'))).toBe(true)
  })

  it('書き戻す版は常に現在の版（読んだ版ではない）', () => {
    const { document } = parseSettingsDocument({
      schemaVersion: SETTINGS_SCHEMA_VERSION + 5,
      sections: {}
    })

    expect(document.sourceVersion).toBe(SETTINGS_SCHEMA_VERSION + 5)
    expect(toStoredSettings(document).schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
  })
})

/**
 * migration の入口（Session 4-3A）。
 *
 * 段はまだ1つも無いので、**入口が本当に働くか**は差し替えて確かめる
 * （動かない入口を「ある」ことにしない。settingsMigration.ts）。
 */
describe('migrateStoredSettings', () => {
  it('現在の版なら、そのまま返す（段は要らない）', () => {
    expect(migrateStoredSettings(valid, SETTINGS_SCHEMA_VERSION)).toEqual(valid)
  })

  it('段が無ければ null（壊れた形のまま読み進めない）', () => {
    expect(migrateStoredSettings({ old: true }, 1, { currentVersion: 2 })).toBeNull()
  })

  it('段があれば、現在の版まで順に通す', () => {
    const steps = {
      1: (raw: Record<string, unknown>) => ({ ...raw, v2: true }),
      2: (raw: Record<string, unknown>) => ({ ...raw, v3: true })
    }

    expect(migrateStoredSettings({ old: true }, 1, { steps, currentVersion: 3 })).toEqual({
      old: true,
      v2: true,
      v3: true
    })
  })

  it('途中の段が欠けていたら null', () => {
    const steps = { 1: (raw: Record<string, unknown>) => raw }

    expect(migrateStoredSettings({ old: true }, 1, { steps, currentVersion: 3 })).toBeNull()
  })

  it('段が失敗したら null', () => {
    const steps = { 1: () => null }

    expect(migrateStoredSettings({ old: true }, 1, { steps, currentVersion: 2 })).toBeNull()
  })

  it('版として成り立たない起点は受け付けない', () => {
    for (const fromVersion of [0, -1, 1.5, Number.NaN, SETTINGS_SCHEMA_VERSION + 1]) {
      expect(migrateStoredSettings(valid, fromVersion)).toBeNull()
    }
  })
})

describe('toStoredSettings / withSettingsSection', () => {
  it('既定の文書は、空の section を持つ形で書かれる', () => {
    expect(toStoredSettings(defaultSettingsDocument())).toEqual({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      sections: { editor: {}, files: {}, terminal: {} }
    })
  })

  it('1つの section を差し替えても、他の section は変わらない', () => {
    const { document } = parseSettingsDocument(valid)
    const next = withSettingsSection(document, { section: 'terminal', value: { fontSize: 20 } })

    expect(next.sections.terminal).toEqual({ fontSize: 20 })
    expect(next.sections.editor).toEqual(valid.sections.editor)
    expect(next.sections.files).toEqual(valid.sections.files)
  })

  it('知らない section / key は、保存しても消えない', () => {
    const { document } = parseSettingsDocument({
      ...valid,
      sections: {
        ...valid.sections,
        appearance: { theme: 'dark' },
        terminal: { ...valid.sections.terminal, cursorStyle: 'bar' }
      }
    })

    const stored = toStoredSettings(
      withSettingsSection(document, { section: 'terminal', value: { fontSize: 20 } })
    )

    expect(stored.sections).toEqual({
      editor: valid.sections.editor,
      files: valid.sections.files,
      terminal: { cursorStyle: 'bar', fontSize: 20 },
      appearance: { theme: 'dark' }
    })
  })

  it('読んで書いても内容が変わらない', () => {
    expect(toStoredSettings(parseSettingsDocument(valid).document)).toEqual(valid)
  })
})
