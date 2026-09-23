import { describe, expect, it } from 'vitest'
import { createLineDiff, DIFF_LCS_MAX_LINES, type DiffLine } from './fileWriteDiff'

/**
 * 行の差分（Security Core v1 の STEP7）。
 *
 * 見ているのは「何が変わったと**見せる**か」で、書く中身とは別の話にあたる。
 */

function shape(lines: readonly DiffLine[] | null): readonly string[] {
  if (lines === null) {
    throw new Error('expected a diff')
  }

  return lines.map((line) => `${mark(line.kind)}${line.text}`)
}

function mark(kind: DiffLine['kind']): string {
  return kind === 'added' ? '+' : kind === 'removed' ? '-' : ' '
}

describe('新しいファイル', () => {
  it('空 → 中身は、すべて追加になる', () => {
    expect(shape(createLineDiff('', 'a\nb\n'))).toEqual(['+a', '+b'])
  })

  it('空 → 空は、行が1つも出ない', () => {
    expect(shape(createLineDiff('', ''))).toEqual([])
  })

  it('追加された行には、変更後の行番号だけが付く', () => {
    const lines = createLineDiff('', 'a\nb\n')

    expect(lines?.map((line) => [line.oldLine, line.newLine])).toEqual([
      [null, 1],
      [null, 2]
    ])
  })
})

describe('既存ファイル', () => {
  it('変わっていなければ、すべて context になる', () => {
    expect(shape(createLineDiff('a\nb\n', 'a\nb\n'))).toEqual([' a', ' b'])
  })

  it('1行だけ足したとき、他の行は context のまま', () => {
    expect(shape(createLineDiff('a\nb\n', 'a\nx\nb\n'))).toEqual([' a', '+x', ' b'])
  })

  it('1行だけ消したとき、他の行は context のまま', () => {
    expect(shape(createLineDiff('a\nb\nc\n', 'a\nc\n'))).toEqual([' a', '-b', ' c'])
  })

  it('書き換えは、消してから足す並びになる', () => {
    expect(shape(createLineDiff('a\nb\nc\n', 'a\nB\nc\n'))).toEqual([' a', '-b', '+B', ' c'])
  })

  it('全部消すと、追加は1行も出ない', () => {
    expect(shape(createLineDiff('a\nb\n', ''))).toEqual(['-a', '-b'])
  })

  it('行番号は、変更前と変更後でそれぞれ数える', () => {
    const lines = createLineDiff('a\nb\nc\n', 'a\nB\nc\n')

    expect(lines?.map((line) => [line.kind, line.oldLine, line.newLine])).toEqual([
      ['context', 1, 1],
      ['removed', 2, null],
      ['added', null, 2],
      ['context', 3, 3]
    ])
  })
})

describe('改行の扱い', () => {
  it('末尾の改行は、最後の空行を作らない', () => {
    expect(shape(createLineDiff('', 'a\n'))).toEqual(['+a'])
  })

  it('空行そのものは残る', () => {
    expect(shape(createLineDiff('', 'a\n\n'))).toEqual(['+a', '+'])
  })

  it('CRLF と LF の違いは差分として出る（行末の \\r を落とさない）', () => {
    const lines = createLineDiff('a\r\nb\r\n', 'a\nb\n')

    expect(lines?.every((line) => line.kind !== 'context')).toBe(true)
  })

  it('末尾の改行が付いた / 消えただけなら、行の並びは変わらない', () => {
    expect(shape(createLineDiff('a', 'a\n'))).toEqual([' a'])
  })
})

describe('Unicode', () => {
  it('日本語の行も1行として扱う', () => {
    expect(shape(createLineDiff('こんにちは\n', 'こんばんは\n'))).toEqual([
      '-こんにちは',
      '+こんばんは'
    ])
  })

  it('絵文字を含む行も、同じなら context になる', () => {
    expect(shape(createLineDiff('a👍b\n', 'a👍b\n'))).toEqual([' a👍b'])
  })
})

describe('大きすぎるもの', () => {
  it('上限を超えたら、全部消して全部足す形へ倒す', () => {
    const before = `${'x\n'.repeat(DIFF_LCS_MAX_LINES + 1)}`
    const after = `${'x\n'.repeat(DIFF_LCS_MAX_LINES + 1)}`
    const lines = createLineDiff(before, after)

    expect(lines?.some((line) => line.kind === 'context')).toBe(false)
    expect(lines?.length).toBe((DIFF_LCS_MAX_LINES + 1) * 2)
  })
})

describe('作れないもの', () => {
  it('文字列でなければ null', () => {
    expect(createLineDiff(null, 'a')).toBeNull()
    expect(createLineDiff('a', undefined)).toBeNull()
    expect(createLineDiff({ toString: () => 'a' }, 'a')).toBeNull()
  })
})
