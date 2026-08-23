import { describe, expect, it } from 'vitest'
import { TERMINAL_SETTINGS_SCHEMA_VERSION } from '@shared/settings'
import { parseTerminalSettingsDocument } from './terminalSettingsDocument'

/**
 * Terminal 設定文書の検証（Main が見る範囲。Session 3-7-5）。
 *
 * Editor / Files 設定（editorSettingsDocument.test.ts / filesSettingsDocument.test.ts）と
 * 同じ分担を確かめる ── Main が見るのは「**後で解釈できる形か**」までで、
 * 8〜32px や 500〜50000 行に収まっているかは見ない
 * （それは Renderer の terminal/terminalDisplay.ts）。
 */

const valid = {
  schemaVersion: TERMINAL_SETTINGS_SCHEMA_VERSION,
  display: { fontSize: 15, scrollback: 8000 }
}

describe('parseTerminalSettingsDocument', () => {
  it('正しい文書はそのまま通す', () => {
    expect(parseTerminalSettingsDocument(valid)).toEqual(valid)
  })

  it('知らない項目は写さない（余計な内容を保存し続けない）', () => {
    const parsed = parseTerminalSettingsDocument({
      ...valid,
      extra: 'x',
      display: { ...valid.display, extra: 1 }
    })

    expect(parsed).toEqual(valid)
  })

  it('文書として読めない値は null', () => {
    for (const raw of [null, undefined, 42, 'x', [], true]) {
      expect(parseTerminalSettingsDocument(raw)).toBeNull()
    }
  })

  it('schemaVersion が正の整数でなければ null', () => {
    for (const schemaVersion of [0, -1, 1.5, '1', null, undefined, Number.NaN]) {
      expect(parseTerminalSettingsDocument({ ...valid, schemaVersion })).toBeNull()
    }
  })

  it('display がオブジェクトでなければ null', () => {
    for (const display of [null, undefined, 'large', 42, []]) {
      expect(parseTerminalSettingsDocument({ ...valid, display })).toBeNull()
    }
  })

  it('fontSize が有限の数値でなければ null', () => {
    for (const fontSize of [null, undefined, '13', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        parseTerminalSettingsDocument({ ...valid, display: { fontSize, scrollback: 5000 } })
      ).toBeNull()
    }
  })

  it('scrollback が有限の数値でなければ null', () => {
    for (const scrollback of [null, undefined, '5000', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        parseTerminalSettingsDocument({ ...valid, display: { fontSize: 13, scrollback } })
      ).toBeNull()
    }
  })

  /*
    上下限そのもの（8〜32px / 500〜50000 行）は Renderer が掛ける。Main が見るのは
    「桁違いに大きな内容をディスクに残さない」ことだけ。
  */
  it('範囲の外の値でも、数値なら通す', () => {
    expect(
      parseTerminalSettingsDocument({ ...valid, display: { fontSize: 999, scrollback: -1 } })
    ).not.toBeNull()
  })

  it('桁違いに大きな文書は null', () => {
    expect(parseTerminalSettingsDocument({ ...valid, note: 'x'.repeat(20_000) })).toBeNull()
  })
})
