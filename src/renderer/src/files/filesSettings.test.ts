import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILES_COLUMN_WIDTH,
  FILES_COLUMN_WIDTH_MAX,
  FILES_COLUMN_WIDTH_MIN
} from './filesLayoutMode'
import {
  clampColumnWidth,
  DEFAULT_FILES_VIEW_SETTINGS,
  isSameFilesViewSettings,
  toFilesSettingsSection,
  toFilesViewSettings
} from './filesSettings'

/**
 * Files の見え方の設定モデル（Session 3-6-8 / 保存形式は Session 4-3A の `files` section）。
 *
 * 確かめるのは4つ。
 *   - **保存形式との往復で失われないこと**（選んだ表示方式・幅）
 *   - **`auto` が「選んでいない」として往復すること**（保存しないことで表さない）
 *   - 知らない値・桁外れの幅が既定と上下限へ落ちること（意味を見るのは Renderer 側）
 *   - **落ちるのが key ごとであること**（片方が読めなくても、もう片方は残る）
 */

describe('toFilesViewSettings', () => {
  it('保存が無ければ既定（パネルの形に任せる）', () => {
    expect(toFilesViewSettings({})).toEqual(DEFAULT_FILES_VIEW_SETTINGS)
  })

  it('選んだ表示方式を explicit として読む', () => {
    const settings = toFilesViewSettings({ viewMode: 'columns', columnWidth: 240 })

    expect(settings.preference).toEqual({ kind: 'explicit', mode: 'columns' })
    expect(settings.columnWidth).toBe(240)
  })

  it('auto は「選んでいない」として読む', () => {
    const settings = toFilesViewSettings({
      viewMode: 'auto',
      columnWidth: DEFAULT_FILES_COLUMN_WIDTH
    })

    expect(settings.preference).toEqual({ kind: 'auto' })
  })

  /*
    アプリをダウングレードすると起きる（後のバージョンで足した表示方式が保存されている）。
    「知らない表示方式で固定されて動かない」より、パネルの形に任せる状態から始まる方がよい。
  */
  it('知らない mode は「パネルの形に任せる」へ落ちる', () => {
    const settings = toFilesViewSettings({ viewMode: 'gallery', columnWidth: 208 })

    expect(settings.preference).toEqual({ kind: 'auto' })
  })

  it('上下限の外の幅は上下限へ落ちる', () => {
    const narrow = toFilesViewSettings({ viewMode: 'tree', columnWidth: 1 })
    const wide = toFilesViewSettings({ viewMode: 'tree', columnWidth: 100_000 })

    expect(narrow.columnWidth).toBe(FILES_COLUMN_WIDTH_MIN)
    expect(wide.columnWidth).toBe(FILES_COLUMN_WIDTH_MAX)
  })

  /*
    key 単位で落ちること（Session 4-3A）。旧形式では `view` が入れ子だったため、
    片方が壊れているとどちらも失われていた。
  */
  it('mode だけが無くても幅は残る', () => {
    const settings = toFilesViewSettings({ columnWidth: 300 })

    expect(settings.preference).toEqual({ kind: 'auto' })
    expect(settings.columnWidth).toBe(300)
  })

  it('幅だけが無くても選んだ表示方式は残る', () => {
    const settings = toFilesViewSettings({ viewMode: 'columns' })

    expect(settings.preference).toEqual({ kind: 'explicit', mode: 'columns' })
    expect(settings.columnWidth).toBe(DEFAULT_FILES_COLUMN_WIDTH)
  })
})

describe('toFilesSettingsSection', () => {
  it('選んだ表示方式と幅を保存形式へ写す', () => {
    expect(
      toFilesSettingsSection({
        preference: { kind: 'explicit', mode: 'tree' },
        columnWidth: 240
      })
    ).toEqual({ viewMode: 'tree', columnWidth: 240 })
  })

  /*
    **選んでいないことも保存する。** 保存しないことで表すと、カラムを選んでから
    「パネルの形に任せる」へ戻したときに、次の起動で前の選択が復活する。
  */
  it('パネルの形に任せる状態は auto として保存する', () => {
    expect(toFilesSettingsSection(DEFAULT_FILES_VIEW_SETTINGS).viewMode).toBe('auto')
  })

  it('保存形式と往復しても変わらない', () => {
    for (const settings of [
      DEFAULT_FILES_VIEW_SETTINGS,
      { preference: { kind: 'explicit', mode: 'tree' }, columnWidth: FILES_COLUMN_WIDTH_MIN },
      { preference: { kind: 'explicit', mode: 'columns' }, columnWidth: 300 }
    ] as const) {
      expect(toFilesViewSettings(toFilesSettingsSection(settings))).toEqual(settings)
    }
  })
})

describe('clampColumnWidth', () => {
  it('範囲の中はそのまま（端数は丸める）', () => {
    expect(clampColumnWidth(240)).toBe(240)
    expect(clampColumnWidth(240.4)).toBe(240)
  })

  it('範囲の外は上下限で止まる', () => {
    expect(clampColumnWidth(0)).toBe(FILES_COLUMN_WIDTH_MIN)
    expect(clampColumnWidth(-500)).toBe(FILES_COLUMN_WIDTH_MIN)
    expect(clampColumnWidth(10_000)).toBe(FILES_COLUMN_WIDTH_MAX)
  })

  it('数値でない値は既定へ落ちる', () => {
    expect(clampColumnWidth(Number.NaN)).toBe(DEFAULT_FILES_COLUMN_WIDTH)
    expect(clampColumnWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_FILES_COLUMN_WIDTH)
  })
})

describe('isSameFilesViewSettings', () => {
  it('同じ内容なら true', () => {
    expect(
      isSameFilesViewSettings(DEFAULT_FILES_VIEW_SETTINGS, { ...DEFAULT_FILES_VIEW_SETTINGS })
    ).toBe(true)
  })

  it('表示方式か幅が違えば false', () => {
    expect(
      isSameFilesViewSettings(DEFAULT_FILES_VIEW_SETTINGS, {
        ...DEFAULT_FILES_VIEW_SETTINGS,
        columnWidth: 300
      })
    ).toBe(false)

    expect(
      isSameFilesViewSettings(DEFAULT_FILES_VIEW_SETTINGS, {
        ...DEFAULT_FILES_VIEW_SETTINGS,
        preference: { kind: 'explicit', mode: 'tree' }
      })
    ).toBe(false)

    expect(
      isSameFilesViewSettings(
        { ...DEFAULT_FILES_VIEW_SETTINGS, preference: { kind: 'explicit', mode: 'tree' } },
        { ...DEFAULT_FILES_VIEW_SETTINGS, preference: { kind: 'explicit', mode: 'columns' } }
      )
    ).toBe(false)
  })
})
