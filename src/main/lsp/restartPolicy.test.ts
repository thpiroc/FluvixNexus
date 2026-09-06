import { describe, expect, it } from 'vitest'
import {
  decideLanguageServerRestart,
  LANGUAGE_SERVER_MAX_RESTARTS,
  LANGUAGE_SERVER_RESTART_DELAYS_MS,
  LANGUAGE_SERVER_RESTART_WINDOW_MS
} from './restartPolicy'

/**
 * 落ちたサーバを立て直すかどうか（restartPolicy.ts）。
 *
 * 確かめたいのは両側の失敗になる。**立て直さない**と補完が黙って消え、
 * **際限なく立て直す**と1秒ごとにプロセスを起動し続ける。
 */

const NOW = 1_700_000_000_000

describe('decideLanguageServerRestart', () => {
  it('初めて落ちたら立て直す', () => {
    const decision = decideLanguageServerRestart([], NOW)

    expect(decision).toMatchObject({ status: 'restart', attempt: 1 })
  })

  it('1回目の間は、利用者が待てる長さ', () => {
    const decision = decideLanguageServerRestart([], NOW)

    expect(decision.status === 'restart' && decision.delayMs).toBe(
      LANGUAGE_SERVER_RESTART_DELAYS_MS[0]
    )
  })

  it('繰り返すほど間を伸ばす', () => {
    const delays: number[] = []
    let history: readonly number[] = []

    for (let attempt = 0; attempt < LANGUAGE_SERVER_MAX_RESTARTS; attempt += 1) {
      const decision = decideLanguageServerRestart(history, NOW + attempt * 1_000)

      if (decision.status !== 'restart') {
        throw new Error('the policy gave up too early.')
      }

      delays.push(decision.delayMs)
      history = decision.history
    }

    expect(delays).toEqual([...LANGUAGE_SERVER_RESTART_DELAYS_MS])
    expect([...delays].sort((a, b) => a - b)).toEqual(delays)
  })

  /*
    起動した直後に必ず落ちる状態（サーバの版が壊れている・依存が足りない）では、
    立て直しは無限に続く。上限で止まらなければ、その PC の他の作業まで巻き込む。
  */
  it('窓の中で上限を超えたら諦める', () => {
    const history = Array.from({ length: LANGUAGE_SERVER_MAX_RESTARTS }, (_, index) => NOW + index)
    const decision = decideLanguageServerRestart(history, NOW + LANGUAGE_SERVER_MAX_RESTARTS)

    expect(decision.status).toBe('give-up')
  })

  it('上限に達するまでは諦めない', () => {
    const history = Array.from(
      { length: LANGUAGE_SERVER_MAX_RESTARTS - 1 },
      (_, index) => NOW + index
    )

    expect(decideLanguageServerRestart(history, NOW + 10).status).toBe('restart')
  })

  /*
    朝と夕方に1回ずつ落ちたサーバは「繰り返し落ちている」ではない。
    窓を持たないと、アプリを開きっぱなしにするほど諦めやすくなる。
  */
  it('窓から出た異常終了は数えない', () => {
    const old = Array.from(
      { length: LANGUAGE_SERVER_MAX_RESTARTS + 5 },
      (_, index) => NOW - LANGUAGE_SERVER_RESTART_WINDOW_MS - 1_000 - index
    )

    const decision = decideLanguageServerRestart(old, NOW)

    expect(decision).toMatchObject({ status: 'restart', attempt: 1 })
  })

  it('返した控えには、窓の中のものと今回だけが残る', () => {
    const inside = NOW - 1_000
    const outside = NOW - LANGUAGE_SERVER_RESTART_WINDOW_MS - 1

    const decision = decideLanguageServerRestart([outside, inside], NOW)

    expect(decision.history).toEqual([inside, NOW])
  })

  it('諦めた後も控えは返す（窓を抜ければまた立て直せる）', () => {
    const history = Array.from({ length: LANGUAGE_SERVER_MAX_RESTARTS }, (_, index) => NOW + index)
    const decision = decideLanguageServerRestart(history, NOW + 100)

    expect(decision.history).toHaveLength(LANGUAGE_SERVER_MAX_RESTARTS + 1)
  })
})
