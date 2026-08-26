import type { GitCommitFileChange, GitCommitSummary } from '@shared/git'
import { describe, expect, it } from 'vitest'
import {
  canOpenGitCommitDetail,
  describeGitCommitDetail,
  describeGitCommitDetailTruncation,
  describeGitCommitDetailUnavailable,
  describeGitCommitFileRow,
  describeGitMergeCommitNotice,
  GIT_MERGE_COMMIT_NOTICE,
  type GitCommitDetailState
} from './gitCommitDetail'

/**
 * commit 1件の詳細を、画面に出す形へ直す判断（Session 3-8-12）。
 *
 * 固定したいのは4つになる。
 *
 *   - 行と一言を同時に出さない（読み込み中・出せない理由・1件も無い）
 *   - **マージを出せない理由が、押せない行の側と面の側で同じ1文**であること
 *   - 切れていることを黙らない
 *   - 押せる行と押せない行の分かれ目が `parentCount` の1つだけであること
 */

function commit(parentCount: number): GitCommitSummary {
  return {
    shortHash: 'abc1234',
    subject: '直した',
    authorName: '名前',
    authoredAt: 1_756_100_000_000,
    parentCount
  }
}

function state(detail: GitCommitDetailState['detail']): GitCommitDetailState {
  return { commit: commit(1), detail }
}

function file(overrides: Partial<GitCommitFileChange> = {}): GitCommitFileChange {
  return { relativePath: 'src/index.ts', kind: 'modified', originalPath: null, ...overrides }
}

describe('describeGitCommitDetail', () => {
  it('届く前は「取得しています」だけを出す', () => {
    expect(describeGitCommitDetail(state(null))).toBe('変更ファイルを取得しています…')
  })

  it('出せない理由は、そのまま一言として出す', () => {
    expect(describeGitCommitDetail(state({ status: 'unavailable', reason: 'merge' }))).toBe(
      GIT_MERGE_COMMIT_NOTICE
    )
  })

  it('変わったファイルが1件も無いことを、失敗として出さない', () => {
    expect(
      describeGitCommitDetail(
        state({ status: 'ready', commit: commit(1), files: [], truncated: false })
      )
    ).toBe('このコミットで変わったファイルはありません。')
  })

  it('行が出せるときは一言を出さない', () => {
    expect(
      describeGitCommitDetail(
        state({ status: 'ready', commit: commit(1), files: [file()], truncated: false })
      )
    ).toBeNull()
  })
})

describe('describeGitCommitDetailUnavailable', () => {
  it('理由ごとに違う文を出す（「表示できません」で丸めない）', () => {
    const messages = (['not-ready', 'not-found', 'merge', 'failed'] as const).map(
      describeGitCommitDetailUnavailable
    )

    expect(new Set(messages).size).toBe(messages.length)
  })

  it('マージの理由は、一覧の下に出すものと同じ1文になる', () => {
    expect(describeGitCommitDetailUnavailable('merge')).toBe(GIT_MERGE_COMMIT_NOTICE)
  })

  it('マージを「対応していない」ではなく「決まらない」と言う', () => {
    expect(GIT_MERGE_COMMIT_NOTICE).toContain('決まらない')
  })
})

describe('describeGitCommitDetailTruncation', () => {
  it('切れていなければ黙る', () => {
    expect(
      describeGitCommitDetailTruncation(
        state({ status: 'ready', commit: commit(1), files: [file()], truncated: false })
      )
    ).toBeNull()
  })

  it('切れていることを黙らない', () => {
    const notice = describeGitCommitDetailTruncation(
      state({ status: 'ready', commit: commit(1), files: [file()], truncated: true })
    )

    expect(notice).toContain('1 件')
  })

  it('届く前・出せないときは出さない', () => {
    expect(describeGitCommitDetailTruncation(state(null))).toBeNull()
    expect(
      describeGitCommitDetailTruncation(state({ status: 'unavailable', reason: 'failed' }))
    ).toBeNull()
  })
})

describe('describeGitCommitFileRow', () => {
  it('名前と場所を分ける（一覧の行と同じ切り方）', () => {
    expect(describeGitCommitFileRow(file({ relativePath: 'src/git/index.ts' }))).toEqual({
      name: 'index.ts',
      location: 'src/git'
    })
  })

  it('root 直下では場所を出さない', () => {
    expect(describeGitCommitFileRow(file({ relativePath: 'README.md' }))).toEqual({
      name: 'README.md',
      location: null
    })
  })

  it('rename では、場所の代わりに元の位置を出す', () => {
    expect(
      describeGitCommitFileRow(
        file({ relativePath: 'src/new.ts', kind: 'renamed', originalPath: 'src/old.ts' })
      )
    ).toEqual({ name: 'new.ts', location: 'src/old.ts から' })
  })
})

describe('canOpenGitCommitDetail', () => {
  it('親が1つ以下なら開ける', () => {
    expect(canOpenGitCommitDetail(commit(0))).toBe(true)
    expect(canOpenGitCommitDetail(commit(1))).toBe(true)
  })

  it('親が2つ以上（マージ）は開けない', () => {
    expect(canOpenGitCommitDetail(commit(2))).toBe(false)
    expect(canOpenGitCommitDetail(commit(3))).toBe(false)
  })
})

describe('describeGitMergeCommitNotice', () => {
  it('マージが1つも無ければ、押せない行の説明を出さない', () => {
    expect(describeGitMergeCommitNotice([commit(1), commit(0)])).toBeNull()
  })

  it('マージが混ざっているときだけ、一覧につき1つ出す', () => {
    expect(describeGitMergeCommitNotice([commit(1), commit(2), commit(2)])).toBe(
      GIT_MERGE_COMMIT_NOTICE
    )
  })

  it('一覧が空なら出さない', () => {
    expect(describeGitMergeCommitNotice([])).toBeNull()
  })
})
