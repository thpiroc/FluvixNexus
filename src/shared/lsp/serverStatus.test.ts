import { describe, expect, it } from 'vitest'
import { LANGUAGE_SERVER_IDS, type LanguageServerId } from './server'
import {
  LANGUAGE_SERVER_STATUS_IDS,
  resolveLanguageServerStatus,
  summarizeLanguageServerStatuses,
  type LanguageServerRuntimeStatus,
  type LanguageServerStatus,
  type LanguageServerStatusId
} from './serverStatus'

/**
 * 画面に出すサーバの状態（Session 5-4）。
 *
 * 確かめたいのは2つ。
 *
 *   - **設定で切ってあれば、プロセスの状態は見えない**（押した結果がそのまま出る）
 *   - **1本でも答えていれば Ready**（入れていない言語のせいで嘘を出さない）
 */

const RUNTIME_STATUSES: readonly LanguageServerRuntimeStatus[] = [
  'stopped',
  'starting',
  'ready',
  'unavailable',
  'failed'
]

function statuses(
  entries: Readonly<Partial<Record<LanguageServerId, LanguageServerStatusId>>>
): readonly LanguageServerStatus[] {
  return LANGUAGE_SERVER_IDS.map((serverId) => ({
    serverId,
    status: entries[serverId] ?? 'stopped'
  }))
}

describe('resolveLanguageServerStatus', () => {
  it('有効なら、プロセスの状態がそのまま出る', () => {
    for (const runtime of RUNTIME_STATUSES) {
      expect(resolveLanguageServerStatus(runtime, true)).toBe(runtime)
    }
  })

  /*
    切った直後はまだ終了処理の途中でありうる（`ready` のまま届く一瞬がある）。
    そこで一瞬でも `ready` を出すと、押した操作が効いていないように見える。
  */
  it('無効なら、プロセスが何であっても disabled', () => {
    for (const runtime of RUNTIME_STATUSES) {
      expect(resolveLanguageServerStatus(runtime, false)).toBe('disabled')
    }
  })

  it('6つの状態がすべて並びに載っている', () => {
    expect([...LANGUAGE_SERVER_STATUS_IDS].sort()).toEqual([...RUNTIME_STATUSES, 'disabled'].sort())
  })
})

describe('summarizeLanguageServerStatuses', () => {
  /*
    ここが要点。Python を入れていない PC で TypeScript を書いている人の画面には
    診断が普通に出ているので、「Not installed」と出すのは嘘になる。
  */
  it('1本でも答えていれば ready', () => {
    expect(summarizeLanguageServerStatuses(statuses({ typescript: 'ready' }))).toBe('ready')
    expect(
      summarizeLanguageServerStatuses(
        statuses({ typescript: 'ready', python: 'unavailable', csharp: 'failed' })
      )
    ).toBe('ready')
  })

  it('答えていなければ、立ち上がり中を先に出す', () => {
    expect(
      summarizeLanguageServerStatuses(statuses({ typescript: 'starting', python: 'failed' }))
    ).toBe('starting')
  })

  /* 動いていないときは理由が前に出る（落ちている方が先）。 */
  it('落ちているものがあれば failed、無ければ unavailable', () => {
    expect(
      summarizeLanguageServerStatuses(statuses({ typescript: 'failed', python: 'unavailable' }))
    ).toBe('failed')
    expect(summarizeLanguageServerStatuses(statuses({ python: 'unavailable' }))).toBe('unavailable')
  })

  it('何も起きていなければ stopped', () => {
    expect(summarizeLanguageServerStatuses(statuses({}))).toBe('stopped')
  })

  /* 状態がまだ1本も届いていない（画面を開いた直後）。 */
  it('1本も無ければ stopped', () => {
    expect(summarizeLanguageServerStatuses([])).toBe('stopped')
  })

  it('全部切ってあるときだけ disabled', () => {
    expect(
      summarizeLanguageServerStatuses(
        statuses({ typescript: 'disabled', python: 'disabled', csharp: 'disabled' })
      )
    ).toBe('disabled')
  })

  /*
    言語ごとに切った場合。**全体まで切れて見えない**ようにする ──
    TypeScript が動いているのに「Off」と出ると、切った覚えのない人が困る。
  */
  it('一部だけ切ってあるなら、他の状態が先に出る', () => {
    expect(
      summarizeLanguageServerStatuses(
        statuses({ typescript: 'ready', python: 'disabled', csharp: 'disabled' })
      )
    ).toBe('ready')
    expect(
      summarizeLanguageServerStatuses(
        statuses({ typescript: 'stopped', python: 'disabled', csharp: 'disabled' })
      )
    ).toBe('stopped')
  })
})
