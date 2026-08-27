import { GIT_BRANCH_NAME_MAX_LENGTH, type GitBranchNameProblem } from '@shared/git'
import { describe, expect, it } from 'vitest'
import {
  describeGitBranchDeleteWarning,
  describeGitBranchList,
  describeGitBranchNameProblem,
  describeGitBranchTruncation,
  toGitBranchCreateReadiness,
  toGitBranchDeleteReadiness,
  toGitBranchRenameReadiness,
  toGitBranchSwitchReadiness,
  toGitCommitBranchReadiness,
  type GitBranchListState
} from './gitBranches'

/**
 * ブランチを選ぶ面の中身（gitBranches.ts）。
 *
 * gitChanges.test.ts が「押せる条件と、押せない理由が1箇所で決まっているか」を
 * 見るのと同じ形で、こちらも次の2つを固定する。
 *
 *   - **今のブランチも押せる**（印は付くが、薄くならない）
 *   - 名前の問題ごとに、**直し方の分かる文言**が出る
 */

/** 一覧の姿を組み立てる（既定は「取れている」）。 */
function listOf(overrides: Partial<GitBranchListState> = {}): GitBranchListState {
  return {
    status: 'ready',
    branches: [
      { name: 'main', current: true },
      { name: 'feature/x', current: false }
    ],
    truncated: false,
    ...overrides
  }
}

describe('describeGitBranchList', () => {
  it('行が出せるなら一言は出さない', () => {
    // 「選べるもの」と「選べない理由」を同時に並べない。
    expect(describeGitBranchList(listOf())).toBeNull()
  })

  it('取得中は、まだ「ありません」と言わない', () => {
    const notice = describeGitBranchList(listOf({ status: 'loading', branches: [] }))

    expect(notice).not.toBeNull()
    expect(notice).toContain('取得')
  })

  it.each<GitBranchListState['status']>(['loading', 'not-ready', 'failed'])(
    '%s には一言がある',
    (status) => {
      expect(describeGitBranchList(listOf({ status, branches: [] }))?.length).toBeGreaterThan(0)
    }
  )

  it('状態ごとに違う文言になる', () => {
    const notices = (['loading', 'not-ready', 'failed'] as const).map((status) =>
      describeGitBranchList(listOf({ status, branches: [] }))
    )

    expect(new Set(notices).size).toBe(notices.length)
  })

  /*
    `git init` の直後。ブランチ名は出ているのに一覧が空になるのはこの場合だけで、
    失敗ではない ── 次の一手（最初の Commit）まで書く。
  */
  it('1件も無いときは、失敗ではなく次の一手を出す', () => {
    const notice = describeGitBranchList(listOf({ branches: [] }))

    expect(notice).toContain('Commit')
  })
})

describe('describeGitBranchTruncation', () => {
  it('切れていなければ出さない', () => {
    expect(describeGitBranchTruncation(listOf())).toBeNull()
  })

  it('切れていたら件数を添えて言う（黙って捨てない）', () => {
    const note = describeGitBranchTruncation(listOf({ truncated: true }))

    expect(note).toContain('2')
  })

  it('取得中や失敗のときは出さない', () => {
    expect(describeGitBranchTruncation(listOf({ status: 'failed', truncated: true }))).toBeNull()
  })
})

describe('toGitBranchSwitchReadiness', () => {
  /**
   * Session 3-8-6 でいちばん取り違えやすいところ。
   *
   * 今のブランチを押せなくすると、「今どこに居るか」を確かめるために開いた面で、
   * いちばん見たい行だけが薄くなる。押しても git は動かない（`nothing-to-do`）。
   */
  it('今のブランチも押せる（印だけが違う）', () => {
    const readiness = toGitBranchSwitchReadiness({ name: 'main', current: true }, false)

    expect(readiness.enabled).toBe(true)
    expect(readiness.note).toContain('今このブランチ')
  })

  it('他のブランチは「切り替えます」と言う', () => {
    const readiness = toGitBranchSwitchReadiness({ name: 'feature/x', current: false }, false)

    expect(readiness.enabled).toBe(true)
    expect(readiness.note).toContain('feature/x')
  })

  /* 切り替えは「今のブランチ全体」を相手にする操作（Commit / Push と同じ扱い）。 */
  it('他の Git 操作が動いている間は押せない', () => {
    expect(toGitBranchSwitchReadiness({ name: 'feature/x', current: false }, true).enabled).toBe(
      false
    )
    expect(toGitBranchSwitchReadiness({ name: 'main', current: true }, true).enabled).toBe(false)
  })
})

