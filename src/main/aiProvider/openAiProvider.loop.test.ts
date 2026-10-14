import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentTaskState } from '@shared/agent'
import type { AgentContext } from '../agent/agentContext'
import { createAgentLoop } from '../agent/agentLoop'
import {
  AGENT_PROVIDER_MAX_ATTEMPTS,
  AGENT_PROVIDER_RETRY_POLICY,
  type AgentProvider
} from '../agent/agentProvider'
import type { AgentToolbox } from '../agent/agentTools'
import type { AuditEvent } from '../security/audit/auditEvent'
import { formatAuditRecordLine } from '../security/audit/auditLogLine'
import { sanitizeAuditEvent } from '../security/audit/auditRecord'
import { createExternalSendGate } from '../security/externalSend/externalSendGate'
import {
  isSafeExternalPayload,
  type SafeExternalPayload
} from '../security/externalSend/safeExternalPayload'
import { createOpenAiProvider, type OpenAiFetch } from './openAiProvider'

/*
  Loop が作った Context を横から見るため（STEP10 Closing の usage）。createAgentContext は本物の
  まま呼び、作られた Context を覚えるだけ（振る舞いは変えない）。
*/
const contexts = vi.hoisted(() => [] as AgentContext[])

vi.mock('../agent/agentContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agent/agentContext')>()

  return {
    ...actual,
    createAgentContext: (...args: Parameters<typeof actual.createAgentContext>) => {
      const context = actual.createAgentContext(...args)

      contexts.push(context)

      return context
    }
  }
})

/**
 * OpenAI の Adapter を Agent Loop につないだときの呼び直し・中断・Audit（STEP10-6）。
 *
 * External Send Gate は**本物**、Adapter も本物、fetch だけが偽物。時計は偽物（setTimeout /
 * clearTimeout）で進め、実時間は待たない。呼び直す回数（初回 ＋ 2 回）は Loop の Policy のまま。
 */

const KEY = 'fn-synthetic-openai-credential-loop-7c6b5a'
const CANARY = 'fn-synthetic-response-canary-loop-3e2d1c'
const COMPLETE = '{"action":{"type":"complete","answer":"done"}}'

let events: AuditEvent[]
let states: AgentTaskState[]
let payloads: SafeExternalPayload[]
let toolCalls: string[]
let fetchCalls = 0
let unhandled: unknown[]
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason)
}

