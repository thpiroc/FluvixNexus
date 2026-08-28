import type { GitFileChange, GitStashEntry, GitWorkingTreeChanges } from '@shared/git'
import { describe, expect, it } from 'vitest'
import {
  describeGitStashDropWarning,
  describeGitStashList,
  describeGitStashRow,
  describeGitStashTruncation,
  toGitStashDropReadiness,
  toGitStashPopReadiness,
  toGitStashPushReadiness,
  type GitStashListState
} from './gitStash'

/**
 * 退避の面の中身（gitStash.ts・Session 3-8-15）。
 *
 * gitBranches.test.ts が「ブランチを選ぶ面」を、gitHistory.test.ts が
 * 「履歴の面」を見るのと同じ立ち位置で、ここが見るのは4つになる。
 *
 *   - 開いた面に何と出すか（取得中に「ありません」と出さない・切れていることを隠さない）
 *   - **未追跡だけの状態で「退避する」を押せないこと**（押しても何も起きない）
 *   - 番号を画面に出さないこと（並び順は退避を1つ増やせば全部ずれる）
 *   - 捨てる前に、何が失われるかを**盛らずに**言うこと
 */

/** 一覧の状態を1つ組む。 */
function listing(overrides: Partial<GitStashListState> = {}): GitStashListState {
  return { status: 'ready', entries: [], truncated: false, ...overrides }
}

/** 退避1件を組む。 */
function entry(overrides: Partial<GitStashEntry> = {}): GitStashEntry {
  return {
    index: 0,
    shortHash: 'abc1234',
    subject: 'WIP on main: 1a2b3c4 first',
    stashedAt: Date.parse('2026-08-25T20:04:00'),
    ...overrides
  }
}

/** 変更ファイル1件を組む（種類は数えるだけなので何でもよい）。 */
function change(relativePath: string): GitFileChange {
  return { relativePath, kind: 'modified', originalPath: null, directory: false }
}

/** 作業ツリーの状態を組む。 */
function changes(overrides: Partial<GitWorkingTreeChanges> = {}): GitWorkingTreeChanges {
  return { staged: [], unstaged: [], untracked: [], conflicted: [], ...overrides }
}

describe('describeGitStashList', () => {
  it('取得中に「ありません」と出さない', () => {
    // 面は開くたびに必ずこの状態を通る（ブランチ・履歴と同じ判断）。
    expect(describeGitStashList(listing({ status: 'loading' }))).toBe('退避を取得しています…')
  })

  it('1件も無いときは、次の一手を同じ面の中に示す', () => {
    const notice = describeGitStashList(listing())

    expect(notice).not.toBeNull()
    // 行き先はこの面の下にある（他の面のように「下の Commit 欄で」とは言わない）。
    expect(notice).toContain('作業ツリーを退避')
  })

  it('読めなかったことと、操作できなくなったことを別の文で出す', () => {
    const failed = describeGitStashList(listing({ status: 'failed' }))
    const notReady = describeGitStashList(listing({ status: 'not-ready' }))

    expect(failed).not.toBe(notReady)
    expect(failed).not.toBeNull()
    expect(notReady).not.toBeNull()
  })

  it('行が出せるなら一言は出さない', () => {
    // 「選べるもの」と「選べない理由」を面の中に並べない。
    expect(describeGitStashList(listing({ entries: [entry()] }))).toBeNull()
  })
})

describe('describeGitStashTruncation', () => {
  it('切れていることを黙って隠さない', () => {
    const notice = describeGitStashTruncation(
      listing({ entries: [entry(), entry({ index: 1 })], truncated: true })
    )

    expect(notice).not.toBeNull()
    expect(notice).toContain('2')
  })

  it('切れていなければ出さない', () => {
    expect(describeGitStashTruncation(listing({ entries: [entry()] }))).toBeNull()
    // 取得中・失敗のときも出さない（そもそも件数が意味を持たない）。
    expect(describeGitStashTruncation(listing({ status: 'loading', truncated: true }))).toBeNull()
  })
})

