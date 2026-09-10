import { describe, expect, it, vi } from 'vitest'
import { createDebugBreakpointRecord } from './breakpointModel'
import {
  applyDebugBreakpointSyncOutcomes,
  sendDebugBreakpoints,
  type DebugBreakpointSyncTarget
} from './breakpointSync'
import type { DapRequestOutcome } from './dapConnection'
import type { DapSetBreakpointsArguments } from './dapBreakpoints'
import type { DebugSessionBreakpointChannel } from './debugSessionManager'

const SOURCE = { path: 'D:\\proj\\src\\app.js', name: 'app.js' }

function createChannel(outcome: DapRequestOutcome): {
  readonly channel: DebugSessionBreakpointChannel
  readonly sent: readonly DapSetBreakpointsArguments[]
} {
  const sent: DapSetBreakpointsArguments[] = []

  return {
    sent,
    channel: {
      sessionId: 'debug-session-1',
      generation: 1,
      setBreakpoints: vi.fn((args: DapSetBreakpointsArguments) => {
        sent.push(args)

        return Promise.resolve(outcome)
      })
    }
  }
}

function target(lines: readonly number[]): DebugBreakpointSyncTarget {
  return { relativePath: 'src/app.js', source: SOURCE, lines }
}

describe('送信', () => {
  it('送る形は setBreakpoints の引数そのもの', async () => {
    const { channel, sent } = createChannel({ status: 'success', body: { breakpoints: [] } })

    await sendDebugBreakpoints(channel, target([3, 8]))

    expect(sent).toEqual([
      {
        source: SOURCE,
        breakpoints: [{ line: 3 }, { line: 8 }],
        lines: [3, 8],
        sourceModified: false
      }
    ])
  })

  it('verified の答えを返す', async () => {
    const { channel } = createChannel({
      status: 'success',
      body: { breakpoints: [{ verified: true }, { verified: false, message: 'no code' }] }
    })

    const outcome = await sendDebugBreakpoints(channel, target([3, 8]))

    expect(outcome.failure).toBeNull()
    expect(outcome.verifications).toEqual([
      { verified: true, line: null, message: null },
      { verified: false, line: null, message: 'no code' }
    ])
  })

  it('空の一覧を送っても失敗にしない', async () => {
    const { channel } = createChannel({ status: 'success', body: { breakpoints: [] } })

    const outcome = await sendDebugBreakpoints(channel, target([]))

    expect(outcome.failure).toBeNull()
    expect(outcome.verifications).toEqual([])
  })

  /* 間違った印を出すより、印を出さない方がよい（breakpointSync.ts の冒頭）。 */
  it('adapter が断ったら「答えが無かった」に畳む', async () => {
    const { channel } = createChannel({ status: 'failure', message: 'boom', body: undefined })

    const outcome = await sendDebugBreakpoints(channel, target([3]))

    expect(outcome.verifications).toBeNull()
    expect(outcome.failure).toBe('boom')
  })

  it('経路が閉じていたら「答えが無かった」に畳む', async () => {
    const { channel } = createChannel({ status: 'closed', reason: 'the adapter exited.' })

    const outcome = await sendDebugBreakpoints(channel, target([3]))

    expect(outcome.verifications).toBeNull()
    expect(outcome.failure).toBe('the adapter exited.')
  })

  it('壊れた応答も「答えが無かった」に畳む', async () => {
    const { channel } = createChannel({ status: 'success', body: { nope: true } })

    const outcome = await sendDebugBreakpoints(channel, target([3]))

    expect(outcome.verifications).toBeNull()
    expect(outcome.failure).not.toBeNull()
  })
})

describe('控えへの反映', () => {
  it('複数ファイルの結末をまとめて当てる', () => {
    const records = [
      createDebugBreakpointRecord('src/a.ts', 1),
      createDebugBreakpointRecord('src/b.ts', 2)
    ]

    const applied = applyDebugBreakpointSyncOutcomes(records, [
      {
        relativePath: 'src/a.ts',
        lines: [1],
        verifications: [{ verified: true, line: null, message: null }],
        failure: null
      },
      {
        relativePath: 'src/b.ts',
        lines: [2],
        verifications: [{ verified: false, line: null, message: null }],
        failure: null
      }
    ])

    expect(applied.map((record) => record.verified)).toEqual([true, false])
  })
})
