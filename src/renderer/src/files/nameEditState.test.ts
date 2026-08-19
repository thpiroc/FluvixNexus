import { describe, expect, it } from 'vitest'
import type { FileNameProblem } from '@shared/files'
import {
  acceptsCancel,
  acceptsCommit,
  beginCommit,
  cancelEdit,
  endCommit,
  INITIAL_NAME_EDIT_STATUS,
  type NameEditStatus
} from './nameEditState'

/**
 * ツリーの中の入力欄が受け付ける操作。
 *
 * Session 3-5.1 で直した不具合はここに集まっている ── **確定を依頼して失敗した後、
 * 入力欄が何も受け付けなくなる**（Enter も Escape も blur も、二重送信の抑止に飲まれる）。
 * リネームの同名衝突は「名前を変えれば通る」失敗なのに、打ち直すことも取り消すことも
 * できない行がツリーに残っていた。
 *
 * 実際の DOM 操作（キー入力・focus）は実機で確認する（docs/DEVELOPMENT.md §4）。
 * ここで固定するのは判断そのもので、FileNameInput.tsx はこれに従うだけ。
 */

/** 名前に問題が無い状態（Enter を止める理由が無い）。 */
const NO_PROBLEM = null
/** 打っている途中の、まだ使えない名前。 */
const SOME_PROBLEM: FileNameProblem = 'reserved'

/** 「Enter も Escape も受け付けない」＝ 固まっている。 */
function isFrozen(status: NameEditStatus): boolean {
  return !acceptsCommit(status, NO_PROBLEM) && !acceptsCancel(status)
}

describe('打っている最中（editing）', () => {
  it('最初は editing から始まる', () => {
    expect(INITIAL_NAME_EDIT_STATUS).toBe('editing')
  })

  it('Enter も Escape も受け付ける', () => {
    expect(acceptsCommit('editing', NO_PROBLEM)).toBe(true)
    expect(acceptsCancel('editing')).toBe(true)
  })

  it('名前に問題があるあいだは Enter を受け付けない', () => {
    expect(acceptsCommit('editing', SOME_PROBLEM)).toBe(false)
  })

  /* 打ち直せない名前のまま閉じられないのは、固まっているのと変わらない。 */
  it('名前に問題があっても Escape は受け付ける', () => {
    expect(acceptsCancel('editing')).toBe(true)
  })
})

describe('応答を待っている最中（submitting）', () => {
  const submitting = beginCommit()

  it('Enter を押した直後は submitting になる', () => {
    expect(submitting).toBe('submitting')
  })

  /* 抑えたいのはここだけ ── 応答を待っている区間の二重送信。 */
  it('二重送信を受け付けない', () => {
    expect(acceptsCommit(submitting, NO_PROBLEM)).toBe(false)
  })

  it('取り消しも受け付けない（結果が確定していないため）', () => {
    expect(acceptsCancel(submitting)).toBe(false)
  })
})

describe('確定に失敗した後', () => {
  /*
    不具合の本体。同名衝突・権限・直前に消された ── どれも入力欄を開いたまま
    打ち直してもらう失敗で、editing へ戻らなければ行が固まる。
  */
  it('editing へ戻る', () => {
    expect(endCommit(false)).toBe('editing')
  })

  it('固まらない（Enter も Escape も再び受け付ける）', () => {
    const afterFailure = endCommit(false)

    expect(isFrozen(afterFailure)).toBe(false)
    expect(acceptsCommit(afterFailure, NO_PROBLEM)).toBe(true)
    expect(acceptsCancel(afterFailure)).toBe(true)
  })

  /* 同名衝突 → 名前を直して Enter → 成功、という流れがそのまま通ること。 */
  it('名前を直して再試行できる', () => {
    let status: NameEditStatus = INITIAL_NAME_EDIT_STATUS

    // 1回目の Enter。
    expect(acceptsCommit(status, NO_PROBLEM)).toBe(true)
    status = beginCommit()

    // 同名衝突で失敗して返ってくる。
    status = endCommit(false)

    // 2回目の Enter が通る。
    expect(acceptsCommit(status, NO_PROBLEM)).toBe(true)
    status = beginCommit()
    status = endCommit(true)

    expect(status).toBe('settled')
  })

  it('失敗した後に Escape で取り消せる', () => {
    let status: NameEditStatus = beginCommit()

    status = endCommit(false)

    expect(acceptsCancel(status)).toBe(true)
    expect(cancelEdit()).toBe('settled')
  })

  /* 何度失敗しても戻り続ける（回数を数えて諦める、のような形にしない）。 */
  it('繰り返し失敗しても毎回 editing へ戻る', () => {
    let status: NameEditStatus = INITIAL_NAME_EDIT_STATUS

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(acceptsCommit(status, NO_PROBLEM)).toBe(true)
      status = beginCommit()
      status = endCommit(false)
      expect(status).toBe('editing')
    }
  })
})

describe('決着した後（settled）', () => {
  it('確定できたら settled', () => {
    expect(endCommit(true)).toBe('settled')
  })

  it('取り消したら settled', () => {
    expect(cancelEdit()).toBe('settled')
  })

  /*
    settled で受け付けなくなるのは正しい ── 入力欄はこの後消えるため。
    Enter で確定すると入力欄が消え、その過程で blur が起きるので、
    ここで止めないと「確定した直後に取り消しも呼ぶ」ことになる。
  */
  it('確定した後の blur を取り消しとして扱わない', () => {
    expect(acceptsCancel(endCommit(true))).toBe(false)
  })

  it('もう何も受け付けない', () => {
    expect(isFrozen('settled')).toBe(true)
  })
})
