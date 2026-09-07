import { describe, expect, it } from 'vitest'
import { isValidLspRenameName, LSP_RENAME_NEW_NAME_MAX_LENGTH } from './rename'

/**
 * 新しい名前として受け取れる形か（Session 5-9）。
 *
 * 確かめたいのは**識別子として正しいか**ではない。Rename の対象は
 * 変数名とは限らず（JSX の属性・文字列の中の名前）、ここで TypeScript の
 * 規則を当てると正しい要求まで断ることになる（rename.ts）。
 *
 * 落とすのは「境界を越えてはいけない文字列」だけ ── この値は
 * そのまま子プロセスの標準入力へ流れる。
 */
describe('isValidLspRenameName', () => {
  it.each(['value', 'newName', '_private', '$dollar', 'データ', 'has space', 'a-b'])(
    '名前として受け取る: %s',
    (value) => {
      expect(isValidLspRenameName(value)).toBe(true)
    }
  )

  it.each([
    ['空', ''],
    ['空白だけ', '   '],
    ['タブだけ', '\t'],
    ['改行を含む', 'a\nb'],
    ['復帰を含む', 'a\rb'],
    ['NUL を含む', 'a\u0000b'],
    ['DEL を含む', 'a\u007fb']
  ])('断る: %s', (_label, value) => {
    expect(isValidLspRenameName(value)).toBe(false)
  })

  it('長すぎる名前は断る', () => {
    expect(isValidLspRenameName('x'.repeat(LSP_RENAME_NEW_NAME_MAX_LENGTH))).toBe(true)
    expect(isValidLspRenameName('x'.repeat(LSP_RENAME_NEW_NAME_MAX_LENGTH + 1))).toBe(false)
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['数値', 4],
    ['オブジェクト', { newName: 'x' }]
  ])('文字列でない値（%s）は断る', (_label, value) => {
    expect(isValidLspRenameName(value)).toBe(false)
  })
})
