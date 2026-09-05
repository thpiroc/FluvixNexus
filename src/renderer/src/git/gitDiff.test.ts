import type { GitChangeKind, GitFileChange } from '@shared/git'
import { describe, expect, it } from 'vitest'
import {
  canDiffGitChange,
  describeGitCommitDiffSides,
  describeGitConflictDiffSides,
  describeGitConflictMissingSides,
  describeGitConflictShape,
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
    conflictShape: null,
    ...overrides
  }
}

describe('canDiffGitChange', () => {
  /*
    Session 3-8-21 で裏返った1つ。3-8-9 では競合を弾いていた（「前」と「後」が
    2組あり、2つの中身を並べる形が当てはまらないため）── 3-8-21 で
    「組を1つに決める」という答えが出たので、**通す側**になる。
    行き先のチャンネルは違うが、それを決めるのは押した側（GitView.tsx）。
  */
  it('**競合の行でも差分を出す**（Session 3-8-21 で通るようになった）', () => {
    expect(canDiffGitChange(change({ kind: 'conflicted' }))).toBe(true)
  })

  it('未追跡のフォルダ1件では差分を出さない', () => {
    expect(canDiffGitChange(change({ kind: 'untracked', directory: true }))).toBe(false)
  })

  it('**削除された行でも差分を出す**（Editor では開けないが、中身は見せられる）', () => {
    expect(canDiffGitChange(change({ kind: 'deleted' }))).toBe(true)
  })

  it('通常の行では出す', () => {
    expect(canDiffGitChange(change({ kind: 'modified' }))).toBe(true)
    expect(canDiffGitChange(change({ kind: 'untracked' }))).toBe(true)
  })
})

describe('toGitDiffGroup', () => {
  /*
    3-8-21 で競合にも差分の口が付いたが、**ここは 3-8-9 のまま**になる ──
    競合が行くのは別のチャンネル（`git:get-conflict-diff`）で、
    `GitDiffGroup` に競合は混ざらない。
  */
  it('競合は渡せない（別のチャンネルへ行く）', () => {
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
      modified: 'Stage 済み（index）'
    })
  })

  it('変更は index と作業ツリーを比べている、と言う', () => {
    expect(describeGitDiffSides('unstaged', 'modified')).toEqual({
      original: 'Stage 済み（index）',
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
    expect(describeGitDiffSides('unstaged', 'deleted').original).toBe('Stage 済み（index）')
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
      original: '親の Commit',
      modified: 'この Commit'
    })
  })

  it('追加では、左が「無い」ことをそのまま書く', () => {
    expect(describeGitCommitDiffSides('added').original).toBe('まだありません')
  })

  it('削除では、右が「無い」ことをそのまま書く', () => {
    expect(describeGitCommitDiffSides('deleted').modified).toBe('削除されています')
  })
})

/**
 * 競合の左右と、競合の形（Session 3-8-21）。
 *
 * ここで固定したいのは3つになる。
 *
 *   1. **マージ中だけ** ours / theirs を「現在のブランチ / 取り込み側」と訳す
 *      （rebase / cherry-pick では意味が逆になり、`stash pop` では枝の話ですらない）
 *   2. どちらの側にファイルが無いかが、**形だけで**決まる
 *      （Main から boolean を2つ受け取らない ── `shape` と食い違う組み合わせを作らない）
 *   3. 片側が無いことが、**言葉として**出る（空のファイルと見分けが付く）
 *
 * 中身の取り方は Main の側の話になる（main/git/gitConflictDiffRepository.test.ts）。
 */
