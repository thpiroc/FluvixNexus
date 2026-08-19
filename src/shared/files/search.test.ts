import { describe, expect, it } from 'vitest'
import { findFileNameMatch, matchesFileNameQuery } from './search'

/**
 * 名前の照合の検証（Session 3-6-4）。
 *
 * 確かめたいのは2つ。
 *   - 一致の判断が大文字 / 小文字を区別しない部分一致であること
 *   - 印を付ける範囲が、**元の名前の位置**として正しいこと
 *     （位置を保証できない場合は返さないこと）
 */

describe('matchesFileNameQuery', () => {
  it('部分一致で見つかる', () => {
    expect(matchesFileNameQuery('workspacePath.ts', 'space')).toBe(true)
    expect(matchesFileNameQuery('workspacePath.ts', 'workspacePath.ts')).toBe(true)
    expect(matchesFileNameQuery('workspacePath.ts', '.ts')).toBe(true)
  })

  it('大文字 / 小文字を区別しない', () => {
    expect(matchesFileNameQuery('WorkspacePath.ts', 'workspace')).toBe(true)
    expect(matchesFileNameQuery('workspacepath.ts', 'WORKSPACE')).toBe(true)
    expect(matchesFileNameQuery('README.md', 'readme')).toBe(true)
  })

  it('含まれていなければ一致しない', () => {
    expect(matchesFileNameQuery('workspacePath.ts', 'terminal')).toBe(false)
  })

  /*
    空の検索語で「すべて一致」にしない。Workspace の全ファイルを
    列挙するのと同じことになり、上限の意味が無くなる。
  */
  it('空の検索語は一致しない', () => {
    expect(matchesFileNameQuery('anything.txt', '')).toBe(false)
  })

  it('空白や記号もそのまま探す（trim しない）', () => {
    expect(matchesFileNameQuery('my notes.txt', ' notes')).toBe(true)
    expect(matchesFileNameQuery('report (1).txt', '(1)')).toBe(true)
    expect(matchesFileNameQuery('a+b[c].txt', '+b[c]')).toBe(true)
  })

  it('日本語の名前も探せる', () => {
    expect(matchesFileNameQuery('設計メモ.md', 'メモ')).toBe(true)
    expect(matchesFileNameQuery('設計メモ.md', '仕様')).toBe(false)
  })

  /* 正規表現として解釈しない（`.` は任意の1文字ではない）。 */
  it('検索語は字義どおりに扱う', () => {
    expect(matchesFileNameQuery('abc.txt', 'a.c')).toBe(false)
    expect(matchesFileNameQuery('a.c.txt', 'a.c')).toBe(true)
  })
})

describe('findFileNameMatch', () => {
  it('元の名前での位置を返す', () => {
    expect(findFileNameMatch('workspacePath.ts', 'Path')).toEqual({ start: 9, length: 4 })
  })

  it('大文字 / 小文字が違っても位置は変わらない', () => {
    expect(findFileNameMatch('WorkspacePath.ts', 'workspace')).toEqual({ start: 0, length: 9 })
  })

  it('最初の一致だけを返す', () => {
    expect(findFileNameMatch('test.test.ts', 'test')).toEqual({ start: 0, length: 4 })
  })

  it('一致しなければ null', () => {
    expect(findFileNameMatch('workspacePath.ts', 'terminal')).toBeNull()
    expect(findFileNameMatch('workspacePath.ts', '')).toBeNull()
  })

  /*
    `İ`（U+0130）は小文字にすると2文字になる。畳んだ側で求めた位置は
    元の名前とずれるため、**印は付けない**（一致そのものは別の関数が答える）。
  */
  it('畳むと長さが変わる文字を含む名前では位置を返さない', () => {
    expect(matchesFileNameQuery('İstanbul.txt', 'stanbul')).toBe(true)
    expect(findFileNameMatch('İstanbul.txt', 'stanbul')).toBeNull()
  })
})
