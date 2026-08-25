import type { GitCommitSummary } from '@shared/git'
import { describe, expect, it } from 'vitest'
import {
  describeGitCommitAbsoluteTime,
  describeGitCommitHistory,
  describeGitCommitRelativeTime,
  describeGitCommitRow,
  describeGitCommitTruncation,
  type GitCommitHistoryState
} from './gitHistory'

/**
 * 履歴の面の中身（gitHistory.ts）。
 *
 * gitBranches.test.ts が「開いた面に何と出すか」を固定するのと同じ形で、
 * こちらは次の3つを固定する。
 *
 *   - **commit が1つも無いことを、失敗として言わない**（次の一手が違う）
 *   - **切れていることを黙って済ませない**（「消えた」と読まれる）
 *   - 日時の言い方（本文は相対・hover は絶対）が、**どの PC でも同じ形**になる
 */

/** commit 1件を組み立てる（既定は「普通の1件」）。 */
function commitOf(overrides: Partial<GitCommitSummary> = {}): GitCommitSummary {
  return {
    shortHash: 'abc1234',
    subject: 'Git パネルに履歴を足す',
    authorName: 'Piroshi',
    authoredAt: Date.UTC(2026, 7, 25, 11, 4),
    parentCount: 1,
    ...overrides
  }
}

/** 履歴の姿を組み立てる（既定は「取れている」）。 */
function historyOf(overrides: Partial<GitCommitHistoryState> = {}): GitCommitHistoryState {
  return {
    status: 'ready',
    commits: [commitOf()],
    truncated: false,
    ...overrides
  }
}

describe('describeGitCommitHistory', () => {
  it('行が出せるなら一言は出さない', () => {
    // 「読めているもの」と「読めない理由」を同時に並べない。
    expect(describeGitCommitHistory(historyOf())).toBeNull()
  })

  it('取得中はそう言う（「commit がありません」と言わない）', () => {
    const notice = describeGitCommitHistory(historyOf({ status: 'loading', commits: [] }))

    expect(notice).toBe('履歴を取得しています…')
  })

  it('commit が1つも無いことを、失敗として言わない', () => {
    /*
      `git init` の直後。次の一手は「最初の Commit を作る」で、
      それはこの面ではなく下の Commit 欄にある。
    */
    const notice = describeGitCommitHistory(historyOf({ commits: [] }))

    expect(notice).toContain('まだ commit がありません')
    expect(notice).toContain('最初の Commit')
  })

  it('読めなかったときと、もう出せない状態を分ける', () => {
    expect(describeGitCommitHistory(historyOf({ status: 'failed', commits: [] }))).toBe(
      '履歴を取得できませんでした。'
    )
    expect(describeGitCommitHistory(historyOf({ status: 'not-ready', commits: [] }))).toContain(
      'Git 操作を行えなくなりました'
    )
  })
})

describe('describeGitCommitTruncation', () => {
  it('切れていなければ言わない', () => {
    expect(describeGitCommitTruncation(historyOf())).toBeNull()
  })

  it('切れていたら件数つきで言う（黙って捨てない）', () => {
    const notice = describeGitCommitTruncation(
      historyOf({ commits: [commitOf(), commitOf({ shortHash: 'def5678' })], truncated: true })
    )

    expect(notice).toBe('新しい方から 2 件だけを表示しています。')
  })

  it('取れていない姿では言わない（理由の方を出すため）', () => {
    expect(
      describeGitCommitTruncation(historyOf({ status: 'failed', commits: [], truncated: true }))
    ).toBeNull()
  })
})