describe('describeGitConflictDiffSides', () => {
  it('マージ中は、ours / theirs の意味を補う', () => {
    const sides = describeGitConflictDiffSides('both-modified', true)

    expect(sides.original).toBe('現在の Branch（ours / stage 2）')
    expect(sides.modified).toBe('取り込み側（theirs / stage 3）')
  })

  it('マージ中でなければ、ours / theirs を訳さない（中立に留める）', () => {
    const sides = describeGitConflictDiffSides('both-modified', false)

    expect(sides.original).toBe('ours（stage 2）')
    expect(sides.modified).toBe('theirs（stage 3）')
    // 「自分の変更」「相手の変更」と断定しない。
    expect(sides.original).not.toContain('現在の Branch')
    expect(sides.modified).not.toContain('取り込み側')
  })

  it('どちらの側でも、段の番号は隠さない（端末の --ours / --theirs と照合できる）', () => {
    for (const merging of [true, false]) {
      const sides = describeGitConflictDiffSides('both-modified', merging)

      expect(sides.original).toContain('stage 2')
      expect(sides.modified).toContain('stage 3')
    }
  })

  it('両方に中身がある形では、片側の不在を出さない', () => {
    for (const shape of ['both-modified', 'both-added'] as const) {
      const sides = describeGitConflictDiffSides(shape, true)

      expect(sides.originalMissing, shape).toBe(false)
      expect(sides.modifiedMissing, shape).toBe(false)
      expect(describeGitConflictMissingSides(sides, true), shape).toBeNull()
    }
  })

  it('右にファイルが無い形（削除された / ours だけが追加した）を見分ける', () => {
    for (const shape of ['deleted-by-them', 'added-by-us'] as const) {
      const sides = describeGitConflictDiffSides(shape, true)

      expect(sides.originalMissing, shape).toBe(false)
      expect(sides.modifiedMissing, shape).toBe(true)
    }
  })

  it('左にファイルが無い形（消した / theirs だけが追加した）を見分ける', () => {
    for (const shape of ['deleted-by-us', 'added-by-them'] as const) {
      const sides = describeGitConflictDiffSides(shape, true)

      expect(sides.originalMissing, shape).toBe(true)
      expect(sides.modifiedMissing, shape).toBe(false)
    }
  })

  it('両方で削除された形では、両側とも無い', () => {
    const sides = describeGitConflictDiffSides('both-deleted', true)

    expect(sides.originalMissing).toBe(true)
    expect(sides.modifiedMissing).toBe(true)
  })
})

describe('describeGitConflictMissingSides', () => {
  it('片側が無いときは、その側を名指しして「存在しません」と言う', () => {
    const text = describeGitConflictMissingSides(
      describeGitConflictDiffSides('deleted-by-them', true),
      true
    )

    expect(text).toBe('右（取り込み側）にはファイルが存在しません。')
  })

  it('両側とも無いときは、両方を言う', () => {
    const text = describeGitConflictMissingSides(
      describeGitConflictDiffSides('both-deleted', true),
      true
    )

    expect(text).toContain('左（現在の Branch）')
    expect(text).toContain('右（取り込み側）')
  })

  /*
    帯のラベルをそのまま挟むと「右（取り込み側（theirs / stage 3））には…」と
    括弧が二重になる ── 段の番号はすぐ上の帯に出ているので、文の側は
    短い呼び名で足りる。
  */
  it('段の番号を文の中まで持ち込まない（括弧が二重にならない）', () => {
    const text = describeGitConflictMissingSides(
      describeGitConflictDiffSides('added-by-us', true),
      true
    )

    expect(text).not.toContain('stage')
    expect(text).not.toContain('））')
  })

  it('マージ中でなければ、文の中の呼び名も訳さない', () => {
    const text = describeGitConflictMissingSides(
      describeGitConflictDiffSides('deleted-by-us', false),
      false
    )

    expect(text).toBe('左（ours）にはファイルが存在しません。')
  })
})

describe('describeGitConflictShape', () => {
  it('7つの形すべてに文がある（git の XY は出さない）', () => {
    const shapes = [
      'both-modified',
      'both-added',
      'deleted-by-them',
      'deleted-by-us',
      'both-deleted',
      'added-by-us',
      'added-by-them'
    ] as const

    for (const shape of shapes) {
      const text = describeGitConflictShape(shape, true)

      expect(text.length, shape).toBeGreaterThan(0)
      expect(text, shape).toMatch(/。$/)
      expect(text, shape).not.toMatch(/\b(UU|AA|UD|DU|DD|AU|UA)\b/)
    }
  })

  it('形ごとに違う文になる（「競合しています」で丸めない）', () => {
    const texts = new Set(
      (
        [
          'both-modified',
          'both-added',
          'deleted-by-them',
          'deleted-by-us',
          'both-deleted',
          'added-by-us',
          'added-by-them'
        ] as const
      ).map((shape) => describeGitConflictShape(shape, true))
    )

    expect(texts.size).toBe(7)
  })

  it('左右の呼び名は、ラベルと同じ規則で決まる', () => {
    expect(describeGitConflictShape('deleted-by-them', true)).toContain('取り込み側')
    expect(describeGitConflictShape('deleted-by-them', false)).not.toContain('取り込み側')
    expect(describeGitConflictShape('deleted-by-them', false)).toContain('theirs')
  })
})

describe('toGitDiffSubject（競合）', () => {
  it('競合の1行でも、その行そのものを返す', () => {
    const row = change({ kind: 'conflicted' })

    expect(toGitDiffSubject({ source: 'conflict', change: row, merging: true })).toBe(row)
  })
})
