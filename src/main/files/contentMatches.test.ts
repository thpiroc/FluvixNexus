import { describe, expect, it } from 'vitest'
import { FILE_CONTENT_SEARCH_PREVIEW_LEAD } from '@shared/files'
import { buildMatchPreview, findContentMatches } from './contentMatches'

/**
 * 行の中の一致の探し方と、周辺のテキストの切り出し（Session 3-6-5）。
 *
 * ここで固定したいのは**位置**にあたる。行・桁・preview の中での位置がずれると、
 * 結果を押したときに Editor が1文字手前へ飛ぶ・印が隣の文字に付く、という形で
 * 表に出る（見た目には「だいたい合っている」ので気づきにくい）。
 *
 * ディスクは触らない。読むのは searchWorkspaceFileContents.ts の仕事で、
 * この層が持つのは「文字列 → 一致の位置」だけになる。
 */

describe('findContentMatches', () => {
  it('行と桁を1始まりで返す', () => {
    const { matches } = findContentMatches('first\nconst example = 1\nlast', 'example')

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ line: 2, column: 7, length: 7 })
  })

  it('大文字 / 小文字を区別しない', () => {
    expect(findContentMatches('const Example = 1', 'example').matches).toHaveLength(1)
    expect(findContentMatches('const example = 1', 'EXAMPLE').matches).toHaveLength(1)
  })

  it('日本語を桁までそろえて見つける', () => {
    const { matches } = findContentMatches('// これは検索の例です', '検索')

    expect(matches[0]).toMatchObject({ line: 1, column: 7, length: 2 })
    expect(matches[0]?.preview).toBe('// これは検索の例です')
    // preview の中の位置は、切り詰めていなければ行の中の位置と同じ。
    expect(matches[0]?.previewColumn).toBe(7)
  })

  it('1行に複数あればすべて返す', () => {
    const { matches } = findContentMatches('ab ab ab', 'ab')

    expect(matches.map((match) => match.column)).toEqual([1, 4, 7])
  })

  it('重なる一致は数えない', () => {
    const { matches } = findContentMatches('aaaa', 'aa')

    expect(matches.map((match) => match.column)).toEqual([1, 3])
  })

  it('複数の行にまたがってもすべて返す', () => {
    const { matches } = findContentMatches('hit\nmiss\nhit', 'hit')

    expect(matches.map((match) => match.line)).toEqual([1, 3])
  })

  it('CRLF の行でも桁がずれない', () => {
    const { matches } = findContentMatches('a\r\nxhit\r\n', 'hit')

    expect(matches[0]).toMatchObject({ line: 2, column: 2 })
    // 行末の `\r` は preview にも入れない。
    expect(matches[0]?.preview).toBe('xhit')
  })

  it('タブは preview の中で空白に置き換わる（桁はずれない）', () => {
    const { matches } = findContentMatches('\t\thit', 'hit')

    expect(matches[0]).toMatchObject({ column: 3 })
    expect(matches[0]?.preview).toBe('  hit')
    expect(matches[0]?.previewColumn).toBe(3)
  })

  it('空の検索語では何も返さない', () => {
    expect(findContentMatches('anything', '').matches).toEqual([])
  })

  it('見つからなければ空', () => {
    expect(findContentMatches('nothing here', 'example')).toEqual({
      matches: [],
      truncated: false
    })
  })
})

describe('1ファイルあたりの上限', () => {
  it('上限まで取り、打ち切ったことを伝える', () => {
    const text = Array.from({ length: 10 }, () => 'hit').join('\n')
    const outcome = findContentMatches(text, 'hit', 3)

    expect(outcome.matches).toHaveLength(3)
    expect(outcome.truncated).toBe(true)
  })

  it('1行の途中でも上限で止める', () => {
    const outcome = findContentMatches('hit hit hit hit', 'hit', 2)

    expect(outcome.matches.map((match) => match.column)).toEqual([1, 5])
    expect(outcome.truncated).toBe(true)
  })

  it('ちょうど上限で見終わった場合は打ち切りにしない', () => {
    const outcome = findContentMatches('hit\nhit', 'hit', 2)

    expect(outcome.matches).toHaveLength(2)
    // まだ続きがあるように見せない（「2 件ちょうど」が毎回打ち切り扱いになる）。
    expect(outcome.truncated).toBe(false)
  })
})

describe('preview の切り出し', () => {
  it('長い行は一致の周りだけを切り出し、両端に印を付ける', () => {
    const line = `${'a'.repeat(200)}hit${'b'.repeat(200)}`
    const { matches } = findContentMatches(line, 'hit', 10, 40)
    const match = matches[0]

    expect(match).toBeDefined()
    expect(match?.preview.startsWith('…')).toBe(true)
    expect(match?.preview.endsWith('…')).toBe(true)
    // 印の2文字を除いた中身が、指定した長さに収まっている。
    expect((match?.preview.length ?? 0) - 2).toBe(40)
    // 一致の直前は決められた長さだけ残る（何の中で一致したかが読めるように）。
    expect(match?.previewColumn).toBe(FILE_CONTENT_SEARCH_PREVIEW_LEAD + 2)
  })

  it('行の先頭に近ければ前を切らない', () => {
    const { preview, previewColumn } = buildMatchPreview('const hit = 1', 6, 40)

    expect(preview).toBe('const hit = 1')
    expect(previewColumn).toBe(7)
  })

  it('previewColumn の位置に検索語がある', () => {
    const line = `${'x'.repeat(120)}needle tail`
    const { matches } = findContentMatches(line, 'needle', 10, 40)
    const match = matches[0]

    if (match === undefined) {
      throw new Error('一致が返っていない')
    }

    const start = match.previewColumn - 1

    expect(match.preview.slice(start, start + 'needle'.length)).toBe('needle')
  })
})
