import { describe, expect, it } from 'vitest'
import { GIT_COMMIT_MESSAGE_MAX_LENGTH } from '@shared/git'
import type {
  GitChangeKind,
  GitCommitMessageProblem,
  GitFileChange,
  GitHead,
  GitOperationFailureReason,
  GitWorkingTreeChanges
} from '@shared/git'
import {
  canDiscardGitChange,
  canOpenGitChange,
  countGitChanges,
  describeGitChangeKind,
  describeGitChangeRow,
  describeGitCommitMessageProblem,
  describeGitDiscardWarning,
  describeGitOperationFailure,
  describeGitUpstream,
  findGitDiscardBlocker,
  toGitDiscardGroup,
  GIT_COMMIT_AND_PUSH_OPERATION_KEY,
  GIT_COMMIT_OPERATION_KEY,
  GIT_PULL_OPERATION_KEY,
  GIT_PUSH_OPERATION_KEY,
  toGitChangeGroups,
  toGitCommitAndPushReadiness,
  toGitCommitReadiness,
  toGitGroupStageTarget,
  toGitOperationKey,
  toGitPullReadiness,
  toGitPushReadiness,
  toGitRowAction
} from './gitChanges'

/**
 * 変更ファイルの一覧の見せ方の検証（Session 3-8-2）。
 *
 * gitRepositoryMessage.test.ts が「どの状態にも次の一手があるか」を見るのに対し、
 * こちらは**一覧が嘘をつかないか**を見る ── 件数が実際の変更と合っているか、
 * 開けないものを押せるように見せていないか、rename が2件に化けていないか。
 */

function change(
  relativePath: string,
  kind: GitChangeKind,
  extra: Partial<GitFileChange> = {}
): GitFileChange {
  return { relativePath, kind, originalPath: null, directory: false, ...extra }
}

const EMPTY: GitWorkingTreeChanges = {
  staged: [],
  unstaged: [],
  untracked: [],
  conflicted: []
}

describe('toGitChangeGroups', () => {
  it('変更が無ければグループを1つも出さない', () => {
    expect(toGitChangeGroups(EMPTY)).toEqual([])
  })

  it('空のグループは並べない（0 件の見出しを出さない）', () => {
    const groups = toGitChangeGroups({ ...EMPTY, untracked: [change('a.txt', 'untracked')] })

    expect(groups.map((group) => group.id)).toEqual(['untracked'])
  })

  /*
    上から下へ「Commit に近い順」。競合が先頭なのは、解決しないと Commit すら
    できないため。
  */
  it('競合 → ステージ済み → 変更 → 未追跡 の順に並べる', () => {
    const groups = toGitChangeGroups({
      staged: [change('s.txt', 'modified')],
      unstaged: [change('u.txt', 'modified')],
      untracked: [change('n.txt', 'untracked')],
      conflicted: [change('c.txt', 'conflicted')]
    })

    expect(groups.map((group) => group.id)).toEqual([
      'conflicted',
      'staged',
      'unstaged',
      'untracked'
    ])
  })

  it('グループには見出しの文言が付く', () => {
    const groups = toGitChangeGroups({ ...EMPTY, staged: [change('s.txt', 'modified')] })

    expect(groups[0]?.label).toBe('ステージ済みの変更')
  })

  it('渡された並びを変えない', () => {
    const groups = toGitChangeGroups({
      ...EMPTY,
      unstaged: [change('z.txt', 'modified'), change('a.txt', 'modified')]
    })

    expect(groups[0]?.changes.map((entry) => entry.relativePath)).toEqual(['z.txt', 'a.txt'])
  })
})

describe('countGitChanges', () => {
  it('4つのグループを合計する（同じファイルが2つのグループに居ても2件と数える）', () => {
    expect(
      countGitChanges({
        staged: [change('a.txt', 'modified')],
        unstaged: [change('a.txt', 'modified')],
        untracked: [change('b.txt', 'untracked')],
        conflicted: [change('c.txt', 'conflicted')]
      })
    ).toBe(4)
  })

  it('変更が無ければ 0', () => {
    expect(countGitChanges(EMPTY)).toBe(0)
  })
})