describe('describeGitStashRow', () => {
  const now = Date.parse('2026-08-25T20:07:00')

  it('名乗りと、相対 / 絶対の日時を出す', () => {
    const row = describeGitStashRow(entry(), now)

    expect(row.subject).toBe('WIP on main: 1a2b3c4 first')
    expect(row.emptySubject).toBe(false)
    expect(row.relativeTime).toBe('3 分前')
    expect(row.absoluteTime).toBe('2026/08/25 20:04')
  })

  it('名乗りが空の行を空欄のまま出さない', () => {
    // 行の高さだけがあって何も無い行は、読み込みに失敗した行と見分けが付かない。
    const row = describeGitStashRow(entry({ subject: '   ' }), now)

    expect(row.subject).toBe('（名前なし）')
    expect(row.emptySubject).toBe(true)
  })

  /**
   * 番号は画面に出さない。
   *
   * `stash@{0}` の 0 は上から数えた位置で、退避を1つ増やせば全部がずれる ──
   * 一覧に出すと、読む人はそれを「その退避の名前」として受け取る。
   */
  it('行に出すものの中に番号が無い', () => {
    const row = describeGitStashRow(entry({ index: 7 }), now)

    expect(Object.values(row).join(' ')).not.toContain('7')
  })
})

describe('toGitStashPushReadiness', () => {
  it('変更があれば押せて、何件避けるかを言う', () => {
    const readiness = toGitStashPushReadiness(
      changes({ staged: [change('a.txt')], unstaged: [change('b.txt')] }),
      false
    )

    expect(readiness.enabled).toBe(true)
    expect(readiness.note).toContain('2')
  })

  /**
   * ここがこの関数の要点になる。
   *
   * `-u` を渡していないので、未追跡は退避されない ── 押せるようにすると、
   * 押しても一覧に何も増えず作業ツリーも変わらない（`No local changes to save`）。
   */
  it('未追跡しか無いときは押せない（理由もそう言う）', () => {
    const readiness = toGitStashPushReadiness(changes({ untracked: [change('new.txt')] }), false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toContain('未追跡')
  })

  it('何も変わっていなければ押せない', () => {
    const readiness = toGitStashPushReadiness(changes(), false)

    expect(readiness.enabled).toBe(false)
    // 未追跡が無いときに「未追跡は含まれません」と言うと、居ないものの話になる。
    expect(readiness.note).not.toContain('未追跡')
  })

  it('競合が残っている間は押せない（理由が他と違う）', () => {
    const readiness = toGitStashPushReadiness(
      changes({ staged: [change('a.txt')], conflicted: [change('c.txt')] }),
      false
    )

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toContain('競合')
  })

  it('他の Git 操作が動いている間は押せない', () => {
    const readiness = toGitStashPushReadiness(changes({ unstaged: [change('a.txt')] }), true)

    expect(readiness.enabled).toBe(false)
    // 押せる場面と同じ文（「何が起きるか」）を出す ── 間違いではない。
    expect(readiness.note).toContain('退避')
  })
})

describe('toGitStashPopReadiness / toGitStashDropReadiness', () => {
  it('他の Git 操作が動いている間だけ押せない', () => {
    expect(toGitStashPopReadiness(false).enabled).toBe(true)
    expect(toGitStashPopReadiness(true).enabled).toBe(false)
    expect(toGitStashDropReadiness(false).enabled).toBe(true)
    expect(toGitStashDropReadiness(true).enabled).toBe(false)
  })

  /**
   * 戻せるかどうかを、押す前にアプリが判断しない。
   *
   * 触るファイルが重ならなければ git は通す ── その判断を持っているのは git で、
   * 通らなければ `local-changes-blocked` として返る（切り替えと同じ）。
   */
  it('作業ツリーの状態を受け取らない（判断を git から奪わない）', () => {
    expect(toGitStashPopReadiness.length).toBe(1)
  })

  it('2つの文言が別のことを言っている', () => {
    expect(toGitStashPopReadiness(false).note).not.toBe(toGitStashDropReadiness(false).note)
  })
})

describe('describeGitStashDropWarning', () => {
  const now = Date.parse('2026-08-25T20:07:00')

  it('どれを捨てるのかを名乗りで出す', () => {
    const warning = describeGitStashDropWarning(entry(), now)

    expect(warning.message).toContain('WIP on main: 1a2b3c4 first')
    expect(warning.confirmLabel).toBe('捨てる')
  })

  /**
   * 盛らない。
   *
   * 捨てた退避は `git fsck --unreachable` で拾える間は残っており、
   * 「完全に失われる」は正確ではない ── アプリの中では戻せない、と
   * 書けるところまでを書く。
   */
  it('「完全に失われる」とは書かず、アプリの中で戻せないことを書く', () => {
    const warning = describeGitStashDropWarning(entry(), now)

    expect(warning.note).not.toContain('完全')
    expect(warning.note).toContain('アプリからは取り消せません')
  })

  it('名乗りが空でも、確認の文が空欄にならない', () => {
    const warning = describeGitStashDropWarning(entry({ subject: '' }), now)

    expect(warning.message).toContain('（名前なし）')
  })
})
