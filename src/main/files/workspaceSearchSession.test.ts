import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginWorkspaceSearch,
  cancelWorkspaceSearch,
  cancelWorkspaceSearches,
  getActiveWorkspaceSearchId
} from './workspaceSearchSession'

/**
 * 「今走っている検索」の管理の検証（Session 3-6-4）。
 *
 * 確かめたいのは、止まるべきものが止まり、**止まってはいけないものが止まらない**こと。
 * 後者（新しい検索が古い取り消しに巻き込まれない）は、操作が前後したときにだけ
 * 現れるため、実機では気づきにくい。
 */

beforeEach(() => {
  // 前のテストが走らせたままにしていても、次は素の状態から始める。
  cancelWorkspaceSearches()
})

describe('beginWorkspaceSearch', () => {
  it('始めた検索が現役になる', () => {
    const search = beginWorkspaceSearch('workspace-1', 'search-1')

    expect(getActiveWorkspaceSearchId()).toBe('search-1')
    expect(search.cancellation.cancelled).toBe(false)
  })

  /* 同時に走るのは常に1つ（このファイルの冒頭）。 */
  it('新しい検索を始めると、古い検索は止まる', () => {
    const first = beginWorkspaceSearch('workspace-1', 'search-1')
    const second = beginWorkspaceSearch('workspace-1', 'search-2')

    expect(first.cancellation.cancelled).toBe(true)
    expect(second.cancellation.cancelled).toBe(false)
    expect(getActiveWorkspaceSearchId()).toBe('search-2')
  })

  it('連続して始めても、生き残るのは最後の1つだけ', () => {
    const searches = ['a', 'b', 'c', 'd'].map((id) => beginWorkspaceSearch('workspace-1', id))

    expect(searches.slice(0, -1).every((search) => search.cancellation.cancelled)).toBe(true)
    expect(searches.at(-1)?.cancellation.cancelled).toBe(false)
    expect(getActiveWorkspaceSearchId()).toBe('d')
  })
})

describe('finish', () => {
  it('終わった検索は現役でなくなる', () => {
    const search = beginWorkspaceSearch('workspace-1', 'search-1')

    search.finish()

    expect(getActiveWorkspaceSearchId()).toBeNull()
    // 終わっただけで、取り消されたわけではない。
    expect(search.cancellation.cancelled).toBe(false)
  })

  /*
    置き換えられた後に古い方が終わる、という順序は普通に起きる
    （新しい検索が始まってから、古い検索の走査が止まるまでに間がある）。
  */
  it('置き換えられた後に終わっても、新しい検索を片付けない', () => {
    const first = beginWorkspaceSearch('workspace-1', 'search-1')
    const second = beginWorkspaceSearch('workspace-1', 'search-2')

    first.finish()

    expect(getActiveWorkspaceSearchId()).toBe('search-2')
    expect(second.cancellation.cancelled).toBe(false)
  })
})

describe('cancelWorkspaceSearch', () => {
  it('識別子が合えば止まる', () => {
    const search = beginWorkspaceSearch('workspace-1', 'search-1')

    expect(cancelWorkspaceSearch('search-1')).toBe(true)
    expect(search.cancellation.cancelled).toBe(true)
    expect(getActiveWorkspaceSearchId()).toBeNull()
  })

  /* 止める操作と次の入力が前後しても、始まったばかりの検索を消さない。 */
  it('古い識別子で止めても、今の検索は止まらない', () => {
    beginWorkspaceSearch('workspace-1', 'search-1')
    const second = beginWorkspaceSearch('workspace-1', 'search-2')

    expect(cancelWorkspaceSearch('search-1')).toBe(false)
    expect(second.cancellation.cancelled).toBe(false)
    expect(getActiveWorkspaceSearchId()).toBe('search-2')
  })

  it('走っていなければ false（失敗にはしない）', () => {
    expect(cancelWorkspaceSearch('search-1')).toBe(false)
  })
})

describe('cancelWorkspaceSearches', () => {
  /* Workspace の切り替え / Close で呼ばれる経路。 */
  it('走っている検索を捨てる', () => {
    const search = beginWorkspaceSearch('workspace-1', 'search-1')

    expect(cancelWorkspaceSearches()).toBe(true)
    expect(search.cancellation.cancelled).toBe(true)
    expect(getActiveWorkspaceSearchId()).toBeNull()
  })

  it('走っていなければ何も起きない', () => {
    expect(cancelWorkspaceSearches()).toBe(false)
  })
})
