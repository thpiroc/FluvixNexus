import type { GitChangeKind, GitFileChange } from '@shared/git'
import { describe, expect, it } from 'vitest'
import {
  canDiffGitChange,
  describeGitCommitDiffSides,
  describeGitDiffSides,
  describeGitDiffTitle,
  describeGitDiffUnavailable,
  toGitDiffGroup,
  toGitDiffSubject
} from './gitDiff'

/**
 * 差分の面に出す言葉と、開ける行の判断（Session 3-8-9）。
 *
 * ここで固定するのは**画面が何を言うか**だけで、中身の取り方は Main の側の
 * 話になる（main/git/gitDiffRepository.test.ts）。とくに固定しておきたいのは、
 * 「変更前」が Git では3通りある（HEAD / index / 何も無い）ことが
 * **言葉として出ている**ことになる。
 */

function change(overrides: Partial<GitFileChange> & { kind: GitChangeKind }): GitFileChange {
  return {
    relativePath: 'src/app.ts',
    originalPath: null,
    directory: false,
    ...overrides
  }
}

describe('canDiffGitChange', () => {
  it('競合の行では差分を出さない', () => {
    expect(canDiffGitChange('conflicted', change({ kind: 'conflicted' }))).toBe(false)
  })

  it('未追跡のフォルダ1件では差分を出さない', () => {
    expect(canDiffGitChange('untracked', change({ kind: 'untracked', directory: true }))).toBe(
      false
    )
  })

  it('**削除された行でも差分を出す**（Editor では開けないが、中身は見せられる）', () => {
    expect(canDiffGitChange('unstaged', change({ kind: 'deleted' }))).toBe(true)
    expect(canDiffGitChange('staged', change({ kind: 'deleted' }))).toBe(true)
  })

  it('通常の行では出す', () => {
    expect(canDiffGitChange('staged', change({ kind: 'modified' }))).toBe(true)
    expect(canDiffGitChange('unstaged', change({ kind: 'modified' }))).toBe(true)
    expect(canDiffGitChange('untracked', change({ kind: 'untracked' }))).toBe(true)
  })
})

describe('toGitDiffGroup', () => {
  it('競合は渡せない', () => {
    expect(toGitDiffGroup('conflicted')).toBeNull()
  })

  it('他の3つはそのまま渡る', () => {
    expect(toGitDiffGroup('staged')).toBe('staged')
    expect(toGitDiffGroup('unstaged')).toBe('unstaged')
    expect(toGitDiffGroup('untracked')).toBe('untracked')
  })
})

describe('describeGitDiffSides', () => {
  it('ステージ済みは HEAD と index を比べている、と言う', () => {
    expect(describeGitDiffSides('staged', 'modified')).toEqual({
      original: 'HEAD（最後の Commit）',
      modified: 'ステージ済み（index）'
    })
  })

  it('変更は index と作業ツリーを比べている、と言う', () => {
    expect(describeGitDiffSides('unstaged', 'modified')).toEqual({
      original: 'ステージ済み（index）',
      modified: '作業ツリー'
    })
  })

  it('未追跡では、左に「まだ Git にありません」と出す', () => {
    expect(describeGitDiffSides('untracked', 'untracked').original).toBe('まだ Git にありません')
  })

  it('追加では、左が空である理由を言う（空のファイルと見分けが付くように）', () => {
    expect(describeGitDiffSides('staged', 'added').original).toBe('まだ Git にありません')
  })

  it('削除では、右が空である理由を言う', () => {
    expect(describeGitDiffSides('staged', 'deleted').modified).toBe('削除されています')
    expect(describeGitDiffSides('unstaged', 'deleted').modified).toBe('削除されています')
  })

  it('削除でも、左は元の中身の出どころを言う', () => {
    expect(describeGitDiffSides('staged', 'deleted').original).toBe('HEAD（最後の Commit）')
    expect(describeGitDiffSides('unstaged', 'deleted').original).toBe('ステージ済み（index）')
  })
})

describe('describeGitDiffTitle', () => {
  it('名前と場所を分ける（一覧の行と同じ）', () => {
    expect(describeGitDiffTitle(change({ kind: 'modified' }))).toEqual({
      name: 'app.ts',
      location: 'src'
    })
  })

  it('root 直下では場所を出さない', () => {
    expect(
      describeGitDiffTitle(change({ kind: 'modified', relativePath: 'README.md' })).location
    ).toBeNull()
  })

  it('rename では、どこから来たかを出す', () => {
    expect(
      describeGitDiffTitle(
        change({ kind: 'renamed', relativePath: 'src/b.ts', originalPath: 'src/a.ts' })
      )
    ).toEqual({ name: 'b.ts', location: 'src/a.ts から' })
  })
})

describe('describeGitDiffUnavailable', () => {
  it('理由ごとに、次の一手が違う文になる', () => {
    const binary = describeGitDiffUnavailable('binary')
    const tooLarge = describeGitDiffUnavailable('too-large')
    const notFound = describeGitDiffUnavailable('not-found')

    expect(binary).not.toBe(tooLarge)
    expect(tooLarge).not.toBe(notFound)
    // 上限は文の中に出す（「大きすぎます」だけでは、どこまでなら見られるか分からない）。
    expect(tooLarge).toContain('2 MB')
  })

  it('すべての理由に文がある（生の英文が出ない）', () => {
    const reasons = [
      'not-ready',
      'not-found',
      'unsupported-target',
      'binary',
      'too-large',
      'unreadable',
      'failed'
    ] as const

    for (const reason of reasons) {
      const text = describeGitDiffUnavailable(reason)

      expect(text.length, reason).toBeGreaterThan(0)
      expect(text, reason).toMatch(/[。）]$/)
    }
  })
})

/**
 * commit の中の差分（Session 3-8-12）。
 *
 * 固定したいのは2つ。**入口が2つになっても見出しの出し方は1つ**であること
 * （`describeGitDiffSubject` を通す）と、左右のラベルが
 * 「HEAD / index / 作業ツリー」ではなく**commit の言葉**になっていることになる。
 */
describe('toGitDiffSubject', () => {
  it('作業ツリーの1行では、その行そのものを返す', () => {
    const row = change({ kind: 'modified' })

    expect(toGitDiffSubject({ source: 'worktree', group: 'unstaged', change: row })).toBe(row)
  })

  it('commit の中の1ファイルでも、同じ3つが揃う', () => {
    const file = {
      relativePath: 'src/new.ts',
      kind: 'renamed',
      originalPath: 'src/old.ts'
    } as const

    const subject = toGitDiffSubject({
      source: 'commit',
      commit: {
        shortHash: 'abc1234',
        subject: '直した',
        authorName: '名前',
        authoredAt: 0,
        parentCount: 1
      },
      file
    })

    expect(subject).toEqual(file)
    // 見出しの出し方は入口によらず1つ（作業ツリーの1行と同じ関数を通る）。
    expect(describeGitDiffTitle(subject)).toEqual({ name: 'new.ts', location: 'src/old.ts から' })
  })
})

describe('describeGitCommitDiffSides', () => {
  it('比べる相手を commit の言葉で出す（index も作業ツリーも出さない）', () => {
    expect(describeGitCommitDiffSides('modified')).toEqual({
      original: '親のコミット',
      modified: 'このコミット'
    })
  })

  it('追加では、左が「無い」ことをそのまま書く', () => {
    expect(describeGitCommitDiffSides('added').original).toBe('まだありません')
  })

  it('削除では、右が「無い」ことをそのまま書く', () => {
    expect(describeGitCommitDiffSides('deleted').modified).toBe('削除されています')
  })
})
