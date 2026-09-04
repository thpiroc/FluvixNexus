import { describe, expect, it } from 'vitest'
import { migrateLegacySettings } from './legacySettings'

/**
 * 旧3ファイルからの取り込み（Session 4-3A）。
 *
 * 確かめたいのは3つ。
 *   - **読める旧設定だけが移ること**（版は見ない。形だけを見る）
 *   - **1つが壊れていても、他は移ること**（旧形式の利点をそのまま持ち越す）
 *   - **移すものが無ければ、移行と数えないこと**（初回起動で空のファイルを作らない）
 */

const editor = { schemaVersion: 1, autoSave: { mode: 'afterDelay', delayMs: 3000 } }
const files = { schemaVersion: 1, view: { mode: 'columns', columnWidth: 240 } }
const terminal = { schemaVersion: 1, display: { fontSize: 20, scrollback: 1000 } }

describe('migrateLegacySettings', () => {
  it('3つとも読めれば、3つとも移す', () => {
    const { sections, migrated } = migrateLegacySettings({ editor, files, terminal })

    expect(sections).toEqual({
      editor: { autoSaveMode: 'afterDelay', autoSaveDelayMs: 3000 },
      files: { viewMode: 'columns', columnWidth: 240 },
      terminal: { fontSize: 20, scrollback: 1000 },
      appearance: {}
    })
    expect(migrated).toEqual(['editor', 'files', 'terminal'])
  })

  /*
    旧ファイルを持たない section（Session 4-4 の `appearance` 以降）は空のまま。
    `appearance-settings.json` は世の中に1つも無く、**旧ファイルの集合は
    後から増えない**（legacySettings.ts の `LegacySettingsSectionId`）。
  */
  it('旧ファイルを持たない section は空のまま（移行の対象にもならない）', () => {
    const { sections, migrated } = migrateLegacySettings({ editor, files, terminal })

    expect(sections.appearance).toEqual({})
    expect(migrated).not.toContain('appearance')
  })

  it('1つが壊れていても、他の2つは移す', () => {
    const { sections, migrated } = migrateLegacySettings({
      editor,
      files: 'not a document',
      terminal
    })

    expect(sections.files).toEqual({})
    expect(sections.editor).toEqual({ autoSaveMode: 'afterDelay', autoSaveDelayMs: 3000 })
    expect(sections.terminal).toEqual({ fontSize: 20, scrollback: 1000 })
    expect(migrated).toEqual(['editor', 'terminal'])
  })

  it('一部のファイルしか無くても移す', () => {
    const { sections, migrated } = migrateLegacySettings({ terminal })

    expect(sections.terminal).toEqual({ fontSize: 20, scrollback: 1000 })
    expect(migrated).toEqual(['terminal'])
  })

  /* 旧形式は入れ子だったので、そこが壊れていればその用途だけが移せない。 */
  it('入れ子が object でなければ、その section は移さない', () => {
    const { sections } = migrateLegacySettings({ editor: { schemaVersion: 1, autoSave: 42 } })

    expect(sections.editor).toEqual({})
  })

  it('読める key だけを移す（片方が壊れていても、もう片方は移す）', () => {
    const { sections, migrated } = migrateLegacySettings({
      terminal: { schemaVersion: 1, display: { fontSize: 'big', scrollback: 1000 } }
    })

    expect(sections.terminal).toEqual({ scrollback: 1000 })
    expect(migrated).toEqual(['terminal'])
  })

  /* 版は見ない。読める形なら移す価値があり、意味を落とすのは読む側。 */
  it('旧ファイルの schemaVersion は見ない', () => {
    const { sections } = migrateLegacySettings({
      files: { schemaVersion: 99, view: { mode: 'tree', columnWidth: 300 } }
    })

    expect(sections.files).toEqual({ viewMode: 'tree', columnWidth: 300 })
  })

  it('知らない mode でも移す（意味は Renderer が決める）', () => {
    const { sections } = migrateLegacySettings({
      editor: { autoSave: { mode: 'onSomethingNew', delayMs: 1000 } }
    })

    expect(sections.editor.autoSaveMode).toBe('onSomethingNew')
  })

  it('移すものが1つも無ければ、移行と数えない', () => {
    expect(migrateLegacySettings({}).migrated).toEqual([])
    expect(migrateLegacySettings({ editor: null, files: 42, terminal: [] }).migrated).toEqual([])
  })
})
