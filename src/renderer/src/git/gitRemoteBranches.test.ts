import type { GitRemoteBranch } from '@shared/git'
import { describe, expect, it } from 'vitest'
import {
  describeGitRemoteBranchFreshness,
  describeGitRemoteBranchList,
  describeGitRemoteBranchTruncation,
  toGitRemoteBranchSelectReadiness,
  toGitTrackingBranchCreateReadiness,
  type GitRemoteBranchListState
} from './gitRemoteBranches'

/**
 * remote の枝から始める面の中身（gitRemoteBranches.ts）。
 *
 * gitBranches.test.ts が「押せる条件と、押せない理由が1箇所で決まっているか」を
 * 見るのと同じ形で、こちらは Session 3-8-19 に固有の3つを固定する。
 *
 *   - **一覧が空のときの言い分け**（remote が無い / まだ取得していない）── この2つは
 *     git の出力からは見分けられず、`hasRemote` だけが答えを持つ
 *   - **いつの写しかを黙らない**（この面は fetch しない）
 *   - 押しても切り替わらないこと・打った名前の問題が gitBranches.ts と
 *     **同じ文言**で出ること
 */

/** 一覧の姿を組み立てる（既定は「取れている」）。 */
function listOf(overrides: Partial<GitRemoteBranchListState> = {}): GitRemoteBranchListState {
  return {
    status: 'ready',
    branches: [
      { name: 'origin/main', branch: 'main' },
      { name: 'origin/feature/x', branch: 'feature/x' }
    ],
    truncated: false,
    hasRemote: true,
    ...overrides
  }
}

const originFeature: GitRemoteBranch = { name: 'origin/feature/x', branch: 'feature/x' }

describe('describeGitRemoteBranchList', () => {
  it('行が出せるなら null（行と一言を同時に出さない）', () => {
    expect(describeGitRemoteBranchList(listOf())).toBeNull()
  })

  it('開いた直後は「取得しています」から始まる', () => {
    // 面を開くたびに取り直すので、必ずこの状態を通る。
    expect(describeGitRemoteBranchList(listOf({ status: 'loading', branches: [] }))).toContain(
      '取得しています'
    )
  })

  it('取得できなければ、そう言う', () => {
    expect(describeGitRemoteBranchList(listOf({ status: 'failed', branches: [] }))).toContain(
      '取得できませんでした'
    )
  })

  it('Git 操作を行えなくなったことは、別の文で言う', () => {
    expect(describeGitRemoteBranchList(listOf({ status: 'not-ready', branches: [] }))).toContain(
      'Git 操作を行えなくなりました'
    )
  })

  /*
    ここがこのファイルの要点にあたる。どちらも「まだ手元に remote の枝が無い」
    だが、次の一手が違う ── 片方はこのパネルの上のバー、もう片方は Terminal。
    同じ文にまとめると、押す先を先に判断させることになる。
  */
  it('remote が1つも無ければ、「リモート」から追加するよう案内する', () => {
    const notice = describeGitRemoteBranchList(listOf({ branches: [], hasRemote: false }))

    expect(notice).toContain('リモート')
    expect(notice).not.toContain('fetch')
  })

  it('remote はあるがまだ取得していなければ、Pull / fetch を案内する', () => {
    const notice = describeGitRemoteBranchList(listOf({ branches: [], hasRemote: true }))

    expect(notice).toContain('Pull')
    expect(notice).toContain('fetch')
  })
})

describe('describeGitRemoteBranchTruncation', () => {
  it('切れていなければ null', () => {
    expect(describeGitRemoteBranchTruncation(listOf())).toBeNull()
  })

  it('切れていれば、何件だけ出ているかを言う（黙って切らない）', () => {
    const notice = describeGitRemoteBranchTruncation(listOf({ truncated: true }))

    expect(notice).toContain('2')
  })

  it('取得できていない間は言わない', () => {
    expect(
      describeGitRemoteBranchTruncation(listOf({ status: 'loading', truncated: true }))
    ).toBeNull()
  })
})

