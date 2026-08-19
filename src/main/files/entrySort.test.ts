import { describe, expect, it } from 'vitest'
import type { FileEntry, FileEntryType } from '@shared/files'
import { sortFileEntries } from './entrySort'

/**
 * 並び順の仕様を固定する。
 *
 * 「フォルダが先、それぞれ名前順」は Session 3-2 の初期仕様（DESIGN.md §3）。
 * 順序の種類を増やすときも、既定の並びがここで守られていることを前提にできる。
 */

function entry(name: string, type: FileEntryType): FileEntry {
  return {
    id: `${type === 'directory' ? 'd' : 'f'}:${name}`,
    name,
    relativePath: name,
    type,
    extension: null
  }
}

function namesOf(entries: readonly FileEntry[]): string[] {
  return entries.map((item) => item.name)
}

describe('sortFileEntries', () => {
  it('フォルダをファイルより先に並べる', () => {
    const sorted = sortFileEntries([
      entry('README.md', 'file'),
      entry('src', 'directory'),
      entry('package.json', 'file'),
      entry('docs', 'directory')
    ])

    // ファイル同士は大文字小文字を区別しない名前順のため、package.json が README.md より前。
    expect(namesOf(sorted)).toEqual(['docs', 'src', 'package.json', 'README.md'])
  })

  it('大文字小文字を区別せずに名前順で並べる', () => {
    const sorted = sortFileEntries([
      entry('b.ts', 'file'),
      entry('A.ts', 'file'),
      entry('a.ts', 'file'),
      entry('B.ts', 'file')
    ])

    // 表記だけが違う組の中での順序は、素の文字列比較（大文字が先）で固定する。
    expect(namesOf(sorted)).toEqual(['A.ts', 'a.ts', 'B.ts', 'b.ts'])
  })

  it('数字は数として並べる', () => {
    const sorted = sortFileEntries([
      entry('item10.ts', 'file'),
      entry('item2.ts', 'file'),
      entry('item1.ts', 'file')
    ])

    expect(namesOf(sorted)).toEqual(['item1.ts', 'item2.ts', 'item10.ts'])
  })

  it('同じ名前が大小違いで共存しても並びが安定する', () => {
    const first = sortFileEntries([entry('readme.md', 'file'), entry('README.md', 'file')])
    const second = sortFileEntries([entry('README.md', 'file'), entry('readme.md', 'file')])

    expect(namesOf(first)).toEqual(namesOf(second))
  })

  it('入力を書き換えない', () => {
    const entries = [entry('b.ts', 'file'), entry('a.ts', 'file')]
    const sorted = sortFileEntries(entries)

    expect(namesOf(entries)).toEqual(['b.ts', 'a.ts'])
    expect(namesOf(sorted)).toEqual(['a.ts', 'b.ts'])
  })
})
