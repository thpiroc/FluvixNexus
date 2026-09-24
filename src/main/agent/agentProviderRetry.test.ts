import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentTaskState } from '@shared/agent'
import type { AuditEvent } from '../security/audit/auditEvent'
import { formatAuditRecordLine } from '../security/audit/auditLogLine'
import { sanitizeAuditEvent } from '../security/audit/auditRecord'
import { createExternalSendGate } from '../security/externalSend/externalSendGate'
import {
  isSafeExternalPayload,
  type SafeExternalPayload
} from '../security/externalSend/safeExternalPayload'
import { agentProviderFailedEvent } from './agentAudit'
import { createAgentLoop, type AgentLoopDependencies } from './agentLoop'
import {
  AGENT_PROVIDER_FAILURES,
  AGENT_PROVIDER_MAX_ATTEMPTS,
  AGENT_PROVIDER_RETRY_POLICY,
  AgentProviderError,
  isRetryableProviderFailure,
  type AgentProvider,
  type AgentProviderReportedFailure
} from './agentProvider'
import type { AgentToolbox } from './agentTools'

/**
 * Provider の失敗と呼び直しの Policy（Security Core v1 の STEP10-3）。
 *
 * External Send Gate は**本物**を通し、時計は偽物（setTimeout / clearTimeout だけ）で進める。
 * 待ち時間・実ネットワークは使わない。
 */

const ID = 'fn-test-provider'
const DELAY = 1_000
const SECRET = 'sk-ant-api03-ZyXwVuTsRqPoNmLkJiHgFeDcBa0123456789'
const WRITE = { action: { type: 'file_write', path: 'a.txt', content: 'x' } }
const COMPLETE = { action: { type: 'complete', answer: 'done' } }

let events: AuditEvent[]
let states: AgentTaskState[]
let payloads: SafeExternalPayload[]
let sends: number
let cancelled: number
let toolCalls: string[]
let unhandled: unknown[]
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason)
}

