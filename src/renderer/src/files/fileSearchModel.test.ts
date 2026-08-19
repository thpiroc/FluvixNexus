import { describe, expect, it } from 'vitest'
import { FILE_SEARCH_MAX_RESULTS, type FileEntry } from '@shared/files'
import {
  describeFileSearchLimit,
  searchMatchesOf,
  summarizeFileSearch,
  type FileSearchState
} from './fileSearchModel'

/**
 * 検索の状態の見せ方の検証（Session 3-6-4）。
 *
 * 確かめたいのは「**結果が無い理由が画面から決まる**」こと ──
 * 検索中・0 件・取り消し・打ち切り・失敗が、どれも別の文言になること。
 * ここが1つにまとまってしまうと、待てば出るのか探し方が悪いのかが分からなくなる。
 */

function entry(relativePath: string): FileEntry {
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)

  return { id: `f:${relativePath}`, name, relativePath, type: 'file', extension: null }
}

const MATCHES = [entry('src/a.ts'), entry('src/b.ts')]

describe('summarizeFileSearch', () => {
  it('何も探していなければ案内を出さない', () => {
    expect(summarizeFileSearch({ status: 'idle' })).toBeNull()
  })

  it('検索中と 0 件を区別する', () => {
    const searching = summarizeFileSearch({ status: 'searching', query: 'a' })
    const empty = summarizeFileSearch({
      status: 'done',
      query: 'a',
      matches: [],
      truncated: false,
      limit: null
    })

    expect(searching).toBe('検索中…')
    expect(empty).toBe('一致するファイルはありません')
    expect(searching).not.toBe(empty)
  })

  it('見つかった件数を出す', () => {
    expect(
      summarizeFileSearch({
        status: 'done',
        query: 'a',
        matches: MATCHES,
        truncated: false,
        limit: null
      })
    ).toBe('2 件')
  })

  /* 打ち切りは件数と一緒に伝える（何件出ているかと、それが全部でないこと）。 */
  it('打ち切ったときは理由も添える', () => {
    const summary = summarizeFileSearch({
      status: 'done',
      query: 'a',
      matches: MATCHES,
      truncated: true,
      limit: 'results'
    })

    expect(summary).toContain('2 件')
    expect(summary).toContain(String(FILE_SEARCH_MAX_RESULTS))
  })

  it('取り消しは、途中までの件数とともに伝える', () => {
    expect(summarizeFileSearch({ status: 'cancelled', query: 'a', matches: MATCHES })).toBe(
      '検索を中止しました（2 件まで）'
    )
    expect(summarizeFileSearch({ status: 'cancelled', query: 'a', matches: [] })).toBe(
      '検索を中止しました'
    )
  })

  it('失敗はその理由をそのまま出す', () => {
    expect(
      summarizeFileSearch({ status: 'error', query: 'a', message: '検索できませんでした' })
    ).toBe('検索できませんでした')
  })

  /* 5つの状態がすべて違う文言になること（区別が付かない組を作らない）。 */
  it('状態ごとに違う案内になる', () => {
    const states: FileSearchState[] = [
      { status: 'searching', query: 'a' },
      { status: 'done', query: 'a', matches: [], truncated: false, limit: null },
      { status: 'done', query: 'a', matches: MATCHES, truncated: true, limit: 'scanned' },
      { status: 'cancelled', query: 'a', matches: [] },
      { status: 'error', query: 'a', message: '検索できませんでした' }
    ]

    const summaries = states.map(summarizeFileSearch)

    expect(new Set(summaries).size).toBe(states.length)
  })
})

describe('describeFileSearchLimit', () => {
  it('理由ごとに違う文言になる', () => {
    const messages = (['results', 'scanned', 'time', 'depth'] as const).map(describeFileSearchLimit)

    expect(new Set(messages).size).toBe(4)
    expect(messages.every((message) => message.length > 0)).toBe(true)
  })
})

describe('searchMatchesOf', () => {
  it('結果を持つ状態からだけ取り出す', () => {
    expect(searchMatchesOf({ status: 'idle' })).toEqual([])
    expect(searchMatchesOf({ status: 'searching', query: 'a' })).toEqual([])
    expect(searchMatchesOf({ status: 'error', query: 'a', message: 'x' })).toEqual([])
    expect(searchMatchesOf({ status: 'cancelled', query: 'a', matches: MATCHES })).toEqual(MATCHES)
  })
})
