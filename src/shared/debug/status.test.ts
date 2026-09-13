import { describe, expect, it } from 'vitest'
import type { DebugSessionState } from './session'
import { DEBUG_SESSION_STATUSES, isDebugSessionStatus, resolveDebugSessionStatus } from './status'

const SESSION_STATES: readonly DebugSessionState[] = [
  'idle',
  'starting',
  'running',
  'stopped',
  'terminating'
]

describe('resolveDebugSessionStatus', () => {
  it('動いているセッションの状態は、adapter の有無に関わらずそのまま出す', () => {
    for (const state of ['starting', 'running', 'stopped', 'terminating'] as const) {
      expect(resolveDebugSessionStatus(state, true)).toBe(state)
      expect(resolveDebugSessionStatus(state, false)).toBe(state)
    }
  })

  it('セッションが無いときだけ、adapter の有無で idle / unavailable を分ける', () => {
    expect(resolveDebugSessionStatus('idle', true)).toBe('idle')
    expect(resolveDebugSessionStatus('idle', false)).toBe('unavailable')
  })

  it('どの組み合わせも閉じた集合の中に落ちる', () => {
    for (const state of SESSION_STATES) {
      for (const available of [true, false]) {
        expect(DEBUG_SESSION_STATUSES).toContain(resolveDebugSessionStatus(state, available))
      }
    }
  })
})

describe('DEBUG_SESSION_STATUSES', () => {
  it('セッションの5状態と unavailable の6つだけで、重複しない', () => {
    expect([...DEBUG_SESSION_STATUSES].sort()).toEqual([...SESSION_STATES, 'unavailable'].sort())
    expect(new Set(DEBUG_SESSION_STATUSES).size).toBe(DEBUG_SESSION_STATUSES.length)
  })

  /** 起動失敗を「状態」にしていない（shared/debug/status.ts の冒頭）。 */
  it('failed / error / paused のような表示用の別名を持たない', () => {
    for (const absent of ['failed', 'error', 'paused', 'disabled']) {
      expect(isDebugSessionStatus(absent)).toBe(false)
    }
  })
})

describe('isDebugSessionStatus', () => {
  it('閉じた集合の語だけを通す', () => {
    for (const status of DEBUG_SESSION_STATUSES) {
      expect(isDebugSessionStatus(status)).toBe(true)
    }

    for (const value of ['', 'Running', 'launch', 'C:\\adapter.exe', 1, null, undefined, {}]) {
      expect(isDebugSessionStatus(value)).toBe(false)
    }
  })
})