beforeEach(() => {
  events = []
  states = []
  payloads = []
  sends = 0
  cancelled = 0
  toolCalls = []
  unhandled = []
  process.on('unhandledRejection', onUnhandled)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  process.off('unhandledRejection', onUnhandled)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const toolbox: AgentToolbox = {
  describeStatus: async () => {
    toolCalls.push('workspace_status')
    return {
      ok: true,
      workspaceName: 'demo',
      permissionMode: 'ask',
      git: {
        repository: 'not-a-repository',
        branch: null,
        detached: false,
        changedPaths: [],
        changedPathsTruncated: false
      }
    }
  },
  listDirectory: async () => {
    toolCalls.push('workspace_list')
    return { ok: true, workspacePath: '', entries: [], truncated: false }
  },
  readFile: async () => {
    toolCalls.push('file_read')
    return { ok: false, reason: 'not-found' }
  },
  search: async () => {
    toolCalls.push('file_search')
    return {
      ok: true,
      matches: [],
      truncated: false,
      secretFilesSkipped: true,
      unverifiedExcludedCount: 0
    }
  },
  writeFile: async (path) => {
    toolCalls.push('file_write')
    return { ok: true, workspacePath: String(path) }
  },
  runCommand: async () => {
    toolCalls.push('terminal_run')
    return {
      ok: true,
      exitCode: 0,
      output: {
        text: '',
        truncated: false,
        secretMasked: false,
        maskedCount: 0,
        categories: [],
        withheld: false
      }
    }
  }
}

/** 1回ごとに何をするかを決める Provider。尽きたら complete。 */
function scripted(
  steps: readonly ((payload: SafeExternalPayload) => unknown)[]
): AgentProvider & { readonly calls: () => number } {
  let count = 0

  return {
    id: ID,
    contextWindowTokens: 32_000,
    calls: () => count,
    next: async (payload) => {
      payloads.push(payload)
      const step = steps[count] ?? (() => COMPLETE)

      count += 1

      return step(payload)
    }
  }
}

const fail = (category: AgentProviderReportedFailure) => (): never => {
  throw new AgentProviderError(category)
}
const answer = (value: unknown) => (): unknown => value

function loopOf(
  chosen: AgentProvider,
  overrides: Partial<AgentLoopDependencies> = {}
): ReturnType<typeof createAgentLoop> {
  const gate = createExternalSendGate({
    readPolicy: () => ({ permissionMode: 'ask' }),
    recordEvent: (event) => events.push(event)
  })

  return createAgentLoop({
    createProvider: () => chosen,
    isProviderAvailable: () => true,
    isAgentEnabled: () => true,
    hasWorkspace: () => true,
    readPermissionMode: () => 'ask',
    sendToProvider: (request, deliver) => {
      sends += 1
      return gate.send(request, deliver)
    },
    providerCallPolicy: { timeoutMs: 60_000, maxResponseChars: 100_000 },
    providerRetryPolicy: { maxAttempts: AGENT_PROVIDER_MAX_ATTEMPTS, retryDelayMs: DELAY },
    toolbox,
    isSideEffectInProgress: () => false,
    cancelPendingApprovals: () => {
      cancelled += 1
      return 0
    },
    recordEvent: (event) => events.push(event),
    emitState: (state) => states.push(state),
    ...overrides
  })
}

function providerFailures(): AuditEvent[] {
  return events.filter((event) => event.type === 'agent.provider-failed')
}

/** 待ちの時間より十分長く時計を進めてから、作業の終わりを待つ。 */
async function settle(loop: ReturnType<typeof createAgentLoop>): Promise<void> {
  await vi.advanceTimersByTimeAsync(DELAY * 20)
  await loop.whenIdle()
  await vi.advanceTimersByTimeAsync(DELAY * 20)
}

describe('Policy', () => {
  it('呼び直してよいのは rate-limited / temporary-failure / network-failed の3つだけ', () => {
    expect(AGENT_PROVIDER_FAILURES.filter(isRetryableProviderFailure).sort()).toEqual([
      'network-failed',
      'rate-limited',
      'temporary-failure'
    ])
    expect(isRetryableProviderFailure('toString')).toBe(false)
    expect(isRetryableProviderFailure(undefined)).toBe(false)
  })

  it('今の呼び直しの Policy は、初回 ＋ 2 回・固定の待ち', () => {
    expect(AGENT_PROVIDER_MAX_ATTEMPTS).toBe(3)
    expect(AGENT_PROVIDER_RETRY_POLICY).toEqual({ maxAttempts: 3, retryDelayMs: 1_000 })
    expect(Object.isFrozen(AGENT_PROVIDER_RETRY_POLICY)).toBe(true)
  })

  it('Policy が天井を超える回数を持っていても、3 回より多くは呼ばない', async () => {
    const provider = scripted(Array.from({ length: 10 }, () => fail('network-failed')))
    const loop = loopOf(provider, { providerRetryPolicy: { maxAttempts: 10, retryDelayMs: DELAY } })

    loop.start('x')
    await settle(loop)

    expect(provider.calls()).toBe(3)
  })

  it('読めない・使えない Policy では呼び直さない（1回だけ）', async () => {
    for (const policy of [
      { maxAttempts: 0, retryDelayMs: DELAY },
      { maxAttempts: 3, retryDelayMs: 0 },
      { maxAttempts: 3, retryDelayMs: Number.NaN },
      { maxAttempts: 2.5, retryDelayMs: DELAY },
      { maxAttempts: 3, retryDelayMs: 2_147_483_648 }
    ]) {
      const provider = scripted([fail('network-failed'), fail('network-failed')])
      const loop = loopOf(provider, { providerRetryPolicy: policy })

      loop.start('x')
      await settle(loop)

      expect(provider.calls()).toBe(1)
    }
  })
})

describe('呼び直さない失敗', () => {
  // Renderer へ見せる終わりの理由（認証・権限は STEP10-4 で分けた）。
  const REPORTED = [
    ['authentication-failed', 'provider-authentication-failed'],
    ['authorization-failed', 'provider-authorization-failed'],
    ['request-rejected', 'provider-failed']
  ] as const

  it.each(REPORTED)(
    '%s は1回で終わる（Provider を再度呼ばない・終わりの理由は %s）',
    async (category, endReason) => {
      const provider = scripted([fail(category), answer(WRITE)])
      const loop = loopOf(provider)

      loop.start('x')
      await settle(loop)

      expect(provider.calls()).toBe(1)
      expect(loop.getState()).toMatchObject({ status: 'failed', endReason, loopsUsed: 0 })
      expect(providerFailures()).toEqual([
        expect.objectContaining({ reason: category, attempt: 1, subject: ID })
      ])
      expect(toolCalls).toEqual([])
    }
  )

  it('分類できない失敗（ふつうの Error・Error 以外）も1回で終わる', async () => {
    for (const thrown of [new Error('boom'), 'string failure', { status: 500 }]) {
      events = []
      const provider = scripted([
        () => {
          throw thrown
        },
        answer(WRITE)
      ])
      const loop = loopOf(provider)

      loop.start('x')
      await settle(loop)

      expect(provider.calls()).toBe(1)
      expect(providerFailures()).toEqual([
        expect.objectContaining({ reason: 'provider-failed', attempt: 1 })
      ])
    }
  })

  it('timeout は provider-timeout で終わり、呼び直さない', async () => {
    const provider = scripted([() => new Promise(() => {}), answer(WRITE)])
    const loop = loopOf(provider, {
      providerCallPolicy: { timeoutMs: 5_000, maxResponseChars: 100_000 }
    })

    loop.start('x')
    await settle(loop)

    expect(provider.calls()).toBe(1)
    expect(loop.getState()).toMatchObject({ status: 'failed', endReason: 'provider-timeout' })
    expect(providerFailures()).toEqual([
      expect.objectContaining({ reason: 'timed-out', attempt: 1 })
    ])
  })

  it('response-too-large は provider-response-too-large で終わり、呼び直さない', async () => {
    const provider = scripted([answer(WRITE), answer(WRITE)])
    const loop = loopOf(provider, {
      providerCallPolicy: { timeoutMs: 5_000, maxResponseChars: 10 }
    })

    loop.start('x')
    await settle(loop)

    expect(provider.calls()).toBe(1)
    expect(loop.getState()).toMatchObject({
      status: 'failed',
      endReason: 'provider-response-too-large'
    })
    expect(providerFailures()).toEqual([
      expect.objectContaining({ reason: 'response-too-large', attempt: 1 })
    ])
    expect(toolCalls).toEqual([])
  })

  it('invalid-response は呼び直さない', async () => {
    const provider = scripted([
      answer({ action: { type: 'workspace_status', extra: undefined } }),
      answer(WRITE)
    ])
    const loop = loopOf(provider)

    loop.start('x')
    await settle(loop)

    expect(provider.calls()).toBe(1)
    expect(loop.getState()).toMatchObject({ status: 'failed', endReason: 'provider-failed' })
    expect(providerFailures()).toEqual([
      expect.objectContaining({ reason: 'invalid-response', attempt: 1 })
    ])
  })

  it('provider-mismatch は呼び直さない（next も呼ばない）', async () => {
    let reads = 0
    const next = vi.fn(async () => WRITE)
    const shifting: AgentProvider = {
      get id() {
        reads += 1
        return reads === 1 ? ID : 'fn-other-provider'
      },
      contextWindowTokens: 32_000,
      next
    }
    const loop = loopOf(shifting)

    loop.start('x')
    await settle(loop)

    expect(next).not.toHaveBeenCalled()
    expect(sends).toBe(1)
    expect(providerFailures()).toEqual([
      expect.objectContaining({ reason: 'provider-mismatch', attempt: 1 })
    ])
  })

  it('provider-unavailable（壊れた呼び出しの Policy）は呼び直さない', async () => {
    const provider = scripted([answer(WRITE)])
    const loop = loopOf(provider, {
      providerCallPolicy: { timeoutMs: 0, maxResponseChars: 100_000 }
    })

    loop.start('x')
    await settle(loop)

    expect(provider.calls()).toBe(0)
    expect(sends).toBe(1)
    expect(providerFailures()).toEqual([
      expect.objectContaining({ reason: 'provider-unavailable', attempt: 1 })
    ])
  })

  it('invalid-payload（Gate を通っていない Payload）は呼び直さない', async () => {
    const provider = scripted([answer(WRITE)])
    const gate = createExternalSendGate({
      readPolicy: () => ({ permissionMode: 'ask' }),
      recordEvent: (event) => events.push(event)
    })
    const loop = loopOf(provider, {
      sendToProvider: (request, deliver) => {
        sends += 1
        // Gate の Payload の代わりに写しを渡す経路（あってはならないもの）。
        return gate.send(request, (payload) =>
          deliver({ ...payload } as unknown as SafeExternalPayload)
        )
      }
    })

    loop.start('x')
    await settle(loop)

    expect(provider.calls()).toBe(0)
    expect(sends).toBe(1)
    expect(providerFailures()).toEqual([
      expect.objectContaining({ reason: 'invalid-payload', attempt: 1 })
    ])
  })

  it('aborted（応答待ちの停止）は呼び直さず、Provider の失敗としても記録しない', async () => {
    const provider = scripted([() => new Promise(() => {}), answer(WRITE)])
    const loop = loopOf(provider)

    loop.start('x')
    await vi.waitFor(() => expect(provider.calls()).toBe(1))
    loop.stop()
    await settle(loop)

    expect(provider.calls()).toBe(1)
    expect(loop.getState()).toMatchObject({ status: 'stopped', endReason: 'user-stopped' })
    expect(providerFailures()).toEqual([])
  })
})

describe('呼び直す失敗', () => {
  const RETRYABLE = ['rate-limited', 'temporary-failure', 'network-failed'] as const

  it.each(RETRYABLE)(
    '%s は待ってから呼び直し、合計3回で打ち切る（4回目は呼ばない）',
    async (category) => {
      const provider = scripted(Array.from({ length: 5 }, () => fail(category)))
      const loop = loopOf(provider)

      loop.start('x')
      await vi.waitFor(() => expect(provider.calls()).toBe(1))

      // すぐには叩き直さない。
      await vi.advanceTimersByTimeAsync(DELAY - 1)
      expect(provider.calls()).toBe(1)

      await vi.advanceTimersByTimeAsync(1)
      expect(provider.calls()).toBe(2)

      await vi.advanceTimersByTimeAsync(DELAY)
      expect(provider.calls()).toBe(3)

      await settle(loop)

      expect(provider.calls()).toBe(3)
      expect(loop.getState()).toMatchObject({ status: 'failed', endReason: 'provider-failed' })
      expect(providerFailures().map((event) => [event.reason, event.attempt])).toEqual([
        [category, 1],
        [category, 2],
        [category, 3]
      ])
      expect(toolCalls).toEqual([])
    }
  )

  it('1回目が失敗して2回目が通れば、通った応答だけを採る', async () => {
    const provider = scripted([
      fail('rate-limited'),
      answer({ action: { type: 'workspace_status' } }),
      answer(COMPLETE)
    ])
    const loop = loopOf(provider)

    loop.start('x')
    await settle(loop)

    expect(provider.calls()).toBe(3)
    expect(toolCalls).toEqual(['workspace_status'])
    expect(loop.getState()).toMatchObject({ status: 'completed', finalAnswer: 'done' })
    expect(providerFailures().map((event) => event.attempt)).toEqual([1])
  })

  it('2回失敗して3回目が通れば、通った応答だけを採る', async () => {
    const provider = scripted([
      fail('temporary-failure'),
      fail('network-failed'),
      answer({ action: { type: 'workspace_status' } }),
      answer(COMPLETE)
    ])
    const loop = loopOf(provider)

    loop.start('x')
    await settle(loop)

    expect(toolCalls).toEqual(['workspace_status'])
    expect(loop.getState()).toMatchObject({ status: 'completed' })
    expect(providerFailures().map((event) => [event.reason, event.attempt])).toEqual([
      ['temporary-failure', 1],
      ['network-failed', 2]
    ])
  })

  it('回数は1ターンごと（通ったら数え直す）', async () => {
    const provider = scripted([
      fail('rate-limited'),
      answer({ action: { type: 'workspace_status' } }),
      fail('rate-limited'),
      fail('rate-limited'),
      answer(COMPLETE)
    ])
    const loop = loopOf(provider)

    loop.start('x')
    await settle(loop)

    expect(loop.getState()).toMatchObject({ status: 'completed' })
    expect(providerFailures().map((event) => event.attempt)).toEqual([1, 1, 2])
  })

  it('呼び直しの途中で呼び直さない失敗が来たら、その場で終える', async () => {
    const provider = scripted([fail('rate-limited'), fail('authentication-failed'), answer(WRITE)])
    const loop = loopOf(provider)

    loop.start('x')
    await settle(loop)

    expect(provider.calls()).toBe(2)
    expect(providerFailures().map((event) => [event.reason, event.attempt])).toEqual([
      ['rate-limited', 1],
      ['authentication-failed', 2]
    ])
  })
})

/*
  Agent Loop の Turn と Provider の Attempt は別（STEP10-4。2026-09-24）。
  Turn は通った応答を受け取ったときだけ進み、呼び直しは Turn を使わない。
*/
describe('Turn と Attempt の分離', () => {
  /** 状態の通知に出た Turn の数（増えた順）。 */
  function turnsSeen(): number[] {
    return [...new Set(states.map((state) => state.loopsUsed))]
  }

  it('A: 1回目 temporary-failure → 2回目で通る ── Attempt 2・Turn は通った応答の分だけ', async () => {
    const provider = scripted([fail('temporary-failure'), answer(COMPLETE)])
    const loop = loopOf(provider)

    loop.start('x')
    await settle(loop)

    expect(provider.calls()).toBe(2)
    expect(loop.getState()).toMatchObject({ status: 'completed', loopsUsed: 1 })
    expect(turnsSeen()).toEqual([0, 1])
  })

  it('B: 1・2回目が失敗 → 3回目で通る ── Attempt 3・Turn は1', async () => {
    const provider = scripted([fail('rate-limited'), fail('network-failed'), answer(COMPLETE)])
    const loop = loopOf(provider)

    loop.start('x')
    await settle(loop)

    expect(provider.calls()).toBe(3)
    expect(loop.getState()).toMatchObject({ status: 'completed', loopsUsed: 1 })
    expect(turnsSeen()).toEqual([0, 1])
  })

  it("B': 途中の Turn でも同じ ── 呼び直しの分は Turn に数えない", async () => {
    const provider = scripted([
      answer({ action: { type: 'workspace_status' } }),
      fail('rate-limited'),
      fail('rate-limited'),
      answer(COMPLETE)
    ])
    const loop = loopOf(provider)

    loop.start('x')
    await settle(loop)

    expect(provider.calls()).toBe(4)
    expect(loop.getState()).toMatchObject({ status: 'completed', loopsUsed: 2 })
  })

  it('C: 3回とも失敗 ── 4回目は呼ばず、Turn を進めずに終える', async () => {
    const provider = scripted(Array.from({ length: 5 }, () => fail('temporary-failure')))
    const loop = loopOf(provider)

    loop.start('x')
    await settle(loop)

    expect(provider.calls()).toBe(3)
    expect(loop.getState()).toMatchObject({
      status: 'failed',
      endReason: 'provider-failed',
      loopsUsed: 0
    })
    expect(turnsSeen()).toEqual([0])
  })

  it("C': Turn の上限の手前でも、呼び直しで上限に触れない（続けるかを尋ねない）", async () => {
    const outputs = [
      ...Array.from({ length: 19 }, () => answer({ action: { type: 'workspace_status' } })),
      fail('rate-limited'),
      fail('rate-limited'),
      answer(COMPLETE)
    ]
    const provider = scripted(outputs)
    const loop = loopOf(provider)

    loop.start('x')
    await settle(loop)

    // 19 Turn の後、呼び直し 2 回を挟んで 20 Turn 目の complete で終わる（上限 20 に届いただけ）。
    expect(provider.calls()).toBe(22)
    expect(loop.getState()).toMatchObject({ status: 'completed', loopsUsed: 20, loopLimit: 20 })
    expect(states.some((state) => state.status === 'awaiting-continue')).toBe(false)
  })

  it.each(['stop', 'halt'] as const)(
    'D: 待機中に %s ── 次の Attempt なし・Turn は増えず・stopped で whenIdle が解ける',
    async (how) => {
      const provider = scripted([
        answer({ action: { type: 'workspace_status' } }),
        fail('network-failed'),
        answer(WRITE)
      ])
      const loop = loopOf(provider)

      loop.start('x')
      await vi.waitFor(() => expect(provider.calls()).toBe(2))
      await vi.advanceTimersByTimeAsync(DELAY / 2)

      const turnsBefore = loop.getState().loopsUsed

      if (how === 'stop') {
        loop.stop()
      } else {
        loop.halt('workspace-changed')
      }

      await loop.whenIdle()
      await vi.advanceTimersByTimeAsync(DELAY * 20)

      expect(turnsBefore).toBe(1)
      expect(provider.calls()).toBe(2)
      expect(loop.getState()).toMatchObject({ status: 'stopped', loopsUsed: 1 })
      expect(toolCalls).toEqual(['workspace_status'])
    }
  )
})

describe('Audit の記録が失敗しても判断は変わらない', () => {
  it('記録が毎回投げても、呼び直しの回数と終わり方は同じ', async () => {
    const provider = scripted(Array.from({ length: 5 }, () => fail('rate-limited')))
    const loop = loopOf(provider, {
      recordEvent: () => {
        throw new Error('audit disk full')
      }
    })

    loop.start('x')
    await settle(loop)

    expect(provider.calls()).toBe(3)
    expect(loop.getState()).toMatchObject({ status: 'failed', endReason: 'provider-failed' })
  })

  it('記録が投げても、呼び直さない失敗はその場で終わる（呼び直しへ倒れない）', async () => {
    const provider = scripted([fail('authentication-failed'), answer(WRITE)])
    const loop = loopOf(provider, {
      recordEvent: () => {
        throw new Error('audit disk full')
      }
    })

    loop.start('x')
    await settle(loop)

    expect(provider.calls()).toBe(1)
    expect(loop.getState()).toMatchObject({
      status: 'failed',
      endReason: 'provider-authentication-failed'
    })
    expect(toolCalls).toEqual([])
  })
})

describe('待っている間の停止', () => {
  it.each(['stop', 'halt'] as const)(
    '待機中に %s → 次を呼ばず、stopped で whenIdle が解け、副作用も起きない',
    async (how) => {
      const provider = scripted([fail('network-failed'), answer(WRITE), answer(WRITE)])
      const loop = loopOf(provider)

      loop.start('x')
      await vi.waitFor(() => expect(provider.calls()).toBe(1))
      await vi.advanceTimersByTimeAsync(DELAY / 2)

      if (how === 'stop') {
        loop.stop()
      } else {
        loop.halt('workspace-changed')
      }

      // 待ちの時間を進めなくても終わる（待ちは止めた時点で解ける）。
      await loop.whenIdle()

      expect(loop.getState()).toMatchObject({
        status: 'stopped',
        endReason: how === 'stop' ? 'user-stopped' : 'workspace-changed'
      })

      await vi.advanceTimersByTimeAsync(DELAY * 20)

      expect(provider.calls()).toBe(1)
      expect(sends).toBe(1)
      expect(toolCalls).toEqual([])
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('待ちが明けた直後（次を呼ぶ前）に止めても、次は呼ばない', async () => {
    const provider = scripted([fail('rate-limited'), answer(WRITE)])
    const loop = loopOf(provider)

    loop.start('x')
    await vi.waitFor(() => expect(provider.calls()).toBe(1))

    // timer を同期で発火させ、Loop が続きを動かす前に止める。
    vi.advanceTimersByTime(DELAY)
    loop.stop()
    await loop.whenIdle()

    expect(provider.calls()).toBe(1)
    expect(sends).toBe(1)
    expect(loop.getState()).toMatchObject({ status: 'stopped', endReason: 'user-stopped' })
    expect(toolCalls).toEqual([])
  })

  it('呼び直した応答を待っている間に止めれば、遅れて届いた応答も使わない', async () => {
    let late: (value: unknown) => void = () => {}
    const provider = scripted([
      fail('temporary-failure'),
      () =>
        new Promise((resolve) => {
          late = resolve
        })
    ])
    const loop = loopOf(provider)

    loop.start('x')
    await vi.advanceTimersByTimeAsync(DELAY)
    await vi.waitFor(() => expect(provider.calls()).toBe(2))

    loop.stop()
    await loop.whenIdle()

    late(WRITE)
    await vi.advanceTimersByTimeAsync(0)

    expect(toolCalls).toEqual([])
    expect(provider.calls()).toBe(2)
    expect(unhandled).toEqual([])
  })
})

describe('呼び直しと SafeExternalPayload', () => {
  it('呼び直しのたびに External Send Gate を通り、新しい Payload が届く。使った Payload は取り消される', async () => {
    const provider = scripted([fail('rate-limited'), fail('network-failed'), answer(COMPLETE)])
    const loop = loopOf(provider)

    loop.start('x')
    await settle(loop)

    expect(sends).toBe(3)
    expect(events.filter((event) => event.type === 'external-send.allowed')).toHaveLength(3)
    expect(payloads).toHaveLength(3)
    expect(new Set(payloads).size).toBe(3)

    for (const payload of payloads) {
      expect(isSafeExternalPayload(payload)).toBe(false)
    }
  })

  it('Provider が前の Payload を持ち回しても、それで呼ばれることは無い（届くのは毎回 Gate の新しいもの）', async () => {
    const seen: boolean[] = []
    let first: SafeExternalPayload | null = null
    const provider = scripted([
      (payload) => {
        first = payload
        throw new AgentProviderError('rate-limited')
      },
      (payload) => {
        seen.push(payload === first, isSafeExternalPayload(first))
        return COMPLETE
      }
    ])
    const loop = loopOf(provider)

    loop.start('x')
    await settle(loop)

    // 2回目に届いたのは1回目と別の Payload で、1回目のものはもう取り消されている。
    expect(seen).toEqual([false, false])
  })
})

describe('Error の本文を流さない', () => {
  it('Adapter の例外の本文・独自の欄は、状態・Audit・次の要求・ログのどこにも出ない', async () => {
    const logs: unknown[] = []

    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args)
      })
    }

    const tagged = Object.assign(new AgentProviderError('rate-limited'), {
      message: `API KEY=${SECRET}`,
      body: `{"error":"invalid key ${SECRET}"}`,
      headers: { authorization: `Bearer ${SECRET}` }
    })
    const provider = scripted([
      () => {
        throw tagged
      },
      () => {
        throw new Error(`API KEY=${SECRET}`)
      }
    ])
    const loop = loopOf(provider)

    loop.start('x')
    await settle(loop)

    const nextRequest = payloads[1].parts.map((part) => part.text).join('\n')
    const auditLines = events.map((event) => formatAuditRecordLine(sanitizeAuditEvent(event)))

    for (const text of [
      JSON.stringify(states),
      JSON.stringify(events),
      auditLines.join('\n'),
      nextRequest,
      JSON.stringify(logs)
    ]) {
      expect(text).not.toContain(SECRET)
      expect(text).not.toContain('API KEY')
      expect(text).not.toContain('invalid key')
    }

    expect(providerFailures().map((event) => event.reason)).toEqual([
      'rate-limited',
      'provider-failed'
    ])
  })

  it('Provider の失敗の Audit は、識別子・分類・回数・Permission だけ', () => {
    const event = agentProviderFailedEvent(ID, 'rate-limited', 2, 'ask')

    expect(event).toEqual({
      type: 'agent.provider-failed',
      reason: 'rate-limited',
      outcome: 'failure',
      permissionMode: 'ask',
      attempt: 2,
      subject: ID
    })

    const line = JSON.parse(formatAuditRecordLine(sanitizeAuditEvent(event))) as Record<
      string,
      unknown
    >

    expect(Object.keys(line).sort()).toEqual([
      'attempt',
      'category',
      'event',
      'outcome',
      'permissionMode',
      'reason',
      'subject',
      'time'
    ])
  })

  it('識別子として受け付けない値（URL・API Key・長すぎる名前）は subject に載せない', () => {
    for (const providerId of [
      'https://api.example.com/v1',
      SECRET,
      'a'.repeat(41),
      'Bearer x',
      42,
      null
    ]) {
      expect(agentProviderFailedEvent(providerId, 'network-failed', 1, 'ask')).not.toHaveProperty(
        'subject'
      )
    }
  })

  it('attempt は 1 以上の整数だけが記録に残る', () => {
    for (const attempt of [0, -1, 1.5, Number.NaN, 100]) {
      expect(
        sanitizeAuditEvent({ type: 'agent.provider-failed', attempt } as AuditEvent).attempt
      ).toBeNull()
    }

    expect(sanitizeAuditEvent({ type: 'agent.provider-failed', attempt: 3 }).attempt).toBe(3)
  })
})
