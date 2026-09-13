import { describe, expect, it, vi } from 'vitest'
import type { DebugSessionState } from '@shared/debug'

/**
 * Debug の状態を Renderer へ配る層（Session 6-9）。
 *
 * 見るのは4つ。
 *
 *   - セッションの状態と adapter の有無を重ねた1語を出すこと
 *   - 同じ tick の変化を1本にまとめ、まとめた時点の状態を送ること
 *   - 同じ語を2度続けて送らないこと
 *   - **送る payload が1語だけ**であること（sessionId / generation / adapter の情報が載らない）
 *
 * 重ね方そのもの（動いていれば adapter の有無を見ない）は shared/debug/status.test.ts が持つ。
 */

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  BrowserWindow: { getAllWindows: () => [] }
}))

const { createDebugStatusReporter } = await import('./sessionStatus')

interface Harness {
  readonly reporter: ReturnType<typeof createDebugStatusReporter>
  readonly emitted: unknown[]
  readonly set: (state: DebugSessionState) => void
  readonly flush: () => void
  readonly setAvailable: (value: boolean) => void
  readonly listenerCount: () => number
}

function harness(initial: DebugSessionState = 'idle', available = false): Harness {
  let state = initial
  let adapterAvailable = available
  const listeners = new Set<(state: DebugSessionState) => void>()
  const queue: (() => void)[] = []
  const emitted: unknown[] = []

  const reporter = createDebugStatusReporter({
    getState: () => state,
    onStateChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    isAdapterAvailable: () => adapterAvailable,
    /* 何を送ったかを payload ごと控える（形を見るため、emit の引数をそのまま積む）。 */
    emit: (...args: unknown[]) => {
      emitted.push(args)
    },
    schedule: (task) => {
      queue.push(task)
    }
  })

  return {
    reporter,
    emitted,
    set: (next) => {
      state = next
      for (const listener of listeners) {
        listener(next)
      }
    },
    flush: () => {
      for (const task of queue.splice(0)) {
        task()
      }
    },
    setAvailable: (value) => {
      adapterAvailable = value
    },
    listenerCount: () => listeners.size
  }
}

describe('createDebugStatusReporter', () => {
  it('今の状態を、セッションと adapter の有無を重ねた1語で返す', () => {
    const h = harness('idle', false)

    expect(h.reporter.current()).toBe('unavailable')

    h.setAvailable(true)
    expect(h.reporter.current()).toBe('idle')
  })

  it('動いているセッションは adapter が無くても、その状態をそのまま返す', () => {
    const h = harness('running', false)

    expect(h.reporter.current()).toBe('running')
  })

  it('購読は start で1本だけ張り、起動時の状態は配らない', () => {
    const h = harness()

    expect(h.listenerCount()).toBe(0)

    h.reporter.start()
    h.flush()

    expect(h.listenerCount()).toBe(1)
    expect(h.emitted).toEqual([])
  })

  it('状態が変わるたびに、payload は1語だけで配る', () => {
    const h = harness()
    h.reporter.start()

    h.set('starting')
    h.flush()
    h.set('running')
    h.flush()
    h.set('stopped')
    h.flush()
    h.set('terminating')
    h.flush()
    h.set('idle')
    h.flush()

    expect(h.emitted).toEqual([
      ['starting'],
      ['running'],
      ['stopped'],
      ['terminating'],
      ['unavailable']
    ])
  })

  it('同じ tick の変化は1本にまとめ、まとめた時点の状態を送る', () => {
    const h = harness('stopped', true)
    h.reporter.start()

    /* Step Over: continued → stopped が同じ tick に届く。 */
    h.set('running')
    h.set('stopped')
    h.set('running')
    h.flush()

    expect(h.emitted).toEqual([['running']])
  })

  it('まとめた結果が前に配った語と同じなら、送らない', () => {
    const h = harness('running', true)
    h.reporter.start()

    h.set('stopped')
    h.set('running')
    h.flush()

    expect(h.emitted).toEqual([])
  })

  it('Stop の流れ（terminating → idle が同じ tick）でも、最後は idle に収束する', () => {
    const h = harness('running', true)
    h.reporter.start()

    h.set('terminating')
    h.set('idle')
    h.flush()

    expect(h.emitted).toEqual([['idle']])
  })
})

describe('sessionStatus module', () => {
  it('公開するのは読む関数と、配り始める関数だけ（起動 / 停止の口を持たない）', async () => {
    const module = await import('./sessionStatus')

    expect(Object.keys(module).sort()).toEqual(
      [
        'createDebugStatusReporter',
        'getDebugSessionStatus',
        'startDebugSessionStatusReporting'
      ].sort()
    )
  })

  /** この版では catalog のどの行も統合されていないので、既定の状態は unavailable。 */
  it('既定の状態は、catalog の事実どおり unavailable から始まる', async () => {
    const { getDebugSessionStatus } = await import('./sessionStatus')

    expect(getDebugSessionStatus()).toBe('unavailable')
  })
})
