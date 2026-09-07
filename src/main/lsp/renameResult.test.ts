import { describe, expect, it } from 'vitest'
import { parsePrepareRenameResult, parseRenameResult } from './renameResult'

/**
 * サーバの答えをどこまで受け取るか（Session 5-9）。
 *
 * 他の機能の parse と確かめたいことが違う。あちらは「読めたものが正しく写るか」
 * だったが、こちらで一番確かめたいのは**断るべきものを断っているか**になる
 * ── 通してしまった1件は、書き換えられなかった参照として残る
 * （renameResult.ts の冒頭）。
 *
 * | 通すもの                          | 断るもの                                  |
 * | --------------------------------- | ----------------------------------------- |
 * | Workspace の中の既存ファイルの edit | Workspace の外を指す URI                  |
 * | `changes` / `documentChanges` 両形 | CreateFile / RenameFile / DeleteFile      |
 * | 完全に同じ edit の重複（畳む）      | 範囲が重なる edit・順序で結果が変わる edit |
 * |                                   | 壊れた範囲・上限超え                       |
 */

const ROOT = 'D:\\proj'

function uri(relativePath: string): string {
  return `file:///D%3A/proj/${relativePath}`
}

function range(line: number, start: number, end: number): Record<string, unknown> {
  return {
    start: { line, character: start },
    end: { line, character: end }
  }
}

function edit(line: number, start: number, end: number, newText = 'next'): Record<string, unknown> {
  return { range: range(line, start, end), newText }
}

describe('parseRenameResult', () => {
  it('changes の形を相対位置へ落とす', () => {
    const parsed = parseRenameResult(ROOT, {
      changes: {
        [uri('src/app.ts')]: [edit(1, 2, 5)],
        [uri('src/lib/util.ts')]: [edit(0, 0, 3)]
      }
    })

    expect(parsed).toEqual({
      status: 'ok',
      documents: [
        { relativePath: 'src/app.ts', edits: [{ range: range(1, 2, 5), text: 'next' }] },
        { relativePath: 'src/lib/util.ts', edits: [{ range: range(0, 0, 3), text: 'next' }] }
      ]
    })
  })

  it('documentChanges の形も同じ結果になる', () => {
    const parsed = parseRenameResult(ROOT, {
      documentChanges: [
        { textDocument: { uri: uri('src/app.ts'), version: 4 }, edits: [edit(1, 2, 5)] }
      ]
    })

    expect(parsed).toEqual({
      status: 'ok',
      documents: [{ relativePath: 'src/app.ts', edits: [{ range: range(1, 2, 5), text: 'next' }] }]
    })
  })

  it('変えるところが無い答えは、失敗ではなく空として通す', () => {
    expect(parseRenameResult(ROOT, null)).toEqual({ status: 'ok', documents: [] })
    expect(parseRenameResult(ROOT, {})).toEqual({ status: 'ok', documents: [] })
    expect(parseRenameResult(ROOT, { changes: {} })).toEqual({ status: 'ok', documents: [] })
  })

  /**
   * ここが Session 5-9 の境界そのもの。
   *
   * TextEdit の側がどれだけ正しくても、資源操作が1つ混ざれば**全部やめる**。
   * 「使える部分だけ適用する」を選ぶと、ファイルが作られないまま
   * そこを指す import だけが書き換わる。
   */
  it.each([
    ['create', { kind: 'create', uri: uri('src/new.ts') }],
    ['rename', { kind: 'rename', oldUri: uri('src/app.ts'), newUri: uri('src/app2.ts') }],
    ['delete', { kind: 'delete', uri: uri('src/app.ts') }]
  ])('ファイルの %s が混ざれば、TextEdit ごと断る', (_label, operation) => {
    const parsed = parseRenameResult(ROOT, {
      documentChanges: [
        { textDocument: { uri: uri('src/app.ts'), version: 4 }, edits: [edit(1, 2, 5)] },
        operation
      ]
    })

    expect(parsed).toEqual({ status: 'rejected', reason: 'unsupported-edit' })
  })

  it.each([
    ['別のドライブ', 'file:///C%3A/other/app.ts'],
    ['親フォルダ', 'file:///D%3A/app.ts'],
    ['file 以外の scheme', 'untitled:Untitled-1'],
    ['URI ではない文字列', 'src/app.ts']
  ])('%s を指す URI が1つでもあれば、まとめて断る', (_label, outside) => {
    const parsed = parseRenameResult(ROOT, {
      changes: {
        [uri('src/app.ts')]: [edit(1, 2, 5)],
        [outside]: [edit(0, 0, 3)]
      }
    })

    expect(parsed).toEqual({ status: 'rejected', reason: 'outside-workspace' })
  })

  it('同じ範囲へ同じ文字列を置く重複は畳む', () => {
    const parsed = parseRenameResult(ROOT, {
      changes: { [uri('src/app.ts')]: [edit(1, 2, 5), edit(1, 2, 5)] }
    })

    expect(parsed).toEqual({
      status: 'ok',
      documents: [{ relativePath: 'src/app.ts', edits: [{ range: range(1, 2, 5), text: 'next' }] }]
    })
  })

  it('範囲が重なる edit は断る', () => {
    const parsed = parseRenameResult(ROOT, {
      changes: { [uri('src/app.ts')]: [edit(1, 2, 6), edit(1, 4, 8)] }
    })

    expect(parsed).toEqual({ status: 'rejected', reason: 'malformed' })
  })

  it('同じ位置へ入れる長さ0の edit が2件（順序で結果が変わる）は断る', () => {
    const parsed = parseRenameResult(ROOT, {
      changes: { [uri('src/app.ts')]: [edit(1, 2, 2, 'a'), edit(1, 2, 2, 'b')] }
    })

    expect(parsed).toEqual({ status: 'rejected', reason: 'malformed' })
  })

  it('位置の順に並べ替えて返す（サーバの並びに任せない）', () => {
    const parsed = parseRenameResult(ROOT, {
      changes: { [uri('src/app.ts')]: [edit(4, 0, 2), edit(1, 2, 5), edit(2, 0, 1)] }
    })

    expect(
      parsed.status === 'ok' && parsed.documents[0]?.edits.map((e) => e.range.start.line)
    ).toEqual([1, 2, 4])
  })

  it.each([
    ['範囲が無い', { newText: 'next' }],
    ['newText が文字列ではない', { range: range(1, 2, 5), newText: 4 }],
    [
      '行が整数ではない',
      {
        range: { start: { line: 0.5, character: 0 }, end: { line: 1, character: 0 } },
        newText: 'x'
      }
    ],
    ['終わりが始まりより手前', { range: range(1, 6, 2), newText: 'x' }]
  ])('読めない edit（%s）が1件でもあれば断る', (_label, broken) => {
    const parsed = parseRenameResult(ROOT, {
      changes: { [uri('src/app.ts')]: [edit(0, 0, 1), broken] }
    })

    expect(parsed).toEqual({ status: 'rejected', reason: 'malformed' })
  })

  it('ファイルの数が上限を超えれば断る', () => {
    const changes: Record<string, unknown> = {}

    for (let index = 0; index <= 512; index += 1) {
      changes[uri(`src/file${index}.ts`)] = [edit(0, 0, 1)]
    }

    expect(parseRenameResult(ROOT, { changes })).toEqual({
      status: 'rejected',
      reason: 'too-many-edits'
    })
  })

  it('1ファイルの edit が上限を超えれば断る', () => {
    const edits = Array.from({ length: 2049 }, (_value, index) => edit(index, 0, 1))

    expect(parseRenameResult(ROOT, { changes: { [uri('src/app.ts')]: edits } })).toEqual({
      status: 'rejected',
      reason: 'too-many-edits'
    })
  })

  it('置き換える文字列が長すぎれば断る', () => {
    const parsed = parseRenameResult(ROOT, {
      changes: { [uri('src/app.ts')]: [edit(0, 0, 1, 'x'.repeat(4097))] }
    })

    expect(parsed).toEqual({ status: 'rejected', reason: 'malformed' })
  })

  it.each([
    ['配列', []],
    ['文字列', 'edits'],
    ['数値', 4]
  ])('答えそのものが読めない形（%s）なら断る', (_label, value) => {
    expect(parseRenameResult(ROOT, { changes: value })).toEqual({
      status: 'rejected',
      reason: 'malformed'
    })
  })
})