describe('describeGitChangeKind', () => {
  const KINDS: readonly GitChangeKind[] = [
    'added',
    'modified',
    'deleted',
    'renamed',
    'copied',
    'type-changed',
    'untracked',
    'conflicted'
  ]

  it('どの種類にも記号と言葉の両方がある（記号だけに意味を預けない）', () => {
    for (const kind of KINDS) {
      const described = describeGitChangeKind(kind)

      expect(described.symbol.length).toBeGreaterThan(0)
      expect(described.label.length).toBeGreaterThan(0)
    }
  })

  it('種類ごとに違う記号を使う（別のものが同じ字に潰れない）', () => {
    const symbols = KINDS.map((kind) => describeGitChangeKind(kind).symbol)

    expect(new Set(symbols).size).toBe(KINDS.length)
  })

  it('記号は git の短い形と同じ字を使う', () => {
    expect(describeGitChangeKind('modified').symbol).toBe('M')
    expect(describeGitChangeKind('untracked').symbol).toBe('?')
  })
})

describe('canOpenGitChange', () => {
  it('普通のファイルは開ける', () => {
    expect(canOpenGitChange(change('src/app.ts', 'modified'))).toBe(true)
  })

  it('削除されたファイルは開けない（もうそこに無い）', () => {
    expect(canOpenGitChange(change('gone.txt', 'deleted'))).toBe(false)
  })

  it('未追跡のフォルダは開けない', () => {
    expect(canOpenGitChange(change('brand-new', 'untracked', { directory: true }))).toBe(false)
  })

  it('rename では移動後のファイルとして開ける', () => {
    expect(canOpenGitChange(change('new.txt', 'renamed', { originalPath: 'old.txt' }))).toBe(true)
  })
})

describe('describeGitChangeRow', () => {
  it('名前と、それが入っているフォルダを分ける', () => {
    expect(describeGitChangeRow(change('src/main/app.ts', 'modified'))).toEqual({
      name: 'app.ts',
      location: 'src/main'
    })
  })

  it('root 直下のファイルには場所を出さない', () => {
    expect(describeGitChangeRow(change('README.md', 'modified')).location).toBeNull()
  })

  it('rename では、場所の代わりに元の位置を出す', () => {
    expect(
      describeGitChangeRow(change('docs/new.md', 'renamed', { originalPath: 'old.md' }))
    ).toEqual({ name: 'new.md', location: 'old.md から' })
  })

  it('日本語や空白を含む名前をそのまま扱う', () => {
    expect(describeGitChangeRow(change('ドキュメント/設計 メモ.txt', 'untracked'))).toEqual({
      name: '設計 メモ.txt',
      location: 'ドキュメント'
    })
  })
})

describe('describeGitUpstream', () => {
  it('upstream が無ければ欄そのものを出さない', () => {
    expect(describeGitUpstream(null)).toBeNull()
  })

  it('進み具合を両方向とも出す', () => {
    const described = describeGitUpstream({ name: 'origin/main', ahead: 2, behind: 3 })

    expect(described?.text).toBe('↑2 ↓3')
    expect(described?.title).toContain('origin/main')
  })

  /*
    追跡先があって同期している状態と、追跡先が無い状態は別のこと。
    後者は null（欄が出ない）で表す。
  */
  it('同期していても 0 として出す（追跡先が無いのと同じ見た目にしない）', () => {
    expect(describeGitUpstream({ name: 'origin/main', ahead: 0, behind: 0 })?.text).toBe('↑0 ↓0')
  })

  it('差が分からない場合は 0 と書かず、追跡先の名前だけを出す', () => {
    const described = describeGitUpstream({ name: 'origin/main', ahead: null, behind: null })

    expect(described?.text).toBe('origin/main')
    expect(described?.text).not.toContain('0')
  })
})

/**
 * 行に置く操作（Session 3-8-3）。
 *
 * **グループから決める**ことをここで固定する。同じ `modified` でも、
 * staged なら外す側・unstaged なら載せる側になり、行の `kind` からは決まらない。
 */
describe('toGitRowAction', () => {
  it('ステージ済みの行では外す側になる', () => {
    expect(toGitRowAction('staged')).toBe('unstage')
  })

  it('変更と未追跡の行では載せる側になる', () => {
    expect(toGitRowAction('unstaged')).toBe('stage')
    expect(toGitRowAction('untracked')).toBe('stage')
  })

  /*
    競合には操作を置かない。解決するまで Stage も Unstage も意味を持たず、
    押せる形にすれば成立しない操作を勧めることになる。
  */
  it('競合の行には操作を置かない', () => {
    expect(toGitRowAction('conflicted')).toBeNull()
  })
})

