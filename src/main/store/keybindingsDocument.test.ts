import { describe, expect, it } from 'vitest'
import { KEYBINDING_TEXT_MAX_LENGTH, KEYBINDINGS_MAX_ENTRIES } from '@shared/keybindings'
import {
  parseKeybindingsFile,
  parseSaveKeybindingsRequest,
  parseStoredKeybindingEntry
} from './keybindingsDocument'

/**
 * `keybindings.json` の形の検証（Shortcuts S3）。
 *
 * ここが見るのは形だけ ── command 名や打鍵の意味は Renderer が見る
 * （renderer/src/keybindings/userKeybindings.test.ts）。
 */

describe('parseStoredKeybindingEntry', () => {
  it('key と command を持つ行を読む', () => {
    expect(parseStoredKeybindingEntry({ key: 'ctrl+alt+s', command: 'editor.save' })).toEqual({
      key: 'ctrl+alt+s',
      command: 'editor.save'
    })
  })

  it('意味は見ない（知らない command・読めない打鍵・解除の行も形が合えば通す）', () => {
    expect(parseStoredKeybindingEntry({ key: 'ctrl+notakey', command: 'nope.command' })).toEqual({
      key: 'ctrl+notakey',
      command: 'nope.command'
    })
    expect(parseStoredKeybindingEntry({ key: 'ctrl+s', command: '-editor.save' })).toEqual({
      key: 'ctrl+s',
      command: '-editor.save'
    })
  })

  it('契約に無い key は落とす', () => {
    expect(
      parseStoredKeybindingEntry({ key: 'ctrl+s', command: 'editor.save', args: { a: 1 } })
    ).toEqual({ key: 'ctrl+s', command: 'editor.save' })
  })

  it('when が文字列なら渡す（読めない行として扱うのは Renderer）', () => {
    expect(
      parseStoredKeybindingEntry({ key: 'ctrl+s', command: 'editor.save', when: 'editorFocus' })
    ).toEqual({ key: 'ctrl+s', command: 'editor.save', when: 'editorFocus' })
  })

  it.each([
    ['オブジェクトでない', 'ctrl+s'],
    ['配列', ['ctrl+s', 'editor.save']],
    ['null', null],
    ['key が無い', { command: 'editor.save' }],
    ['key が空', { key: '', command: 'editor.save' }],
    ['command が数値', { key: 'ctrl+s', command: 1 }],
    ['key が長すぎる', { key: 'a'.repeat(KEYBINDING_TEXT_MAX_LENGTH + 1), command: 'editor.save' }],
    ['when が文字列でない', { key: 'ctrl+s', command: 'editor.save', when: ['editorFocused'] }]
  ])('形が合わなければ null（%s）', (_label, raw) => {
    expect(parseStoredKeybindingEntry(raw)).toBeNull()
  })
})

describe('parseKeybindingsFile', () => {
  it('配列でなければ読めないファイル', () => {
    expect(parseKeybindingsFile({ key: 'ctrl+s', command: 'editor.save' })).toBeNull()
    expect(parseKeybindingsFile(null)).toBeNull()
  })

  it('空の配列は割り当て無し', () => {
    expect(parseKeybindingsFile([])).toEqual({ entries: [], skippedCount: 0 })
  })

  it('形の合わない行だけを落とし、数と並び順を保つ', () => {
    expect(
      parseKeybindingsFile([
        { key: 'ctrl+1', command: 'a' },
        'broken',
        { key: 'ctrl+2', command: 'b' },
        { key: 3 },
        { key: 'ctrl+3', command: 'c' }
      ])
    ).toEqual({
      entries: [
        { key: 'ctrl+1', command: 'a' },
        { key: 'ctrl+2', command: 'b' },
        { key: 'ctrl+3', command: 'c' }
      ],
      skippedCount: 2
    })
  })

  it('上限を超えた行は読み飛ばした数に入る', () => {
    const raw = Array.from({ length: KEYBINDINGS_MAX_ENTRIES + 3 }, (_, index) => ({
      key: 'ctrl+s',
      command: `c${String(index)}`
    }))

    const parsed = parseKeybindingsFile(raw)

    expect(parsed?.entries).toHaveLength(KEYBINDINGS_MAX_ENTRIES)
    expect(parsed?.skippedCount).toBe(3)
  })
})

describe('parseSaveKeybindingsRequest', () => {
  it('形の合った行の並びを通す', () => {
    expect(
      parseSaveKeybindingsRequest({
        entries: [
          { key: 'ctrl+s', command: '-editor.save' },
          { key: 'ctrl+alt+s', command: 'editor.save' }
        ]
      })
    ).toEqual({
      entries: [
        { key: 'ctrl+s', command: '-editor.save' },
        { key: 'ctrl+alt+s', command: 'editor.save' }
      ]
    })
  })

  it('空の並びは「割り当てを全部既定へ戻す」として通す', () => {
    expect(parseSaveKeybindingsRequest({ entries: [] })).toEqual({ entries: [] })
  })

  it('1行でも形が合わなければ保存に進まない（黙って削らない）', () => {
    expect(
      parseSaveKeybindingsRequest({
        entries: [{ key: 'ctrl+s', command: 'editor.save' }, { key: 'ctrl+o' }]
      })
    ).toBeNull()
  })

  it.each([
    ['要求が無い', undefined],
    ['entries が無い', {}],
    ['entries が配列でない', { entries: 'ctrl+s' }]
  ])('要求の形が違えば null（%s）', (_label, request) => {
    expect(parseSaveKeybindingsRequest(request)).toBeNull()
  })

  it('上限を超える行数は保存しない', () => {
    const entries = Array.from({ length: KEYBINDINGS_MAX_ENTRIES + 1 }, () => ({
      key: 'ctrl+s',
      command: 'editor.save'
    }))

    expect(parseSaveKeybindingsRequest({ entries })).toBeNull()
  })
})