beforeEach(() => {
  events = []
  states = []
  payloads = []
  toolCalls = []
  fetchCalls = 0
  unhandled = []
  contexts.length = 0
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

type Step = () => Response | Promise<Response>

function ok(text: string, usage?: unknown): Step {
  return () =>
    new Response(
      JSON.stringify({
        id: `resp_${CANARY}`,
        object: 'response',
        status: 'completed',
        error: null,
        output: [
          {
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text }]
          }
        ],
        ...(usage === undefined ? {} : { usage })
      }),
      { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': CANARY } }
    )
}

function status(code: number, headers: Record<string, string> = {}): Step {
  return () =>
    new Response(`{"error":{"message":"${KEY} ${CANARY}"}}`, {
      status: code,
      headers: { 'content-type': 'application/json', 'x-request-id': CANARY, ...headers }
    })
}

const offline: Step = () => {
  throw new TypeError(`fetch failed ${KEY}`)
}

/** 1回ごとの fetch の結末。尽きたら complete。 */
function openAi(steps: readonly Step[]): AgentProvider {
  const fetch: OpenAiFetch = async () => {
    const step = steps[fetchCalls] ?? ok(COMPLETE)

    fetchCalls += 1

    return step()
  }
  const provider = createOpenAiProvider({
    model: 'gpt-6-sol',
    fetch,
    withCredential: (use) => ({ ok: true, value: use(KEY) })
  })

  if (provider === null) {
    throw new Error('not created')
  }

  return provider
}

function loopOf(provider: AgentProvider): ReturnType<typeof createAgentLoop> {
  const gate = createExternalSendGate({
    readPolicy: () => ({ permissionMode: 'ask' }),
    recordEvent: (event) => events.push(event)
  })

  return createAgentLoop({
    createProvider: () => provider,
    isProviderAvailable: () => true,
    isAgentEnabled: () => true,
    hasWorkspace: () => true,
    readPermissionMode: () => 'ask',
    sendToProvider: (request, deliver) =>
      gate.send(request, (payload) => {
        payloads.push(payload)
        return deliver(payload)
      }),
    providerRetryPolicy: AGENT_PROVIDER_RETRY_POLICY,
    toolbox,
    isSideEffectInProgress: () => false,
    cancelPendingApprovals: () => 0,
    recordEvent: (event) => events.push(event),
    emitState: (state) => states.push(state)
  })
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

async function settle(loop: ReturnType<typeof createAgentLoop>): Promise<void> {
  await vi.advanceTimersByTimeAsync(200_000)
  await loop.whenIdle()
}

function providerFailures(): AuditEvent[] {
  return events.filter((event) => event.type === 'agent.provider-failed')
}

function expectNoLeak(): void {
  const lines = events.map((event) => formatAuditRecordLine(sanitizeAuditEvent(event)))
  const everything = JSON.stringify([events, lines, states])

  for (const secret of [KEY, CANARY, 'retry-after', '86400']) {
    expect(everything).not.toContain(secret)
  }
}

describe('呼び直す失敗（最大3回・毎回新しい Payload）', () => {
  it.each([
    ['429', status(429)],
    ['500', status(500)],
    ['503', status(503)],
    ['408', status(408)],
    ['通信の失敗', offline]
  ])('%s の後は呼び直して、通った応答で終わる', async (_name, first) => {
    const loop = loopOf(openAi([first]))

    loop.start('x')
    await settle(loop)

    expect(fetchCalls).toBe(2)
    expect(loop.getState()).toMatchObject({ status: 'completed', loopsUsed: 1 })
    // 呼び直しも Gate を通って新しい Payload になり、前の Payload はもう使えない。
    expect(payloads).toHaveLength(2)
    expect(payloads[0]).not.toBe(payloads[1])
    expect(payloads.map((payload) => isSafeExternalPayload(payload))).toEqual([false, false])
    expect(unhandled).toEqual([])
    expectNoLeak()
  })

  it('429 が続いても3回で終わる（provider-failed・attempt は 1〜3）', async () => {
    const loop = loopOf(openAi(Array.from({ length: 10 }, () => status(429))))

    loop.start('x')
    await settle(loop)

    expect(AGENT_PROVIDER_MAX_ATTEMPTS).toBe(3)
    expect(fetchCalls).toBe(3)
    expect(loop.getState()).toMatchObject({ status: 'failed', endReason: 'provider-failed' })
    expect(providerFailures().map((event) => [event.subject, event.reason, event.attempt])).toEqual(
      [
        ['openai', 'rate-limited', 1],
        ['openai', 'rate-limited', 2],
        ['openai', 'rate-limited', 3]
      ]
    )
    expectNoLeak()
  })
})

describe('呼び直さない失敗', () => {
  it.each([
    [401, 'provider-authentication-failed'],
    [403, 'provider-authorization-failed'],
    [400, 'provider-failed'],
    [404, 'provider-failed']
  ] as const)('%i → 1回で %s', async (code, endReason) => {
    const loop = loopOf(openAi([status(code, { 'retry-after': '1' })]))

    loop.start('x')
    await settle(loop)

    expect(fetchCalls).toBe(1)
    expect(loop.getState()).toMatchObject({ status: 'failed', endReason })
    expectNoLeak()
  })
})

describe('Retry-After', () => {
  async function waitsFor(step: Step, expectedMs: number): Promise<void> {
    const loop = loopOf(openAi([step]))

    loop.start('x')
    await flush()
    expect(fetchCalls).toBe(1)

    await vi.advanceTimersByTimeAsync(expectedMs - 1)
    expect(fetchCalls).toBe(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchCalls).toBe(2)

    await settle(loop)
    expect(loop.getState().status).toBe('completed')
    expectNoLeak()
  }

  /**
   * 上限（30 秒）を超える Retry-After。**時計を1ミリ秒も進めずに**作業が終わる（長く sleep しない）こと、
   * その後どれだけ時計を進めても2回目の呼び出しが無い（30 秒へ縮めて送り直さない）ことを見る。
   */
  async function endsWithoutRetry(step: Step): Promise<void> {
    const loop = loopOf(openAi([step]))

    loop.start('x')
    await flush()
    await loop.whenIdle()

    expect(fetchCalls).toBe(1)
    expect(loop.getState()).toMatchObject({ status: 'failed', endReason: 'provider-failed' })
    // 待ちの timer が1つも残っていない（Retry-After の時間を sleep していない）。
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(fetchCalls).toBe(1)
    // Audit は失敗の分類と回数だけ（Retry-After の値は載らない）。
    expect(providerFailures().map((event) => [event.reason, event.attempt])).toHaveLength(1)
    expect(providerFailures()[0]).toMatchObject({ subject: 'openai', attempt: 1 })
    expect(Object.keys(providerFailures()[0])).not.toContain('retryAfterMs')
    expectNoLeak()
  }

  it('無ければ STEP10-3 の固定 1 秒', async () => {
    await waitsFor(status(429), 1_000)
  })

  it('Retry-After: 1 → 1 秒以上待って呼び直す', async () => {
    await waitsFor(status(429, { 'retry-after': '1' }), 1_000)
  })

  it('Retry-After: 5 → 5 秒以上待って呼び直す', async () => {
    await waitsFor(status(429, { 'retry-after': '5' }), 5_000)
  })

  it('Retry-After: 30（上限ちょうど）→ 30 秒以上待って呼び直す', async () => {
    await waitsFor(status(429, { 'retry-after': '30' }), 30_000)
  })

  it('retry-after-ms も読む（1 秒より短ければ 1 秒）', async () => {
    await waitsFor(status(503, { 'retry-after-ms': '2500' }), 2_500)
    fetchCalls = 0
    await waitsFor(status(503, { 'retry-after-ms': '10' }), 1_000)
  })

  it('読めない Retry-After は既存の Policy（1 秒）', async () => {
    await waitsFor(status(429, { 'retry-after': 'tomorrow' }), 1_000)
    fetchCalls = 0
    await waitsFor(status(429, { 'retry-after': '-5' }), 1_000)
  })

  it('Retry-After: 31 → 呼び直さずに終わる', async () => {
    await endsWithoutRetry(status(429, { 'retry-after': '31' }))
  })

  it('Retry-After: 56 → 30 秒で送り直さず、呼び直さずに終わる', async () => {
    await endsWithoutRetry(status(429, { 'retry-after': '56' }))
  })

  it('503 でも上限を超える Retry-After なら呼び直さない', async () => {
    await endsWithoutRetry(status(503, { 'retry-after-ms': '30001' }))
  })

  it('非常に大きな Retry-After（秒・ミリ秒・遠い日付）→ 長く sleep せず、呼び直さない', async () => {
    await endsWithoutRetry(status(429, { 'retry-after': '86400' }))
    fetchCalls = 0
    events = []
    await endsWithoutRetry(status(429, { 'retry-after-ms': '999999999999' }))
    fetchCalls = 0
    events = []
    await endsWithoutRetry(status(429, { 'retry-after': 'Wed, 25 Sep 2030 00:00:00 GMT' }))
  })

  it('2回目の失敗で上限を超える Retry-After が来たら、そこで終わる（3回目は呼ばない）', async () => {
    const loop = loopOf(
      openAi([status(429, { 'retry-after': '2' }), status(429, { 'retry-after': '56' })])
    )

    loop.start('x')
    await flush()
    await vi.advanceTimersByTimeAsync(2_000)
    await loop.whenIdle()

    expect(fetchCalls).toBe(2)
    expect(loop.getState()).toMatchObject({ status: 'failed', endReason: 'provider-failed' })
    expect(providerFailures().map((event) => event.attempt)).toEqual([1, 2])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('待っている間に止めれば、次の呼び出しをせずに止まる', async () => {
    const loop = loopOf(openAi([status(429, { 'retry-after': '20' })]))

    loop.start('x')
    await flush()
    await vi.advanceTimersByTimeAsync(5_000)

    loop.stop()
    await loop.whenIdle()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(fetchCalls).toBe(1)
    expect(loop.getState()).toMatchObject({ status: 'stopped', endReason: 'user-stopped' })
  })
})

describe('応答は Schema と Security Core を通る', () => {
  it('Action は toolbox（Security Core の入口）でだけ実行され、壊れた Action は実行されない', async () => {
    const loop = loopOf(
      openAi([
        ok('{"action":{"type":"workspace_status","approved":true}}'),
        ok('{"action":{"type":"git_push"}}'),
        ok('{"action":{"type":"workspace_status"}}'),
        ok('not json'),
        ok('{"action":{"type":"complete","answer":"finished"}}')
      ])
    )

    loop.start('x')
    await settle(loop)

    expect(toolCalls).toEqual(['workspace_status'])
    expect(loop.getState()).toMatchObject({ status: 'completed', finalAnswer: 'finished' })
    expect(events.filter((event) => event.type === 'agent.action-rejected')).toHaveLength(3)
    expectNoLeak()
  })

  it('止めた後に届いた応答から副作用は起きない', async () => {
    let release: () => void = () => {}
    const fetch: OpenAiFetch = () =>
      new Promise((resolve) => {
        release = () =>
          resolve(ok('{"action":{"type":"file_write","path":"a.txt","content":"x"}}')())
      })
    const provider = createOpenAiProvider({
      model: 'gpt-6-sol',
      fetch,
      withCredential: (use) => ({ ok: true, value: use(KEY) })
    })
    const loop = loopOf(provider as AgentProvider)

    loop.start('x')
    await flush()

    loop.stop()
    await loop.whenIdle()
    release()
    await flush()

    expect(toolCalls).toEqual([])
    expect(loop.getState().status).toBe('stopped')
    expect(unhandled).toEqual([])
  })
})

describe('Token の実測値（STEP10 Closing）', () => {
  /** 他の数と混ざらない値（states・Audit に出ていないことを文字列で確かめる）。 */
  const USAGE = {
    input_tokens: 7_654_321,
    output_tokens: 123_457,
    output_tokens_details: { reasoning_tokens: 98_765 }
  }
  const SEEN = { inputTokens: 7_654_321, outputTokens: 123_457, reasoningTokens: 98_765 }
  const STATUS = '{"action":{"type":"workspace_status"}}'

  function snapshot(): unknown {
    return {
      toolCalls: [...toolCalls],
      fetchCalls,
      states: JSON.stringify(states),
      events: events.map((event) => [event.type, event.reason, event.subject, event.attempt]),
      payloads: payloads.map((payload) => payload.parts.map((part) => [part.kind, part.text]))
    }
  }

  async function run(steps: readonly Step[]): Promise<unknown> {
    const loop = loopOf(openAi(steps))

    loop.start('x')
    await settle(loop)

    return snapshot()
  }

  function reset(): void {
    events = []
    states = []
    payloads = []
    toolCalls = []
    fetchCalls = 0
    contexts.length = 0
  }

  it('成功の応答の usage は Context に参考として残り、states・Audit には出ない', async () => {
    const loop = loopOf(openAi([ok(STATUS, USAGE), ok(COMPLETE, USAGE)]))

    loop.start('x')
    await settle(loop)

    expect(loop.getState()).toMatchObject({ status: 'completed', loopsUsed: 2 })
    expect(contexts).toHaveLength(1)
    expect(contexts[0].lastUsage()).toEqual(SEEN)

    const lines = events.map((event) => formatAuditRecordLine(sanitizeAuditEvent(event)))
    const everything = JSON.stringify([events, lines, states, loop.getState()])

    for (const number of ['7654321', '123457', '98765']) {
      expect(everything).not.toContain(number)
    }

    expect(everything).not.toMatch(/usage|tokens/i)
    expectNoLeak()
  })

  it('usage の有無で Loop の振る舞い（Action・Turn・Payload・状態・Audit）は変わらない', async () => {
    const steps = (usage?: unknown): Step[] => [
      ok(STATUS, usage),
      status(429),
      ok('{"action":{"type":"file_search","query":"todo"}}', usage),
      ok(COMPLETE, usage)
    ]

    const without = await run(steps())

    reset()

    const withUsage = await run(steps(USAGE))

    expect(withUsage).toEqual(without)
    expect(contexts[0].lastUsage()).toEqual(SEEN)
  })

  it('失敗した試みは usage を持たない（呼び直して通った応答の usage だけ）', async () => {
    const loop = loopOf(
      openAi([
        status(503),
        ok(COMPLETE, { input_tokens: 40, output_tokens: 4, output_tokens_details: {} })
      ])
    )

    loop.start('x')
    await settle(loop)

    expect(fetchCalls).toBe(2)
    expect(loop.getState()).toMatchObject({ status: 'completed', loopsUsed: 1 })
    expect(contexts[0].lastUsage()).toEqual({
      inputTokens: 40,
      outputTokens: 4,
      reasoningTokens: null
    })
  })

  it.each([
    ['壊れた usage', { input_tokens: -1, output_tokens: 'x' }],
    ['上限を超える usage', { input_tokens: 10_000_001, output_tokens: 1 }],
    ['usage が無い', undefined]
  ])('%s でも作業は普通に終わり、直前の値は「無い」になる', async (_name, broken) => {
    const loop = loopOf(openAi([ok(STATUS, USAGE), ok(COMPLETE, broken)]))

    loop.start('x')
    await settle(loop)

    expect(loop.getState()).toMatchObject({
      status: 'completed',
      loopsUsed: 2,
      endReason: 'completed'
    })
    expect(toolCalls).toEqual(['workspace_status'])
    expect(providerFailures()).toEqual([])
    expect(contexts[0].lastUsage()).toBeNull()
  })

  it('止めた後に届いた応答の usage は記録しない', async () => {
    let release: () => void = () => {}
    const fetch: OpenAiFetch = () =>
      new Promise((resolve) => {
        release = () => resolve(ok(COMPLETE, USAGE)())
      })
    const provider = createOpenAiProvider({
      model: 'gpt-6-sol',
      fetch,
      withCredential: (use) => ({ ok: true, value: use(KEY) })
    })
    const loop = loopOf(provider as AgentProvider)

    loop.start('x')
    await flush()

    loop.stop()
    await loop.whenIdle()
    release()
    await flush()

    expect(loop.getState().status).toBe('stopped')
    expect(contexts[0].lastUsage()).toBeNull()
    expect(unhandled).toEqual([])
  })
})