describe('describeGitCommitRow', () => {
  const now = Date.UTC(2026, 7, 25, 12, 4)

  it('要約・名乗り・短い hash をそのまま渡す', () => {
    const row = describeGitCommitRow(commitOf(), now)

    expect(row.subject).toBe('Git パネルに履歴を足す')
    expect(row.emptySubject).toBe(false)
    expect(row.authorName).toBe('Piroshi')
    expect(row.shortHash).toBe('abc1234')
  })

  it('要約が空なら、空欄ではなく言葉を出す', () => {
    // 行の高さだけがある行は、読み込みに失敗した行と見分けが付かない。
    const row = describeGitCommitRow(commitOf({ subject: '   ' }), now)

    expect(row.subject).toBe('（メッセージなし）')
    expect(row.emptySubject).toBe(true)
  })

  it('名乗りが空でも、空欄にしない', () => {
    expect(describeGitCommitRow(commitOf({ authorName: '' }), now).authorName).toBe('（名前なし）')
  })

  it('親が2つ以上ならマージとして出す', () => {
    // 「マージ」と呼ぶかどうかを決めるのは画面の側（shared は親の数だけを持つ）。
    expect(describeGitCommitRow(commitOf({ parentCount: 2 }), now).merge).toBe(true)
    expect(describeGitCommitRow(commitOf({ parentCount: 1 }), now).merge).toBe(false)
    expect(describeGitCommitRow(commitOf({ parentCount: 0 }), now).merge).toBe(false)
  })

  it('本文は相対、hover は絶対', () => {
    const row = describeGitCommitRow(commitOf(), now)

    expect(row.relativeTime).toBe('1 時間前')
    expect(row.absoluteTime).toBe(describeGitCommitAbsoluteTime(commitOf().authoredAt))
  })
})

describe('describeGitCommitRelativeTime', () => {
  const now = Date.UTC(2026, 7, 25, 12, 0)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  it('1分未満は「たった今」', () => {
    expect(describeGitCommitRelativeTime(now - 59_000, now)).toBe('たった今')
    expect(describeGitCommitRelativeTime(now, now)).toBe('たった今')
  })

  it('分・時間・日で粗くしていく', () => {
    expect(describeGitCommitRelativeTime(now - 5 * minute, now)).toBe('5 分前')
    expect(describeGitCommitRelativeTime(now - 3 * hour, now)).toBe('3 時間前')
    expect(describeGitCommitRelativeTime(now - 2 * day, now)).toBe('2 日前')
  })

  it('境目でひとつ上へ上がる', () => {
    expect(describeGitCommitRelativeTime(now - minute, now)).toBe('1 分前')
    expect(describeGitCommitRelativeTime(now - hour, now)).toBe('1 時間前')
    expect(describeGitCommitRelativeTime(now - day, now)).toBe('1 日前')
  })

  it('1か月・1年より前は、月と年で言う', () => {
    // 「14 か月前」は読みにくく、そこまでさかのぼると正確さも要らない。
    expect(describeGitCommitRelativeTime(now - 29 * day, now)).toBe('29 日前')
    expect(describeGitCommitRelativeTime(now - 30 * day, now)).toBe('1 か月前')
    expect(describeGitCommitRelativeTime(now - 364 * day, now)).toBe('12 か月前')
    expect(describeGitCommitRelativeTime(now - 365 * day, now)).toBe('1 年前')
  })

  it('未来の日時を「前」と言わない', () => {
    /*
      commit の日時は書いた人の PC の時計で記録される ── ずれた時計から
      来た commit は、こちらの「今」より後になりうる。
    */
    expect(describeGitCommitRelativeTime(now + hour, now)).toBe('これから')
  })
})

describe('describeGitCommitAbsoluteTime', () => {
  it('桁の揃った1つの形にする（locale で変わらない）', () => {
    /*
      `toLocaleString()` に任せると、同じ画面が PC ごとに `8/25/2026` にも
      `25/08/2026` にもなる。日時は**見ている人の時計**で組み立てるため、
      期待値も現地時刻から作る（どの timezone で走らせても通る）。
    */
    const at = new Date(2026, 7, 5, 9, 4)

    expect(describeGitCommitAbsoluteTime(at.getTime())).toBe('2026/08/05 09:04')
  })

  it('月・日・時・分を2桁に揃える', () => {
    const at = new Date(2026, 10, 30, 23, 59)

    expect(describeGitCommitAbsoluteTime(at.getTime())).toBe('2026/11/30 23:59')
  })
})