describe('parsePrepareRenameResult', () => {
  it('素の Range を受け取る', () => {
    expect(parsePrepareRenameResult(range(1, 2, 5))).toEqual({
      status: 'ok',
      range: range(1, 2, 5),
      placeholder: null
    })
  })

  it('range + placeholder を受け取る', () => {
    expect(parsePrepareRenameResult({ range: range(1, 2, 5), placeholder: 'value' })).toEqual({
      status: 'ok',
      range: range(1, 2, 5),
      placeholder: 'value'
    })
  })

  /**
   * `defaultBehavior` は「変えられる。範囲はそちらで決めてよい」という答え。
   *
   * Main は文書の本文を持たないため範囲を作れない。null を返して、
   * 単語の切り出しを本文を持つ側（Monaco）へ渡す。
   */
  it('defaultBehavior: true は範囲なしの ok になる', () => {
    expect(parsePrepareRenameResult({ defaultBehavior: true })).toEqual({
      status: 'ok',
      range: null,
      placeholder: null
    })
  })

  it('defaultBehavior: false は「変えられない」', () => {
    expect(parsePrepareRenameResult({ defaultBehavior: false })).toEqual({
      status: 'rejected',
      reason: 'not-renameable'
    })
  })

  it('null は「その位置では変えられない」', () => {
    expect(parsePrepareRenameResult(null)).toEqual({
      status: 'rejected',
      reason: 'not-renameable'
    })
  })

  it.each([
    ['文字列', 'yes'],
    ['壊れた範囲', { start: { line: 1 }, end: { line: 2, character: 0 } }],
    ['range が壊れている', { range: { start: 1, end: 2 } }]
  ])('読めない答え（%s）は malformed', (_label, value) => {
    expect(parsePrepareRenameResult(value)).toEqual({ status: 'rejected', reason: 'malformed' })
  })
})
