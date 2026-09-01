import { describe, expect, it } from 'vitest'
import { isGitOperationBlockedWhileInProgress } from './inProgress'
import type { GitGuardedOperation, GitInProgressOperation } from './inProgress'

/**
 * 途中の Git 操作のあいだ何を通さないかの表（Session 3-8-22A）。
 *
 * ## ここで固定したいのは「表そのもの」
 *
 * この表は **Main と Renderer の両方が読む**（shared/git/inProgress.ts）──
 * 片方だけが直されると「画面では押せないのに IPC は通る」が生まれるので、
 * 答えを1箇所に固定しておく意味が他の純粋関数より強い。
 *
 * とくに固定したいのは、**マージだけが例外**であることになる ──
 * マージにはアプリの中に出口があり（解決 → Commit）、rebase /
 * cherry-pick / revert には無い。
 */

/** 表が答えを持つ操作すべて（型が閉じているので、増えたら足し忘れが分かる）。 */
const ALL_OPERATIONS: readonly GitGuardedOperation[] = [
  'stage',
  'unstage',
  'resolve-conflict',
  'discard',
  'commit',
  'commit-and-push',
  'push',
  'pull',
  'fetch',
  'switch-branch',
  'create-branch',
  'create-tracking-branch',
  'delete-branch',
  'rename-branch',
  'merge-branch',
  'stash-push',
  'stash-pop',
  'stash-drop'
]

/** アプリが始められず、終わらせる口も持たない3つ。 */
const FOREIGN: readonly GitInProgressOperation[] = ['rebase', 'cherry-pick', 'revert']

describe('isGitOperationBlockedWhileInProgress', () => {
  it('途中の操作が無ければ、1つも止めない', () => {
    for (const operation of ALL_OPERATIONS) {
      expect(isGitOperationBlockedWhileInProgress(null, operation), operation).toBe(false)
    }
  })

  /*
    マージの途中で通すもの ── **マージを終わらせるために要る手**にあたる。
    ここを止めると、利用者はマージから出られなくなる（中止しか道が無くなる）。
  */
  it.each([
    'stage',
    'unstage',
    'resolve-conflict',
    'discard',
    'commit',
    'commit-and-push'
  ] as const)('マージの途中でも %s は通す（出口に要る手）', (operation) => {
    expect(isGitOperationBlockedWhileInProgress('merge', operation)).toBe(false)
  })

  /*
    マージの途中でも通す、もう1組 ── どれも index にも作業ツリーにも
    HEAD にも触らない。
  */
  it.each(['push', 'fetch', 'delete-branch', 'rename-branch', 'stash-drop'] as const)(
    'マージの途中でも %s は通す（MERGE_HEAD に触らない）',
    (operation) => {
      expect(isGitOperationBlockedWhileInProgress('merge', operation)).toBe(false)
    }
  )

  /*
    マージの途中で止めるもの ── `MERGE_HEAD` を消しうるか、消えたことに
    気づけなくする操作にあたる。**git はこのうちいくつかを通してしまう**
    （解決し終えた状態では index がきれいなため。
    main/git/gitInProgressRepository.test.ts が実物で確かめている）。
  */
  it.each([
    'switch-branch',
    'create-branch',
    'create-tracking-branch',
    'merge-branch',
    'stash-push',
    'stash-pop',
    'pull'
  ] as const)('マージの途中では %s を止める', (operation) => {
    expect(isGitOperationBlockedWhileInProgress('merge', operation)).toBe(true)
  })

  /*
    3-8-22A のいちばん効く決めごと ── アプリはこの3つを始められず、
    **終わらせる口も持たない。** 出口が無いのに Stage や Commit だけを
    通すと、終わらない道の途中まで案内することになる。
  */
  it.each(FOREIGN)('%s の途中では、書き込みを1つも通さない', (inProgress) => {
    for (const operation of ALL_OPERATIONS) {
      expect(isGitOperationBlockedWhileInProgress(inProgress, operation), operation).toBe(true)
    }
  })

  /*
    マージと他の3つで**答えが違う**ことそのものを固定する ── 4つを
    ひとまとめに扱う形へ戻ると、この差が黙って消える。
  */
  it('マージだけが、通す操作を持つ', () => {
    const allowedWhileMerging = ALL_OPERATIONS.filter(
      (operation) => !isGitOperationBlockedWhileInProgress('merge', operation)
    )

    expect(allowedWhileMerging.length).toBeGreaterThan(0)

    for (const inProgress of FOREIGN) {
      const allowed = ALL_OPERATIONS.filter(
        (operation) => !isGitOperationBlockedWhileInProgress(inProgress, operation)
      )

      expect(allowed, inProgress).toEqual([])
    }
  })
})
