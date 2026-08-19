import { describe, expect, it } from 'vitest'
import { EDITOR_SETTINGS_SCHEMA_VERSION } from '@shared/settings'
import { parseEditorSettingsDocument } from './editorSettingsDocument'

/**
 * Editor 設定文書の検証（Main が見る範囲）。
 *
 * Main が見るのは「**後で解釈できる形か**」までで、mode として意味があるかは見ない
 * （それは Renderer の editor/autoSave.ts）。レイアウト（§7.8）と同じ分担で、
 * 二重に解釈すると「どちらが正しいか」が生まれる。
 *
 * 読む側（保存ファイル）と書く側（Renderer からの保存要求）の両方がここを通る。
 */

const valid = {
  schemaVersion: EDITOR_SETTINGS_SCHEMA_VERSION,
  autoSave: { mode: 'afterDelay', delayMs: 1000 }
}

describe('parseEditorSettingsDocument', () => {
  it('正しい文書はそのまま通す', () => {
    expect(parseEditorSettingsDocument(valid)).toEqual(valid)
  })

  /*
    知らない mode は失敗にしない。アプリをダウングレードすると起きるもので、
    「設定ファイルが壊れている」わけではない。既定へ落とすのは読む側の判断。
  */
  it('知らない mode でも、文字列なら通す（意味は Renderer が決める）', () => {
    expect(
      parseEditorSettingsDocument({
        schemaVersion: 1,
        autoSave: { mode: 'onSomethingNew', delayMs: 1000 }
      })
    ).not.toBeNull()
  })

  it('知らない項目は写さない（余計な内容を保存し続けない）', () => {
    const parsed = parseEditorSettingsDocument({
      ...valid,
      extra: 'x',
      autoSave: { ...valid.autoSave, extra: 1 }
    })

    expect(parsed).toEqual(valid)
  })

  it('文書として読めない値は null', () => {
    for (const raw of [null, undefined, 42, 'x', [], true]) {
      expect(parseEditorSettingsDocument(raw)).toBeNull()
    }
  })

  it('schemaVersion が正の整数でなければ null', () => {
    for (const schemaVersion of [0, -1, 1.5, '1', null, undefined, Number.NaN]) {
      expect(parseEditorSettingsDocument({ ...valid, schemaVersion })).toBeNull()
    }
  })

  it('autoSave がオブジェクトでなければ null', () => {
    for (const autoSave of [null, undefined, 'afterDelay', 42, []]) {
      expect(parseEditorSettingsDocument({ ...valid, autoSave })).toBeNull()
    }
  })

  it('mode が文字列でなければ null', () => {
    for (const mode of [null, undefined, 42, {}, []]) {
      expect(
        parseEditorSettingsDocument({ ...valid, autoSave: { mode, delayMs: 1000 } })
      ).toBeNull()
    }
  })

  it('delayMs が有限の数値でなければ null', () => {
    for (const delayMs of [null, undefined, '1000', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        parseEditorSettingsDocument({ ...valid, autoSave: { mode: 'off', delayMs } })
      ).toBeNull()
    }
  })

  /*
    上下限そのもの（200ms〜60s）は Renderer が掛ける。Main が見るのは
    「桁違いに大きな内容をディスクに残さない」ことだけ。
  */
  it('上下限の外の待ち時間でも、数値なら通す', () => {
    expect(
      parseEditorSettingsDocument({ ...valid, autoSave: { mode: 'off', delayMs: -1 } })
    ).not.toBeNull()
  })

  it('桁違いに大きな文書は null', () => {
    expect(
      parseEditorSettingsDocument({ ...valid, autoSave: { mode: 'x'.repeat(20_000), delayMs: 1 } })
    ).toBeNull()
  })
})
