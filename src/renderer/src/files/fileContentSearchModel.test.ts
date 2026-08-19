import { describe, expect, it } from 'vitest'
import type { FileContentMatch, FileContentMatchFile } from '@shared/files'
import {
  contentSearchFilesOf,
  summarizeFileContentSearch,
  toFileContentSearchRows,
  type FileContentSearchState
} from './fileContentSearchModel'

/**
 * 全文検索の状態と、結果の並べ方（Session 3-6-5）。
 *
 * fileSearchModel.test.ts と同じく、React にも DOM にも触れない層の検証。
 * ここで固定したいのは2つ。
 *
 *   状態を言い分けること … 0 件・取り消し・打ち切りが同じ文言にならない
 *   行の組み立て方       … フォルダの見出しが必要なところにだけ1つ出る
 */

function match(line: number, column: number, text = 'const example = 1'): FileContentMatch {
  return { line, column, length: 7, preview: text, previewColumn: column }
}

function file(
  relativePath: string,
  matches: readonly FileContentMatch[],
  truncated = false
): FileContentMatchFile {
  return {
    relativePath,
    name: relativePath.slice(relativePath.lastIndexOf('/') + 1),
    matches,
    truncated
  }
}

describe('行の並び', () => {
  it('フォルダ → ファイル → 一致 の順に並べる', () => {
    const rows = toFileContentSearchRows([file('src/App.tsx', [match(42, 15), match(50, 3)])])

    expect(rows.map((row) => row.kind)).toEqual(['folder', 'file', 'match', 'match'])
    expect(rows[0]).toMatchObject({ kind: 'folder', label: 'src' })
    expect(rows[1]).toMatchObject({ kind: 'file', name: 'App.tsx', matchCount: 2 })
  })

  it('同じフォルダの見出しは1つだけ出す', () => {
    const rows = toFileContentSearchRows([
      file('src/App.tsx', [match(1, 1)]),
      file('src/main.tsx', [match(1, 1)])
    ])

    expect(rows.filter((row) => row.kind === 'folder')).toHaveLength(1)
  })

  it('フォルダが変わればもう一度出す', () => {
    const rows = toFileContentSearchRows([
      file('src/App.tsx', [match(1, 1)]),
      file('docs/README.md', [match(1, 1)])
    ])

    expect(rows.filter((row) => row.kind === 'folder').map((row) => row.id)).toEqual([
      'folder:src',
      'folder:docs'
    ])
  })

  it('Workspace 直下のファイルには見出しを出さない', () => {
    const rows = toFileContentSearchRows([file('README.md', [match(1, 1)])])

    expect(rows.map((row) => row.kind)).toEqual(['file', 'match'])
  })

  it('ファイルの行は最初の一致を持つ（押したときに飛ぶ先）', () => {
    const rows = toFileContentSearchRows([file('a.txt', [match(7, 3), match(9, 1)])])
    const fileRow = rows.find((row) => row.kind === 'file')

    expect(fileRow).toMatchObject({ kind: 'file', first: { line: 7, column: 3 } })
  })

  it('同じ行の別の桁は別の行になる', () => {
    const rows = toFileContentSearchRows([file('a.txt', [match(3, 1), match(3, 9)])])

    expect(rows.filter((row) => row.kind === 'match').map((row) => row.id)).toEqual([
      'match:a.txt:3:1',
      'match:a.txt:3:9'
    ])
  })
})

describe('状態の文言', () => {
  it('検索前は何も言わない', () => {
    expect(summarizeFileContentSearch({ status: 'idle' })).toBeNull()
  })

  it('検索中と 0 件を言い分ける', () => {
    expect(summarizeFileContentSearch({ status: 'searching', query: 'x' })).toBe('検索中…')
    expect(
      summarizeFileContentSearch({
        status: 'done',
        query: 'x',
        files: [],
        matchCount: 0,
        truncated: false,
        limit: null
      })
    ).toBe('一致するテキストはありません')
  })

  it('件数はファイル数と一緒に出す', () => {
    const state: FileContentSearchState = {
      status: 'done',
      query: 'x',
      files: [file('a.txt', [match(1, 1)]), file('b.txt', [match(1, 1)])],
      matchCount: 2,
      truncated: false,
      limit: null
    }

    expect(summarizeFileContentSearch(state)).toBe('2 件（2 ファイル）')
  })

  it('打ち切った理由を件数に添える', () => {
    const summary = summarizeFileContentSearch({
      status: 'done',
      query: 'x',
      files: [file('a.txt', [match(1, 1)])],
      matchCount: 1,
      truncated: true,
      limit: 'time'
    })

    expect(summary).toContain('1 件（1 ファイル）')
    expect(summary).toContain('時間がかかりすぎた')
  })

  it('打ち切りの理由ごとに違う文言を出す', () => {
    const limits = ['matches', 'files', 'scanned', 'time', 'depth', 'file-matches'] as const

    const messages = limits.map((limit) =>
      summarizeFileContentSearch({
        status: 'done',
        query: 'x',
        files: [file('a.txt', [match(1, 1)])],
        matchCount: 1,
        truncated: true,
        limit
      })
    )

    expect(new Set(messages).size).toBe(limits.length)
  })

  it('取り消しは失敗とは別に言い、見つかったぶんを残す', () => {
    const state: FileContentSearchState = {
      status: 'cancelled',
      query: 'x',
      files: [file('a.txt', [match(1, 1)])],
      matchCount: 1
    }

    expect(summarizeFileContentSearch(state)).toContain('中止')
    expect(contentSearchFilesOf(state)).toHaveLength(1)
  })

  it('失敗はその理由をそのまま出す', () => {
    expect(
      summarizeFileContentSearch({ status: 'error', query: 'x', message: '読み取れません' })
    ).toBe('読み取れません')
  })
})
