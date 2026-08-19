import { describe, expect, it } from 'vitest'
import { FILES_SETTINGS_SCHEMA_VERSION } from '@shared/settings'
import { parseFilesSettingsDocument } from './filesSettingsDocument'

/**
 * Files 設定文書の検証（Main が見る範囲。Session 3-6-8）。
 *
 * Editor 設定（editorSettingsDocument.test.ts）と同じ分担を確かめる ── Main が見るのは
 * 「**後で解釈できる形か**」までで、mode として意味があるか・幅が妥当かは見ない
 * （それは Renderer の files/filesSettings.ts）。
 */

const valid = {
  schemaVersion: FILES_SETTINGS_SCHEMA_VERSION,
  view: { mode: 'columns', columnWidth: 208 }
}

describe('parseFilesSettingsDocument', () => {
  it('正しい文書はそのまま通す', () => {
    expect(parseFilesSettingsDocument(valid)).toEqual(valid)
  })

  /*
    知らない mode は失敗にしない。アプリをダウングレードすると起きるもので、
    「設定ファイルが壊れている」わけではない。既定へ落とすのは読む側の判断。
  */
  it('知らない mode でも、文字列なら通す（意味は Renderer が決める）', () => {
    expect(
      parseFilesSettingsDocument({ schemaVersion: 1, view: { mode: 'gallery', columnWidth: 208 } })
    ).not.toBeNull()
  })

  it('知らない項目は写さない（余計な内容を保存し続けない）', () => {
    const parsed = parseFilesSettingsDocument({
      ...valid,
      extra: 'x',
      view: { ...valid.view, extra: 1 }
    })

    expect(parsed).toEqual(valid)
  })

  it('文書として読めない値は null', () => {
    for (const raw of [null, undefined, 42, 'x', [], true]) {
      expect(parseFilesSettingsDocument(raw)).toBeNull()
    }
  })

  it('schemaVersion が正の整数でなければ null', () => {
    for (const schemaVersion of [0, -1, 1.5, '1', null, undefined, Number.NaN]) {
      expect(parseFilesSettingsDocument({ ...valid, schemaVersion })).toBeNull()
    }
  })

  it('view がオブジェクトでなければ null', () => {
    for (const view of [null, undefined, 'columns', 42, []]) {
      expect(parseFilesSettingsDocument({ ...valid, view })).toBeNull()
    }
  })

  it('mode が文字列でなければ null', () => {
    for (const mode of [null, undefined, 42, {}, []]) {
      expect(parseFilesSettingsDocument({ ...valid, view: { mode, columnWidth: 208 } })).toBeNull()
    }
  })

  it('columnWidth が有限の数値でなければ null', () => {
    for (const columnWidth of [null, undefined, '208', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        parseFilesSettingsDocument({ ...valid, view: { mode: 'tree', columnWidth } })
      ).toBeNull()
    }
  })

  /*
    上下限そのもの（160px〜480px）は Renderer が掛ける。Main が見るのは
    「桁違いに大きな内容をディスクに残さない」ことだけ。
  */
  it('上下限の外の幅でも、数値なら通す', () => {
    expect(
      parseFilesSettingsDocument({ ...valid, view: { mode: 'tree', columnWidth: -1 } })
    ).not.toBeNull()
  })

  it('桁違いに大きな文書は null', () => {
    expect(
      parseFilesSettingsDocument({
        ...valid,
        view: { mode: 'x'.repeat(20_000), columnWidth: 208 }
      })
    ).toBeNull()
  })
})
