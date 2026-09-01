import type { GitInProgressOperation } from '@shared/git'
import { describe, expect, it } from 'vitest'
import type { GitActionReadiness, GitCommitReadiness } from './gitChanges'
import {
  describeGitInProgressBlock,
  describeGitInProgressNotice,
  withGitInProgressBlock,
  withGitInProgressCommitBlock
} from './gitInProgress'

/**
 * 途中の Git 操作の見せ方（Session 3-8-22A）。
 *
 * ## ここで固定するのは「画面が何を言うか」だけ
 *
 * 何を通さないかは shared/git/inProgress.test.ts が固定している ──
 * こちらが見るのは、**その答えが利用者に伝わる形になっているか**になる。
 *
 * とくに固定したいのは2つ。
 *
 *   - 4つの状態で**次の一手が言い分けられている**（同じ文に潰れていない）
 *   - アプリに出口が無い3つで、**行き先が文の中に出ている**（端末とそのコマンド）
 */

const FOREIGN: readonly GitInProgressOperation[] = ['rebase', 'cherry-pick', 'revert']

describe('describeGitInProgressNotice', () => {
  it('途中の操作が無ければ帯を出さない', () => {
    expect(describeGitInProgressNotice(null)).toBeNull()
  })

  /*
    マージだけがアプリの中に出口を持つ ── 帯の中に中止の口が出るのは、
    この1つだけになる。
  */
  it('マージだけが中止の口を持ち、次の一手が Commit と中止の両方に触れる', () => {
    const notice = describeGitInProgressNotice('merge')

    expect(notice?.abortable).toBe(true)
    expect(notice?.description).toContain('Commit')
    expect(notice?.description).toContain('中止')
  })

  /*
    3-8-22A のいちばん効く決めごと ── アプリはこの3つを始められず、
    終わらせる口も持たない。**押しても何も終わらないボタンを置かない**ので、
    行き先（Terminal と、そこで打つコマンド）を文の側が出す。
  */
  it.each(FOREIGN)('%s は中止の口を持たず、Terminal でのコマンドを出す', (inProgress) => {
    const notice = describeGitInProgressNotice(inProgress)

    expect(notice?.abortable).toBe(false)
    expect(notice?.title).toContain(inProgress)
    expect(notice?.description).toContain('Terminal')
    expect(notice?.description).toContain(`git ${inProgress} --abort`)
    expect(notice?.description).toContain(`git ${inProgress} --continue`)
  })

  /*
    4つを1つの文に潰さない ── 利用者の次の一手が状態ごとに違うため
    （分類の粒度を「次の一手が変わるか」で決める、という 3-8-1 からの基準）。
  */
  it('4つの見出しがすべて違う', () => {
    const titles = (['merge', ...FOREIGN] as const).map(
      (inProgress) => describeGitInProgressNotice(inProgress)?.title
    )

    expect(new Set(titles).size).toBe(4)
  })
})

describe('describeGitInProgressBlock', () => {
  it('通る操作には理由を出さない', () => {
    expect(describeGitInProgressBlock(null, 'commit')).toBeNull()
    // マージの途中でも Commit は出口に要る手なので通る。
    expect(describeGitInProgressBlock('merge', 'commit')).toBeNull()
  })

  /*
    押せない理由に**次の一手まで入れる**（3-8-20 が
    `toGitBranchMergeReadiness` の中で書いていたことを引き継ぐ）── 理由しか
    無いと、利用者は「待てば押せるようになる」と読む。
  */
  it('止める操作では、理由と一緒に次の一手が出る', () => {
    const blocked = describeGitInProgressBlock('merge', 'switch-branch')

    expect(blocked).toContain('マージの途中')
    expect(blocked).toContain('中止')
  })

  it('帯と同じ言葉を使う（同じ状態が2通りに呼ばれない）', () => {
    const notice = describeGitInProgressNotice('rebase')
    const blocked = describeGitInProgressBlock('rebase', 'commit')

    expect(blocked).toContain(notice?.title as string)
    expect(blocked).toContain(notice?.description as string)
  })
})

describe('withGitInProgressBlock', () => {
  const ready: GitActionReadiness = { enabled: true, note: 'もとの理由' }

  it('禁止が無ければ、もとの readiness をそのまま返す', () => {
    expect(withGitInProgressBlock(ready, null)).toBe(ready)
  })

  /*
    押せない理由は**いちばん手前のもの**を出す ── 途中の操作は他のどの理由
    よりも前に在り、終わらせない限りどれも解消しない。
  */
  it('禁止があれば、押せなくして理由を差し替える', () => {
    const blocked = withGitInProgressBlock(ready, 'だめな理由')

    expect(blocked.enabled).toBe(false)
    expect(blocked.note).toBe('だめな理由')
  })

  it('もとが押せない場合でも、理由は途中の操作の側が勝つ', () => {
    const disabled: GitActionReadiness = { enabled: false, note: '別の理由' }

    expect(withGitInProgressBlock(disabled, 'だめな理由').note).toBe('だめな理由')
  })
})

describe('withGitInProgressCommitBlock', () => {
  const ready: GitCommitReadiness = { enabled: true, note: null, remaining: 12 }

  it('禁止が無ければ、もとの readiness をそのまま返す', () => {
    expect(withGitInProgressCommitBlock(ready, null)).toBe(ready)
  })

  /*
    文字数の残りは**消さない** ── 押せなくなっても書いた文章は欄に在り、
    上限が近いことは依然として本当になる。ここで消すと、マージ中だけ
    合図が出ないことになる。
  */
  it('押せなくしても、文字数の残りは持ったままにする', () => {
    const blocked = withGitInProgressCommitBlock(ready, 'だめな理由')

    expect(blocked.enabled).toBe(false)
    expect(blocked.note).toBe('だめな理由')
    expect(blocked.remaining).toBe(12)
  })
})