describe('toGitGroupStageTarget', () => {
  it('変更と未追跡の見出しには「すべて Stage」を置く', () => {
    expect(toGitGroupStageTarget('unstaged')).toEqual({ kind: 'unstaged' })
    expect(toGitGroupStageTarget('untracked')).toEqual({ kind: 'untracked' })
  })

  /*
    ステージ済みに対の操作（すべて Unstage）を置かない。次の Commit の中身を
    丸ごと空にする操作で、押し間違いの代償が釣り合わない。
  */
  it('ステージ済みと競合の見出しには置かない', () => {
    expect(toGitGroupStageTarget('staged')).toBeNull()
    expect(toGitGroupStageTarget('conflicted')).toBeNull()
  })
})

/**
 * 動いている操作の目印。
 *
 * これが行ごとに一意でないと、押した行以外のボタンまで押せなくなる
 * （あるいは、押した行が押せるままになって二重に走る）。
 */
describe('toGitOperationKey', () => {
  it('ファイルごとに別の目印になる', () => {
    expect(toGitOperationKey({ kind: 'file', relativePath: 'a.txt' })).not.toBe(
      toGitOperationKey({ kind: 'file', relativePath: 'b.txt' })
    )
  })

  /*
    同じファイルの Stage と Unstage は同じ目印にする。同時に走らせると、
    後から届いた方が前の結果を上書きし、どちらが効いたのか分からなくなる。
  */
  it('同じファイルの Stage と Unstage は同じ目印になる', () => {
    expect(toGitOperationKey({ kind: 'file', relativePath: 'a.txt' })).toBe(
      toGitOperationKey({ kind: 'unstage', relativePath: 'a.txt' })
    )
  })

  it('グループは行とぶつからない別枠になる', () => {
    const group = toGitOperationKey({ kind: 'unstaged' })

    expect(group).not.toBe(toGitOperationKey({ kind: 'untracked' }))
    expect(group).not.toBe(toGitOperationKey({ kind: 'file', relativePath: 'unstaged' }))
  })
})

/**
 * 操作が通らなかった理由の文言。
 *
 * gitRepositoryMessage.test.ts が「どの状態にも次の一手があるか」を見るのと同じ形で、
 * こちらも**分類を増やしたときに文言を足し忘れない**ことを見る。
 */
describe('describeGitOperationFailure', () => {
  const reasons: readonly GitOperationFailureReason[] = [
    'not-ready',
    'nothing-to-do',
    'identity-missing',
    'hook-rejected',
    'unresolved-conflicts',
    'path-not-found',
    'not-on-branch',
    'no-remote',
    'no-upstream',
    'auth-required',
    'network-unavailable',
    'push-rejected',
    'remote-rejected',
    'diverged',
    'local-changes-blocked',
    'branch-exists',
    'branch-not-merged',
    'branch-checked-out',
    'branch-not-found',
    'commit-not-found',
    'stash-not-found',
    'no-commit',
    'unsupported-target',
    'target-busy',
    'index-locked',
    'permission-denied',
    'timeout',
    'unknown'
  ]

  it.each(reasons)('%s に文言がある', (reason) => {
    const message = describeGitOperationFailure({ status: 'failed', reason })

    expect(message.length).toBeGreaterThan(0)
    // 生の stderr を出さない方針の裏返し。英語の断片が混ざっていないこと。
    expect(message).not.toContain('fatal:')
  })

  it('同じ文言が2つの理由に付いていない', () => {
    const messages = reasons.map((reason) =>
      describeGitOperationFailure({ status: 'failed', reason })
    )

    expect(new Set(messages).size).toBe(reasons.length)
  })

  /**
   * Session 3-8-5 でいちばん取り違えてはいけないところ。
   *
   * Commit & Push が途中で止まったときに「失敗しました」だけを出すと、
   * 利用者は同じ内容をもう一度 Commit する ── 履歴に同じ commit が2つ積まれる。
   */
  describe('partly-applied（Commit は通ったが Push が通らなかった）', () => {
    it.each(reasons)('%s でも Commit が済んでいることを先に伝える', (reason) => {
      const message = describeGitOperationFailure({
        status: 'partly-applied',
        completed: 'commit',
        reason
      })

      expect(message).toContain('Commit は完了')
      expect(message.indexOf('Commit は完了')).toBe(0)
    })

    it('同じ理由でも failed とは別の文言になる', () => {
      const failed = describeGitOperationFailure({ status: 'failed', reason: 'auth-required' })
      const partly = describeGitOperationFailure({
        status: 'partly-applied',
        completed: 'commit',
        reason: 'auth-required'
      })

      expect(partly).not.toBe(failed)
      // 理由そのものは同じものを使う（2箇所に文言を書かない）。
      expect(partly).toContain(failed)
    })
  })

  /**
   * Session 3-8-15 で3つめの `partly-applied` が増えた。
   *
   * ここで取り違えてはいけないのは、**退避が残っていること**になる ──
   * 「戻せなかった」と読ませると押し直され、中身は既に作業ツリーへ
   * 書き込まれているので、2回目は「上書きされる」として断られるだけになる。
   */
  describe('partly-applied（退避は戻ったが競合した）', () => {
    it('退避が一覧に残っていることを先に伝える', () => {
      const message = describeGitOperationFailure({
        status: 'partly-applied',
        completed: 'stash-apply',
        reason: 'unresolved-conflicts'
      })

      expect(message.indexOf('退避の内容は作業ツリーに戻りました')).toBe(0)
      expect(message).toContain('退避は一覧に残しています')
    })

    it('Commit の前半とは違う文言になる', () => {
      const stash = describeGitOperationFailure({
        status: 'partly-applied',
        completed: 'stash-apply',
        reason: 'unresolved-conflicts'
      })

      expect(stash).not.toContain('Commit は完了')
    })
  })
})

