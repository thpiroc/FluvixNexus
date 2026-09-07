import type { LspRenameTextEdit } from '@shared/lsp'
import { describe, expect, it } from 'vitest'
import { applyRenameEditsToText, toEditorRenameEdits } from './renameEdits'

/**
 * 置き換えを適用できる形に直す（Session 5-9）。
 *
 * 確かめたいのは**2つの落とし方が同じ判断をするか**にほかならない。
 * 開いているファイル（Monaco の Model）と開いていないファイル（ディスクの中身）で
 * 通す / 断るがずれると、片方のファイルだけが壊れる（renameEdits.ts の冒頭）。
 */

function edit(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
  text: string
): LspRenameTextEdit {
  return {
    range: {
      start: { line: startLine, character: startCharacter },
      end: { line: endLine, character: endCharacter }
    },
    text
  }
}

/** 行の配列から Model の形（1 起点）を作る。 */
function documentOf(lines: readonly string[]): {
  readonly lineCount: number
  readonly getLineMaxColumn: (lineNumber: number) => number
} {
  return {
    lineCount: lines.length,
    getLineMaxColumn: (lineNumber) => (lines[lineNumber - 1]?.length ?? 0) + 1
  }
}

describe('toEditorRenameEdits', () => {
  it('0 起点の位置を、Monaco の 1 起点へ直す', () => {
    const edits = toEditorRenameEdits(
      [edit(0, 6, 0, 9, 'next')],
      documentOf(['const old = 1', 'old()'])
    )

    expect(edits).toEqual([
      {
        range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 10 },
        text: 'next'
      }
    ])
  })

  it('位置の順に並べ替える', () => {
    const edits = toEditorRenameEdits(
      [edit(1, 0, 1, 3, 'b'), edit(0, 0, 0, 3, 'a')],
      documentOf(['old', 'old'])
    )

    expect(edits?.map((entry) => entry.range.startLineNumber)).toEqual([1, 2])
  })

  it.each([
    ['行が文書の外', edit(9, 0, 9, 3, 'x')],
    ['桁が行の外', edit(0, 40, 0, 41, 'x')],
    ['終わりが始まりより手前', edit(0, 3, 0, 1, 'x')]
  ])('範囲が当てられない（%s）なら、その文書ぶんを断る', (_label, broken) => {
    expect(toEditorRenameEdits([edit(0, 0, 0, 3, 'ok'), broken], documentOf(['old']))).toBeNull()
  })

  it('重なる範囲は断る', () => {
    expect(
      toEditorRenameEdits(
        [edit(0, 0, 0, 5, 'a'), edit(0, 3, 0, 8, 'b')],
        documentOf(['abcdefghij'])
      )
    ).toBeNull()
  })

  it('行末（最後の桁）までは当てられる', () => {
    expect(toEditorRenameEdits([edit(0, 0, 0, 3, 'x')], documentOf(['old']))).toEqual([
      { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 }, text: 'x' }
    ])
  })
})

describe('applyRenameEditsToText', () => {
  it('1行の中の置き換え', () => {
    expect(applyRenameEditsToText('const old = 1', [edit(0, 6, 0, 9, 'next')])).toBe(
      'const next = 1'
    )
  })

  /**
   * 後ろから当てる。
   *
   * 前から当てると、1件目で長さが変わって2件目以降の位置がずれる。
   * ここは名前が短くなる（3文字 → 1文字）ので、ずれれば結果に出る。
   */
  it('複数の置き換えを、位置がずれないように当てる', () => {
    expect(
      applyRenameEditsToText('old + old + old', [
        edit(0, 0, 0, 3, 'x'),
        edit(0, 6, 0, 9, 'x'),
        edit(0, 12, 0, 15, 'x')
      ])
    ).toBe('x + x + x')
  })

  it('複数行にまたがる文書（LF）', () => {
    expect(
      applyRenameEditsToText('const old = 1\nold()\n', [
        edit(0, 6, 0, 9, 'next'),
        edit(1, 0, 1, 3, 'next')
      ])
    ).toBe('const next = 1\nnext()\n')
  })

  /**
   * CRLF でも行番号と桁がずれない。
   *
   * `\r\n` は**1つの区切り**として数える（Monaco と LSP の数え方）。
   * 2つと数えると、2行目以降の位置が1文字ずつ手前になる。
   */
  it('複数行にまたがる文書（CRLF）', () => {
    expect(
      applyRenameEditsToText('const old = 1\r\nold()\r\n', [
        edit(0, 6, 0, 9, 'next'),
        edit(1, 0, 1, 3, 'next')
      ])
    ).toBe('const next = 1\r\nnext()\r\n')
  })

  it('CR だけの改行も1つの区切りとして数える', () => {
    expect(applyRenameEditsToText('a\rold\r', [edit(1, 0, 1, 3, 'x')])).toBe('a\rx\r')
  })

  it('範囲が複数行にまたがっていても当てられる', () => {
    expect(applyRenameEditsToText('a(\n  old\n)', [edit(0, 2, 2, 0, '')])).toBe('a()')
  })

  it('置き換えるところが無ければ、そのまま返す', () => {
    expect(applyRenameEditsToText('unchanged', [])).toBe('unchanged')
  })

  it.each([
    ['行が中身の外', edit(9, 0, 9, 1, 'x')],
    ['桁が行の外', edit(0, 40, 0, 41, 'x')],
    ['終わりが始まりより手前', edit(0, 3, 0, 1, 'x')]
  ])('範囲が当てられない（%s）なら null（書かない）', (_label, broken) => {
    expect(applyRenameEditsToText('const old = 1', [broken])).toBeNull()
  })

  it('改行の位置を越える桁は断る（中身が食い違っている合図）', () => {
    expect(applyRenameEditsToText('ab\ncd', [edit(0, 3, 0, 4, 'x')])).toBeNull()
  })

  it('重なる範囲は書かない', () => {
    expect(
      applyRenameEditsToText('abcdefghij', [edit(0, 0, 0, 5, 'a'), edit(0, 3, 0, 8, 'b')])
    ).toBeNull()
  })

  it('同じ位置への長さ0の置き換えが2件なら書かない（順序で結果が変わる）', () => {
    expect(applyRenameEditsToText('ab', [edit(0, 1, 0, 1, 'x'), edit(0, 1, 0, 1, 'y')])).toBeNull()
  })

  it('文書の末尾（改行なし）まで当てられる', () => {
    expect(applyRenameEditsToText('a\nold', [edit(1, 0, 1, 3, 'next')])).toBe('a\nnext')
  })
})
