import { describe, expect, it } from 'vitest'
import {
  GIT_CHANGE_COALESCE_MS,
  GIT_CHANGE_MAX_COALESCE_MS,
  GIT_CHANGE_MIN_INTERVAL_MS,
  nextGitChangeDelayMs
} from './gitChangeSchedule'

/**
 * `.git` の変化を「いつ配るか」（Session 3-8-8）。
 *
 * 3つの線が同時に効く場所で、どれか1つを外すと別々の形で表に出る。
 *
 *   静まるまで待たない → 1回の commit で `git status` が何度も走る
 *   上限が無い         → checkout の間じゅう配られず、パネルだけ前のまま
 *   間隔が無い         → fetch の最中に1秒ごとの連射になる
 */

describe('nextGitChangeDelayMs', () => {
  it('最初の変化は、静まるまでの時間だけ待つ', () => {
    const now = 10_000

    expect(nextGitChangeDelayMs({ now, firstPendingAt: now, lastEmittedAt: null })).toBe(
      GIT_CHANGE_COALESCE_MS
    )
  })

  it('変化が続いている間は、そのつど待ち直す（束ねる）', () => {
    const firstPendingAt = 10_000

    // 100ms 後に次の変化。そこからまた 250ms 待つ（＝合計 350ms 目に配る）。
    expect(
      nextGitChangeDelayMs({ now: firstPendingAt + 100, firstPendingAt, lastEmittedAt: null })
    ).toBe(GIT_CHANGE_COALESCE_MS)
  })

  /*
    checkout / rebase のように書き込みが続く操作でも、最初の変化から
    1 秒で必ず配る。ここが無いと、静まるまで配られない。
  */
  it('最初の変化から上限を超えたら、静まっていなくても配る', () => {
    const firstPendingAt = 10_000
    const now = firstPendingAt + GIT_CHANGE_MAX_COALESCE_MS - 50

    expect(nextGitChangeDelayMs({ now, firstPendingAt, lastEmittedAt: null })).toBe(50)
  })

  it('上限を過ぎていたら、待たずに配る（負の値を返さない）', () => {
    const firstPendingAt = 10_000
    const now = firstPendingAt + GIT_CHANGE_MAX_COALESCE_MS + 500

    expect(nextGitChangeDelayMs({ now, firstPendingAt, lastEmittedAt: null })).toBe(0)
  })

  /*
    配った直後に次の変化が来ても、間隔を空ける。上限（MAX_COALESCE）より
    こちらを優先する ── 遅れを取り戻しても、出てくるのは同じ連射でしかない。
  */
  it('前に配った直後なら、間隔が空くまで待つ', () => {
    const lastEmittedAt = 10_000
    const now = lastEmittedAt + 100

    expect(nextGitChangeDelayMs({ now, firstPendingAt: now, lastEmittedAt })).toBe(
      GIT_CHANGE_MIN_INTERVAL_MS - 100
    )
  })

  it('間隔の縛りは、上限に達していても効く', () => {
    const lastEmittedAt = 10_000
    const firstPendingAt = lastEmittedAt + 10
    const now = firstPendingAt + GIT_CHANGE_MAX_COALESCE_MS

    // 上限だけを見れば 0 だが、前回から 500ms 空くまでは配らない。
    expect(nextGitChangeDelayMs({ now, firstPendingAt, lastEmittedAt })).toBe(0)
    expect(
      nextGitChangeDelayMs({
        now: lastEmittedAt + 200,
        firstPendingAt: lastEmittedAt + 10,
        lastEmittedAt
      })
    ).toBe(GIT_CHANGE_MIN_INTERVAL_MS - 200)
  })

  it('間隔が既に空いていれば、静まるまでの時間がそのまま効く', () => {
    const lastEmittedAt = 10_000
    const now = lastEmittedAt + GIT_CHANGE_MIN_INTERVAL_MS + 1_000

    expect(nextGitChangeDelayMs({ now, firstPendingAt: now, lastEmittedAt })).toBe(
      GIT_CHANGE_COALESCE_MS
    )
  })

  it('どの組み合わせでも 0 以上を返す', () => {
    const cases = [
      { now: 0, firstPendingAt: 0, lastEmittedAt: null },
      { now: 5_000, firstPendingAt: 0, lastEmittedAt: 0 },
      { now: 5_000, firstPendingAt: 5_000, lastEmittedAt: 9_999 },
      { now: 1, firstPendingAt: 1_000_000, lastEmittedAt: 1_000_000 }
    ]

    for (const timing of cases) {
      expect(nextGitChangeDelayMs(timing)).toBeGreaterThanOrEqual(0)
    }
  })

  it('遅れの上限は、束ねる時間より長い（順番が逆だと上限が常に勝つ）', () => {
    expect(GIT_CHANGE_MAX_COALESCE_MS).toBeGreaterThan(GIT_CHANGE_COALESCE_MS)
  })
})