/**
 * Commit メッセージの問題の文言（Session 3-8-4）。
 *
 * 規則そのものは shared（commitMessage.test.ts）で、こちらが見るのは
 * **分類を増やしたときに文言を足し忘れない**ことになる。
 */
describe('describeGitCommitMessageProblem', () => {
  const problems: readonly GitCommitMessageProblem[] = ['empty', 'too-long', 'invalid-characters']

  it.each(problems)('%s に文言がある', (problem) => {
    expect(describeGitCommitMessageProblem(problem).length).toBeGreaterThan(0)
  })

  it('上限の文言に実際の数字が入っている', () => {
    expect(describeGitCommitMessageProblem('too-long')).toContain(
      GIT_COMMIT_MESSAGE_MAX_LENGTH.toLocaleString()
    )
  })
})

/**
 * Commit ボタンが押せるか（Session 3-8-4）。
 *
 * 押せる / 押せないを決める条件が3つあり、そのどれもが**押した後ではなく
 * 押す前に**分かる。ここで固定しておかないと、条件が JSX の式の中へ散る。
 */
describe('toGitCommitReadiness', () => {
  it('ステージ済みがあってメッセージも書けていれば押せる', () => {
    expect(toGitCommitReadiness('fix: 直した', 1, false)).toEqual({
      enabled: true,
      note: null,
      remaining: null
    })
  })

  it('ステージ済みが無ければ押せない（理由も出す）', () => {
    const readiness = toGitCommitReadiness('fix: 直した', 0, false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).not.toBeNull()
  })

  /* 何も書いていない欄の下に「入力してください」と出しても、増えるのは文字だけ。 */
  it('メッセージが空なら押せないが、理由は出さない', () => {
    expect(toGitCommitReadiness('', 1, false)).toEqual({
      enabled: false,
      note: null,
      remaining: null
    })
  })

  it('空白だけのメッセージも空と同じ扱い', () => {
    expect(toGitCommitReadiness('   \n\t ', 1, false).enabled).toBe(false)
  })

  it('上限を超えたメッセージでは押せず、理由を出す', () => {
    const readiness = toGitCommitReadiness('a'.repeat(GIT_COMMIT_MESSAGE_MAX_LENGTH + 1), 1, false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toBe(describeGitCommitMessageProblem('too-long'))
  })

  it('上限ちょうどなら押せる', () => {
    expect(toGitCommitReadiness('a'.repeat(GIT_COMMIT_MESSAGE_MAX_LENGTH), 1, false).enabled).toBe(
      true
    )
  })

  it('NUL を含むメッセージでは押せず、理由を出す', () => {
    const readiness = toGitCommitReadiness('fix\u0000ed', 1, false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toBe(describeGitCommitMessageProblem('invalid-characters'))
  })

  /*
    行の Stage / Unstage は押した対象だけを止めるが、Commit の中身は
    ステージ済みの**全体**で、走っている操作はまさにそれを書き換えている。
  */
  it('他の Git 操作が動いている間は押せない', () => {
    expect(toGitCommitReadiness('fix: 直した', 1, true).enabled).toBe(false)
  })

  it('日本語・引用符・改行を含むメッセージで押せる', () => {
    expect(toGitCommitReadiness('日本語の "要約"\n\n本文', 2, false).enabled).toBe(true)
  })

  it('残り文字数は上限に近づくまで出さない', () => {
    expect(toGitCommitReadiness('fix', 1, false).remaining).toBeNull()
  })

  it('残り文字数は前後の空白を落とした長さで数える', () => {
    const body = 'a'.repeat(GIT_COMMIT_MESSAGE_MAX_LENGTH - 5)

    expect(toGitCommitReadiness(`  ${body}\n\n  `, 1, false).remaining).toBe(5)
  })

  /* 超過している間は文言（note）の方が出るので、この数字は画面には出ない。 */
  it('超過した分はマイナスで数える', () => {
    const readiness = toGitCommitReadiness('a'.repeat(GIT_COMMIT_MESSAGE_MAX_LENGTH + 3), 1, false)

    expect(readiness.remaining).toBe(-3)
    expect(readiness.note).toBe(describeGitCommitMessageProblem('too-long'))
  })
})

/**
 * Push / Pull / Commit & Push が押せるか（Session 3-8-5）。
 *
 * ここが見ているのは「押せない形を作っていないか」と「押せてはいけない形を
 * 押せるようにしていないか」の2つで、そのどちらも**画面に出ている値だけ**から
 * 決まる（remote の有無や commit の有無は Main が答える。main/git/gitSync.ts）。
 */
describe('toGitPushReadiness', () => {
  const branch: GitHead = { kind: 'branch', name: 'main' }

  /* 初回の Push（`--set-upstream`）は、いちばん押したい場面にあたる。 */
  it('追跡先がまだ無くても押せる', () => {
    expect(toGitPushReadiness(branch, null, false).enabled).toBe(true)
  })

  it('送る Commit があれば押せる', () => {
    const readiness = toGitPushReadiness(
      branch,
      { name: 'origin/main', ahead: 2, behind: 0 },
      false
    )

    expect(readiness.enabled).toBe(true)
    // 何件をどこへ送るかは、押す前に読めるようにしてある。
    expect(readiness.note).toContain('origin/main')
    expect(readiness.note).toContain('2')
  })

  it('差が 0 なら押せない', () => {
    const readiness = toGitPushReadiness(
      branch,
      { name: 'origin/main', ahead: 0, behind: 3 },
      false
    )

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toContain('origin/main')
  })

  /* 分からないことを「無い」として扱わない（shared/git/status.ts）。 */
  it('差が分からない場合は止めない', () => {
    expect(
      toGitPushReadiness(branch, { name: 'origin/main', ahead: null, behind: null }, false).enabled
    ).toBe(true)
  })

  it('detached HEAD では押せない', () => {
    expect(toGitPushReadiness({ kind: 'detached', commit: 'abc1234' }, null, false).enabled).toBe(
      false
    )
  })

  it('ブランチが読めない状態でも押せない', () => {
    expect(toGitPushReadiness({ kind: 'unknown' }, null, false).enabled).toBe(false)
  })

  it('他の Git 操作が動いている間は押せない', () => {
    expect(toGitPushReadiness(branch, null, true).enabled).toBe(false)
  })

  it('押せないときも理由が空にならない', () => {
    expect(toGitPushReadiness({ kind: 'unknown' }, null, false).note.length).toBeGreaterThan(0)
  })
})

describe('toGitPullReadiness', () => {
  const branch: GitHead = { kind: 'branch', name: 'main' }

  it('追跡先があれば押せる', () => {
    const readiness = toGitPullReadiness(
      branch,
      { name: 'origin/main', ahead: 0, behind: 2 },
      false
    )

    expect(readiness.enabled).toBe(true)
    expect(readiness.note).toContain('origin/main')
  })

  /*
    `behind` は前回 fetch した時点の写しでしかない。0 で止めると、
    新しい変更を取りに行く手段そのものを塞ぐことになる。
  */
  it('遅れが 0 でも押せる（取りに行くこと自体が Pull の半分）', () => {
    expect(
      toGitPullReadiness(branch, { name: 'origin/main', ahead: 0, behind: 0 }, false).enabled
    ).toBe(true)
  })

  it('遅れが分からなくても押せる', () => {
    expect(
      toGitPullReadiness(branch, { name: 'origin/main', ahead: null, behind: null }, false).enabled
    ).toBe(true)
  })

  /* Push と対称でないのは、あちらが追跡先を作る側だから。 */
  it('追跡先が無ければ押せない', () => {
    const readiness = toGitPullReadiness(branch, null, false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note.length).toBeGreaterThan(0)
  })

  it('detached HEAD では押せない', () => {
    expect(
      toGitPullReadiness(
        { kind: 'detached', commit: 'abc1234' },
        { name: 'origin/main', ahead: 0, behind: 1 },
        false
      ).enabled
    ).toBe(false)
  })

  it('他の Git 操作が動いている間は押せない', () => {
    expect(
      toGitPullReadiness(branch, { name: 'origin/main', ahead: 0, behind: 1 }, true).enabled
    ).toBe(false)
  })
})

describe('toGitCommitAndPushReadiness', () => {
  const branch: GitHead = { kind: 'branch', name: 'main' }

  it('Commit が押せるなら押せる', () => {
    const commit = toGitCommitReadiness('fix: 直した', 1, false)

    expect(toGitCommitAndPushReadiness(commit, branch).enabled).toBe(true)
  })

  /* 「Commit は押せないのに Commit & Push は押せる」を作らない。 */
  it.each([
    ['ステージ済みが無い', toGitCommitReadiness('fix: 直した', 0, false)],
    ['メッセージが空', toGitCommitReadiness('', 1, false)],
    ['他の Git 操作が動いている', toGitCommitReadiness('fix: 直した', 1, true)]
  ])('Commit が押せないとき（%s）は押せない', (_label, commit) => {
    expect(toGitCommitAndPushReadiness(commit, branch).enabled).toBe(false)
  })

  /*
    これから作る Commit が必ず1件増えるので、`ahead` は見ない ──
    「送るものが無い」は成り立たない。
  */
  it('追跡先が無くても、Commit が押せるなら押せる', () => {
    const commit = toGitCommitReadiness('最初のコミット', 1, false)

    expect(toGitCommitAndPushReadiness(commit, branch).enabled).toBe(true)
  })

  it('detached HEAD では押せない', () => {
    const commit = toGitCommitReadiness('fix: 直した', 1, false)

    expect(
      toGitCommitAndPushReadiness(commit, { kind: 'detached', commit: 'abc1234' }).enabled
    ).toBe(false)
  })
})

/**
 * 目印が互いにぶつかっていないこと（Session 3-8-5）。
 *
 * ぶつかると、片方を押している間にもう片方まで押せなくなる ──
 * あるいは逆に、二重の要求が通ってしまう（useGitRepository.ts）。
 */
describe('操作の目印', () => {
  it('Commit / Push / Pull / Commit & Push が別々の目印を持つ', () => {
    const keys = [
      GIT_COMMIT_OPERATION_KEY,
      GIT_PUSH_OPERATION_KEY,
      GIT_PULL_OPERATION_KEY,
      GIT_COMMIT_AND_PUSH_OPERATION_KEY
    ]

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('ファイル / グループの目印ともぶつからない', () => {
    const keys = [
      GIT_COMMIT_OPERATION_KEY,
      GIT_PUSH_OPERATION_KEY,
      GIT_PULL_OPERATION_KEY,
      GIT_COMMIT_AND_PUSH_OPERATION_KEY,
      toGitOperationKey({ kind: 'file', relativePath: 'push' }),
      toGitOperationKey({ kind: 'unstaged' }),
      toGitOperationKey({ kind: 'untracked' })
    ]

    expect(new Set(keys).size).toBe(keys.length)
  })
})

/**
 * 破棄（Session 3-8-9）。
 *
 * Git の操作でここだけが「利用者の書いたものが消える」ため、固定しておきたいのは
 * **押せない行が押せないこと**と、**何が起きるかを押す前に正しく言うこと**になる。
 */
describe('canDiscardGitChange', () => {
  it('ステージ済みからは破棄できない（先に Unstage する）', () => {
    expect(canDiscardGitChange('staged', change('a.txt', 'modified'))).toBe(false)
    expect(canDiscardGitChange('staged', change('a.txt', 'added'))).toBe(false)
    expect(canDiscardGitChange('staged', change('a.txt', 'deleted'))).toBe(false)
  })

  it('競合からは破棄できない', () => {
    expect(canDiscardGitChange('conflicted', change('a.txt', 'conflicted'))).toBe(false)
  })

  it('未追跡のフォルダ1件からは破棄できない（数万件の削除に化けない）', () => {
    expect(
      canDiscardGitChange('untracked', change('node_modules', 'untracked', { directory: true }))
    ).toBe(false)
  })

  it('変更と未追跡のファイルからは破棄できる', () => {
    expect(canDiscardGitChange('unstaged', change('a.txt', 'modified'))).toBe(true)
    expect(canDiscardGitChange('unstaged', change('a.txt', 'deleted'))).toBe(true)
    expect(canDiscardGitChange('untracked', change('a.txt', 'untracked'))).toBe(true)
  })
})

describe('toGitDiscardGroup', () => {
  it('ステージ済みと競合は渡せない', () => {
    expect(toGitDiscardGroup('staged')).toBeNull()
    expect(toGitDiscardGroup('conflicted')).toBeNull()
  })

  it('変更と未追跡はそのまま渡る', () => {
    expect(toGitDiscardGroup('unstaged')).toBe('unstaged')
    expect(toGitDiscardGroup('untracked')).toBe('untracked')
  })
})

describe('describeGitDiscardWarning', () => {
  it('未追跡は「ごみ箱」と「戻せる」を言う', () => {
    const warning = describeGitDiscardWarning('untracked', change('src/new.ts', 'untracked'))

    expect(warning.message).toContain('new.ts')
    expect(warning.message).toContain('ごみ箱')
    expect(warning.note).toContain('元に戻せます')
    expect(warning.confirmLabel).toBe('ごみ箱に移動')
  })

  it('変更は「元に戻せません」を言う（未追跡と同じ文にしない）', () => {
    const warning = describeGitDiscardWarning('unstaged', change('src/app.ts', 'modified'))

    expect(warning.message).toContain('app.ts')
    expect(warning.note).toContain('元に戻せません')
    expect(warning.confirmLabel).toBe('変更を破棄')
  })

  it('変更では、ステージ済みが変わらないことも言う', () => {
    expect(describeGitDiscardWarning('unstaged', change('a.txt', 'modified')).note).toContain(
      'ステージ済みの内容は変わりません'
    )
  })

  it('消したファイルでは「復元します」と言う（破棄という言葉だけにしない）', () => {
    expect(describeGitDiscardWarning('unstaged', change('a.txt', 'deleted')).message).toContain(
      '復元'
    )
  })
})

describe('findGitDiscardBlocker', () => {
  it('未保存のタブが無ければ止めない', () => {
    expect(findGitDiscardBlocker('src/app.ts', new Set())).toBeNull()
    expect(findGitDiscardBlocker('src/app.ts', new Set(['src/other.ts']))).toBeNull()
  })

  it('未保存のタブがあれば、次の一手と一緒に止める', () => {
    const blocker = findGitDiscardBlocker('src/app.ts', new Set(['src/app.ts']))

    expect(blocker).not.toBeNull()
    expect(blocker).toContain('保存')
    expect(blocker).toContain('タブ')
  })
})

describe('破棄の目印', () => {
  it('同じ行の Stage / Unstage と**同じ**目印になる（2本同時に走らない）', () => {
    const stage = toGitOperationKey({ kind: 'file', relativePath: 'src/app.ts' })
    const unstage = toGitOperationKey({ kind: 'unstage', relativePath: 'src/app.ts' })
    const discard = toGitOperationKey({ kind: 'discard', relativePath: 'src/app.ts' })

    expect(discard).toBe(stage)
    expect(discard).toBe(unstage)
  })

  it('別の行とはぶつからない', () => {
    expect(toGitOperationKey({ kind: 'discard', relativePath: 'a.txt' })).not.toBe(
      toGitOperationKey({ kind: 'discard', relativePath: 'b.txt' })
    )
  })
})