describe('describeGitRemoteBranchFreshness', () => {
  /*
    この面は fetch しない（Session 3-8-19 の範囲外）。黙っていると、開いた人は
    **今の remote の状態**として読む ── 消された枝が残って見え、増えた枝は
    出てこない。どちらも「アプリが壊れている」と読まれる。
  */
  it('行があるときは、いつの写しかを言う', () => {
    const notice = describeGitRemoteBranchFreshness(listOf())

    expect(notice).toContain('最後に取得した時点')
  })

  it('1件も無いときは言わない（空の案内と重ねない）', () => {
    // 空のときは describeGitRemoteBranchList が既に Pull / fetch と言っている。
    expect(describeGitRemoteBranchFreshness(listOf({ branches: [] }))).toBeNull()
  })

  it('取得できていない間は言わない', () => {
    expect(describeGitRemoteBranchFreshness(listOf({ status: 'loading' }))).toBeNull()
  })
})

describe('toGitRemoteBranchSelectReadiness', () => {
  it('押すと「作る」ことになると言う（切り替えるとは言わない）', () => {
    const readiness = toGitRemoteBranchSelectReadiness(originFeature, false)

    expect(readiness.enabled).toBe(true)
    expect(readiness.note).toContain('origin/feature/x')
    expect(readiness.note).toContain('作ります')
  })

  it('他の Git 操作が動いている間は押せない', () => {
    // 開いた先の「作成」がすぐ押せる場所なので、開ける段階で止める。
    expect(toGitRemoteBranchSelectReadiness(originFeature, true).enabled).toBe(false)
  })
})

describe('toGitTrackingBranchCreateReadiness', () => {
  it('既定の名前のまま作れる', () => {
    const readiness = toGitTrackingBranchCreateReadiness(originFeature, 'feature/x', false)

    expect(readiness.enabled).toBe(true)
    expect(readiness.note).toContain('origin/feature/x')
    expect(readiness.note).toContain('feature/x')
  })

  it('打ち替えた名前がそのまま文に出る', () => {
    const readiness = toGitTrackingBranchCreateReadiness(originFeature, ' my-work ', false)

    // 前後の空白は落として見る（`prepareGitBranchName`）。
    expect(readiness.enabled).toBe(true)
    expect(readiness.note).toContain('my-work')
  })

  /*
    3-8-6 / 3-8-13 の作成欄は空を黙らせていた（打つ前から赤く出るのを避けるため）が、
    ここは**既定値が最初から入っている** ── 空になるのは利用者が自分で消したとき
    だけで、そのとき何も言わないと押せない理由がどこにも出ない。
  */
  it('空にしたら、理由を言って押せなくする', () => {
    const readiness = toGitTrackingBranchCreateReadiness(originFeature, '', false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toContain('ブランチ名を入力してください')
  })

  it('使えない名前は、gitBranches.ts と同じ文言で断る', () => {
    // 同じ規則に2つの言い方を持たせない（文言は describeGitBranchNameProblem が持つ）。
    const readiness = toGitTrackingBranchCreateReadiness(originFeature, 'a b', false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toContain('空白')
  })

  it('他の Git 操作が動いている間は押せない', () => {
    expect(toGitTrackingBranchCreateReadiness(originFeature, 'feature/x', true).enabled).toBe(false)
  })

  /*
    同じ面の上半分にローカルの一覧が出ているが、突き合わせない ── 一覧は
    切れていることがあり、大文字小文字だけが違う名前は git にしか分からない。
    押した結果として Main が（git を動かす前に）`branch-exists` を返す。
  */
  it('既にありそうな名前でも、ここでは止めない', () => {
    expect(toGitTrackingBranchCreateReadiness(originFeature, 'main', false).enabled).toBe(true)
  })
})