describe('toGitBranchCreateReadiness', () => {
  it('通る名前なら押せて、何が起きるかを言う', () => {
    const readiness = toGitBranchCreateReadiness('feature/x', false)

    expect(readiness.enabled).toBe(true)
    expect(readiness.note).toContain('feature/x')
  })

  it('前後の空白は落としてから見る', () => {
    const readiness = toGitBranchCreateReadiness('  feature/x  ', false)

    expect(readiness.enabled).toBe(true)
    expect(readiness.note).toContain('feature/x')
  })

  /*
    打つ前から「入力してください」と出さない ── まだ何も間違えていない人に
    間違いを知らせる形になる。
  */
  it('空のときは押せないが、理由ではなく何が起きるかを言う', () => {
    const readiness = toGitBranchCreateReadiness('', false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toContain('新しいブランチ')
  })

  it.each([
    ['空白を含む', 'my branch'],
    ['先頭の -', '-x'],
    ['範囲の記法', 'a..b'],
    ['予約された名前', 'HEAD'],
    ['長すぎる', 'a'.repeat(GIT_BRANCH_NAME_MAX_LENGTH + 1)]
  ])('%s 名前は押せず、理由が出る', (_label, name) => {
    const readiness = toGitBranchCreateReadiness(name, false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note.length).toBeGreaterThan(0)
  })

  it('他の Git 操作が動いている間は押せない', () => {
    expect(toGitBranchCreateReadiness('feature/x', true).enabled).toBe(false)
  })

  /*
    既にある名前かどうかは見ない（一覧は切れていることがあり、
    大文字小文字の衝突は git にしか分からない）。押した結果として Main が答える。
  */
  it('既にある名前かどうかは、ここでは見ない', () => {
    expect(toGitBranchCreateReadiness('main', false).enabled).toBe(true)
  })
})

/**
 * 履歴の commit を始点にする欄（Session 3-8-13）。
 *
 * 判断そのものは `toGitBranchCreateReadiness` と同じ（名前の形・他の Git 操作）で、
 * ここで固定したいのは**言い方が別のものになっている**ことになる ──
 * バーの「＋」は「今の場所から」、こちらは「この commit から」で、
 * 利用者にとってはまったく別のことにあたる。
 */
describe('toGitCommitBranchReadiness', () => {
  it('通る名前なら押せて、始点と名前の両方を言う', () => {
    const readiness = toGitCommitBranchReadiness('feature/x', 'a1b2c3d', false)

    expect(readiness.enabled).toBe(true)
    expect(readiness.note).toContain('feature/x')
    // どこから作るのかが、押す前の1行に必ず出ている。
    expect(readiness.note).toContain('a1b2c3d')
  })

  it('前後の空白は落としてから見る', () => {
    const readiness = toGitCommitBranchReadiness('  feature/x  ', 'a1b2c3d', false)

    expect(readiness.enabled).toBe(true)
    expect(readiness.note).toContain('feature/x')
  })

  /*
    空でも**始点だけは言う** ── 押した行の下に開いた欄で、そこが
    「どの commit の話なのか」を黙っていると、打ち始める前に確かめる先が無くなる。
  */
  it('空のときは押せないが、理由ではなく何が起きるかを言う', () => {
    const readiness = toGitCommitBranchReadiness('', 'a1b2c3d', false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toContain('a1b2c3d')
    expect(readiness.note).not.toContain('入力してください')
  })

  it.each([
    ['空白を含む', 'my branch'],
    ['先頭の -', '-x'],
    ['範囲の記法', 'a..b'],
    ['予約された名前', 'HEAD'],
    ['長すぎる', 'a'.repeat(GIT_BRANCH_NAME_MAX_LENGTH + 1)]
  ])('%s 名前は押せず、理由が出る', (_label, name) => {
    const readiness = toGitCommitBranchReadiness(name, 'a1b2c3d', false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note.length).toBeGreaterThan(0)
  })

  it('他の Git 操作が動いている間は押せない', () => {
    expect(toGitCommitBranchReadiness('feature/x', 'a1b2c3d', true).enabled).toBe(false)
  })

  /*
    3-8-6 の欄と**言い方が違う**こと。同じ文になっていると、履歴から作ったのに
    「今の場所から」と出ることになる（押した行と違う場所に生えたように読める）。
  */
  it('バーの「＋」とは違う文言になっている', () => {
    const fromHead = toGitBranchCreateReadiness('feature/x', false)
    const fromCommit = toGitCommitBranchReadiness('feature/x', 'a1b2c3d', false)

    expect(fromCommit.note).not.toBe(fromHead.note)
  })

  /*
    マージ commit を弾く条件を持たない ── 3-8-12 の差分は「どちらの親と
    比べるか」が決まらないため断っているが、始点にはその問いが無い。
    ここは hash しか受け取らないので、**そもそもマージかどうかを見る手立てが
    無い**ことが、そのまま「弾かない」ことの担保になっている。
  */
  it('始点として受け取るのは hash だけ（マージかどうかを見ない）', () => {
    expect(toGitCommitBranchReadiness('feature/x', '9136d41', false).enabled).toBe(true)
  })
})

/**
 * 削除できるか（Session 3-8-14）。
 *
 * ここで固定したいのは、**行そのものと ✕ で判断が違う**ことになる ──
 * 行は今のブランチでも押せる（押しても何も起きない）が、✕ は押せない
 * （押しても絶対に通らない）。
 */
describe('toGitBranchDeleteReadiness', () => {
  it('今そこに居るブランチは削除できない', () => {
    const readiness = toGitBranchDeleteReadiness({ name: 'main', current: true }, false)

    expect(readiness.enabled).toBe(false)
    // 待っても押せるようにはならないので、理由をその場に書く。
    expect(readiness.note).toContain('チェックアウト')
  })

  /*
    行の側（切り替え）とは判断が違う ── 同じブランチについて、
    片方は押せて片方は押せない。この対比そのものが 3-8-14 の決めごとになる。
  */
  it('同じ行でも、切り替えの側は押せる', () => {
    const branch = { name: 'main', current: true }

    expect(toGitBranchSwitchReadiness(branch, false).enabled).toBe(true)
    expect(toGitBranchDeleteReadiness(branch, false).enabled).toBe(false)
  })

  it('今そこに居ないブランチは削除できる', () => {
    const readiness = toGitBranchDeleteReadiness({ name: 'feature/x', current: false }, false)

    expect(readiness.enabled).toBe(true)
    expect(readiness.note).toContain('feature/x')
  })

  /*
    マージ済みかどうかは**ここでは見ない**（一覧に載っていない）── 押せる状態で
    出し、断るのは git になる。ここで薄くすると、消せるはずのブランチまで
    押せなくなる。
  */
  it('マージ済みかどうかで押せる / 押せないを変えない', () => {
    expect(toGitBranchDeleteReadiness({ name: 'unmerged', current: false }, false).enabled).toBe(
      true
    )
  })

  it('他の Git 操作が動いている間は押せない', () => {
    expect(toGitBranchDeleteReadiness({ name: 'feature/x', current: false }, true).enabled).toBe(
      false
    )
  })
})

/**
 * 削除の確認の文言（Session 3-8-14）。
 *
 * **盛らない**ことを固定する ── `-d` が通るのはマージ済みのときだけなので、
 * 「コミットが失われます」と書くと嘘になり、本当に失われる場面（破棄）の
 * 警告まで軽く読まれることになる。
 */
describe('describeGitBranchDeleteWarning', () => {
  const warning = describeGitBranchDeleteWarning({ name: 'feature/x', current: false })

  it('どのブランチのことかを名指しする', () => {
    expect(warning.message).toContain('feature/x')
  })

  it('コミットが失われるとは言わない', () => {
    expect(warning.message).not.toContain('コミットが失われ')
    expect(warning.note).not.toContain('コミットが失われ')
  })

  it('通らないことがあると断ってある', () => {
    // 「押せば必ず消える」と読ませない ── 未マージなら git が中止する。
    expect(warning.note).toContain('中止')
  })

  it('押すボタンの言葉がある', () => {
    expect(warning.confirmLabel.length).toBeGreaterThan(0)
  })
})

/**
 * 改名できるか（Session 3-8-14）。
 *
 * 名前の形の規則は作成の欄とまったく同じ関数（shared）を通る ── ここで
 * 固定したいのは**それ以外の2つ**になる。
 *
 *   - 開いた直後（今の名前のまま）は押せない
 *   - 大文字小文字だけの違いは、画面の都合では止めない
 */
describe('toGitBranchRenameReadiness', () => {
  const branch = { name: 'feature/x', current: false }

  it('開いた直後（今の名前のまま）は押せない', () => {
    const readiness = toGitBranchRenameReadiness(branch, 'feature/x', false)

    expect(readiness.enabled).toBe(false)
    // 「間違い」ではなく「まだ打っていない」として言う。
    expect(readiness.note).toContain('新しい名前')
  })

  it('空のときは、名前の規則を説教しない', () => {
    const readiness = toGitBranchRenameReadiness(branch, '', false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toContain('feature/x')
  })

  it('形が通らない名前は理由を出す', () => {
    const readiness = toGitBranchRenameReadiness(branch, 'bad name', false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toBe(describeGitBranchNameProblem('invalid-characters'))
  })

  it('長すぎる名前も止める（作成の欄と同じ規則）', () => {
    const tooLong = 'a'.repeat(GIT_BRANCH_NAME_MAX_LENGTH + 1)

    expect(toGitBranchRenameReadiness(branch, tooLong, false).enabled).toBe(false)
  })

  /*
    `feature/x` → `Feature/X` は Git 側で通せる（Main が相手は自分自身だと
    確かめたうえで通す）── ここで弾くと、通せる改名が画面の都合だけで
    押せなくなる。
  */
  it('大文字小文字だけの違いは押せる', () => {
    const readiness = toGitBranchRenameReadiness(branch, 'Feature/X', false)

    expect(readiness.enabled).toBe(true)
  })

  it('通る名前は、何が起きるかを両方の名前で言う', () => {
    const readiness = toGitBranchRenameReadiness(branch, 'feature/y', false)

    expect(readiness.enabled).toBe(true)
    expect(readiness.note).toContain('feature/x')
    expect(readiness.note).toContain('feature/y')
  })

  it('前後の空白は落としてから判断する（作成の欄と同じ）', () => {
    expect(toGitBranchRenameReadiness(branch, '  feature/y  ', false).enabled).toBe(true)
    // 落とした結果が今の名前と同じなら、押せない側になる。
    expect(toGitBranchRenameReadiness(branch, '  feature/x  ', false).enabled).toBe(false)
  })

  it('他の Git 操作が動いている間は押せない', () => {
    expect(toGitBranchRenameReadiness(branch, 'feature/y', true).enabled).toBe(false)
  })
})

/**
 * 名前の問題ごとの文言。
 *
 * gitChanges.test.ts が分類ごとの文言を見るのと同じ形で、**分類を増やしたときに
 * 文言を足し忘れない**ことを見る。
 */
describe('describeGitBranchNameProblem', () => {
  const problems: readonly GitBranchNameProblem[] = [
    'empty',
    'too-long',
    'invalid-characters',
    'invalid-shape',
    'reserved'
  ]

  it.each(problems)('%s に文言がある', (problem) => {
    expect(describeGitBranchNameProblem(problem).length).toBeGreaterThan(0)
  })

  it('同じ文言が2つの理由に付いていない', () => {
    const messages = problems.map(describeGitBranchNameProblem)

    expect(new Set(messages).size).toBe(problems.length)
  })
})
