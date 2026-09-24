import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decideExternalSend } from '../security/externalSend/externalSendDecision'
import {
  revokeSafeExternalPayload,
  type SafeExternalPayload
} from '../security/externalSend/safeExternalPayload'
import {
  AGENT_PROVIDER_CALL_POLICY,
  AGENT_PROVIDER_FAILURES,
  AgentProviderError,
  type AgentProvider,
  type AgentProviderCallPolicy
} from './agentProvider'
import { callAgentProvider } from './agentProviderCall'

/**
 * Provider の呼び出しの境界（Security Core v1 の STEP10-2）。
 *
 * 待ち時間に頼らない。Provider の応答は Deferred で決め、timeout は偽の時計で進める。
 */

const ID = 'fn-test-provider'
const POLICY: AgentProviderCallPolicy = Object.freeze({ timeoutMs: 1_000, maxResponseChars: 100 })
const SECRET = 'sk-ant-api03-0123456789abcdefghijklmnopqrstuvwxyz'

let unhandled: unknown[]
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason)
}

beforeEach(() => {
  unhandled = []
  process.on('unhandledRejection', onUnhandled)
})

afterEach(() => {
  process.off('unhandledRejection', onUnhandled)
  vi.useRealTimers()
})

/** Gate（STEP5）の判定で発行した本物の Payload。 */
function payloadFor(providerId: string): SafeExternalPayload {
  const decision = decideExternalSend(
    { permissionMode: 'ask' },
    { providerId, items: [{ kind: 'user-prompt', text: 'hello' }] }
  )

  if (decision.decision !== 'allow') {
    throw new Error('expected allow')
  }

  return decision.payload
}

interface Controlled {
  readonly provider: AgentProvider
  readonly calls: { payload: unknown; signal: AbortSignal }[]
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

/** signal を見ない Provider（応答はテストが決める）。 */
function controlled(id = ID): Controlled {
  const state: Controlled = {
    calls: [],
    resolve: () => {},
    reject: () => {},
    provider: {
      id,
      contextWindowTokens: 32_000,
      next: (payload, signal) => {
        state.calls.push({ payload, signal })

        return new Promise((resolve, reject) => {
          state.resolve = resolve
          state.reject = reject
        })
      }
    }
  }

  return state
}

/** 決まった値を返す Provider。 */
function answering(output: unknown, id = ID): AgentProvider & { calls: number } {
  const provider = {
    id,
    contextWindowTokens: 32_000,
    calls: 0,
    next: async () => {
      provider.calls += 1
      return output
    }
  }

  return provider
}

/** Promise の後始末（then の連鎖）を最後まで流す。 */
async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve()
  }
}

const live = (): AbortSignal => new AbortController().signal

describe('契約', () => {
  it('失敗の分類は閉じた集合', () => {
    expect([...AGENT_PROVIDER_FAILURES].sort()).toEqual([
      'aborted',
      'authentication-failed',
      'authorization-failed',
      'invalid-payload',
      'invalid-response',
      'network-failed',
      'provider-failed',
      'provider-mismatch',
      'provider-unavailable',
      'rate-limited',
      'request-rejected',
      'response-too-large',
      'temporary-failure',
      'timeout'
    ])
  })

  it('今の Policy は使える値（timeout は正の整数・応答の上限は Schema と同じ）', () => {
    expect(Number.isSafeInteger(AGENT_PROVIDER_CALL_POLICY.timeoutMs)).toBe(true)
    expect(AGENT_PROVIDER_CALL_POLICY.timeoutMs).toBeGreaterThan(0)
    expect(AGENT_PROVIDER_CALL_POLICY.maxResponseChars).toBe(1_200_000)
    expect(Object.isFrozen(AGENT_PROVIDER_CALL_POLICY)).toBe(true)
  })
})

describe('正常な応答', () => {
  it('文字列の応答はそのまま、1回だけ採る', async () => {
    const provider = answering('{"action":{"type":"workspace_status"}}')

    await expect(callAgentProvider(provider, payloadFor(ID), live(), POLICY)).resolves.toEqual({
      ok: true,
      text: '{"action":{"type":"workspace_status"}}'
    })
    expect(provider.calls).toBe(1)
  })

  it('オブジェクトの応答は1度だけ JSON の文字列へ直す（getter は1度しか動かない）', async () => {
    let reads = 0
    const output = {
      get action() {
        reads += 1
        return { type: 'workspace_status' }
      }
    }

    const result = await callAgentProvider(answering(output), payloadFor(ID), live(), POLICY)

    expect(result).toEqual({ ok: true, text: '{"action":{"type":"workspace_status"}}' })
    expect(reads).toBe(1)
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('Provider には Gate の Payload と、作業の signal と連動する別の signal が届く', async () => {
    const state = controlled()
    const payload = payloadFor(ID)
    const work = new AbortController()
    const pending = callAgentProvider(state.provider, payload, work.signal, POLICY)

    expect(state.calls).toHaveLength(1)
    expect(state.calls[0].payload).toBe(payload)
    expect(state.calls[0].signal).not.toBe(work.signal)
    expect(state.calls[0].signal.aborted).toBe(false)

    state.resolve('"x"')
    await pending

    // 結果が決まった後は、Provider 側の signal も止める（使い終わった要求を残さない）。
    expect(state.calls[0].signal.aborted).toBe(true)
    expect(work.signal.aborted).toBe(false)
  })
})

describe('Provider ID の照合', () => {
  it('Payload の providerId と Provider の id が同じなら呼ぶ', async () => {
    const provider = answering('"ok"')

    await expect(callAgentProvider(provider, payloadFor(ID), live(), POLICY)).resolves.toEqual({
      ok: true,
      text: '"ok"'
    })
  })

  it('別の Provider 宛ての Payload は、next を呼ばずに provider-mismatch', async () => {
    const provider = answering('"ok"')

    await expect(
      callAgentProvider(provider, payloadFor('fn-other-provider'), live(), POLICY)
    ).resolves.toEqual({ ok: false, failure: 'provider-mismatch' })
    expect(provider.calls).toBe(0)
  })

  it('id は1度だけ読む（getter で照合の後に名前を変えても、照合した値で決まる）', async () => {
    let reads = 0
    const next = vi.fn(async () => '"ok"')
    const provider = {
      get id() {
        reads += 1
        return reads === 1 ? 'fn-other-provider' : ID
      },
      contextWindowTokens: 32_000,
      next
    }

    await expect(callAgentProvider(provider, payloadFor(ID), live(), POLICY)).resolves.toEqual({
      ok: false,
      failure: 'provider-mismatch'
    })
    expect(next).not.toHaveBeenCalled()
  })
})

describe('Payload の確かめ直し', () => {
  it('Gate が発行していないもの（偽造・写し・JSON を通したもの）は送らない', async () => {
    const provider = answering('"ok"')
    const real = payloadFor(ID)

    for (const fake of [
      { providerId: ID, parts: [], totalChars: 0, notice: {} },
      { ...real },
      JSON.parse(JSON.stringify(real)),
      Object.create(real),
      null,
      'payload'
    ]) {
      await expect(callAgentProvider(provider, fake, live(), POLICY)).resolves.toEqual({
        ok: false,
        failure: 'invalid-payload'
      })
    }

    expect(provider.calls).toBe(0)
  })

  it('取り消し済み（使い終わった）Payload は送らない', async () => {
    const provider = answering('"ok"')
    const payload = payloadFor(ID)

    revokeSafeExternalPayload(payload)

    await expect(callAgentProvider(provider, payload, live(), POLICY)).resolves.toEqual({
      ok: false,
      failure: 'invalid-payload'
    })
    expect(provider.calls).toBe(0)
  })
})

describe('abort（Loop 側で強制する）', () => {
  it('止まった後の呼び出しは、Provider を呼ばずに aborted', async () => {
    const provider = answering('"ok"')
    const work = new AbortController()

    work.abort()

    await expect(callAgentProvider(provider, payloadFor(ID), work.signal, POLICY)).resolves.toEqual(
      { ok: false, failure: 'aborted' }
    )
    expect(provider.calls).toBe(0)
  })

  it('Provider が signal を無視して返さなくても、abort した時点で aborted に決まる', async () => {
    const state = controlled()
    const work = new AbortController()
    const pending = callAgentProvider(state.provider, payloadFor(ID), work.signal, POLICY)

    work.abort()

    await expect(pending).resolves.toEqual({ ok: false, failure: 'aborted' })
    // Provider 側の signal にも中断を伝えている。
    expect(state.calls[0].signal.aborted).toBe(true)
  })

  it('abort の後に Provider が resolve しても reject しても、結果は変わらず unhandled にもならない', async () => {
    for (const late of ['resolve', 'reject'] as const) {
      const state = controlled()
      const work = new AbortController()
      const pending = callAgentProvider(state.provider, payloadFor(ID), work.signal, POLICY)

      work.abort()

      const result = await pending

      if (late === 'resolve') {
        state.resolve('{"action":{"type":"file_write","path":"a.txt","content":"x"}}')
      } else {
        state.reject(new Error(`late failure ${SECRET}`))
      }

      await flush()

      expect(result).toEqual({ ok: false, failure: 'aborted' })
      expect(await pending).toBe(result)
    }

    await new Promise((resolve) => setImmediate(resolve))
    expect(unhandled).toEqual([])
  })

  it('読めない signal は、止まっていると読む', async () => {
    const provider = answering('"ok"')
    const broken = {
      get aborted(): boolean {
        throw new Error('broken')
      }
    } as unknown as AbortSignal

    await expect(callAgentProvider(provider, payloadFor(ID), broken, POLICY)).resolves.toEqual({
      ok: false,
      failure: 'aborted'
    })
    await expect(
      callAgentProvider(provider, payloadFor(ID), undefined as unknown as AbortSignal, POLICY)
    ).resolves.toEqual({ ok: false, failure: 'aborted' })
    expect(provider.calls).toBe(0)
  })

  it('見張れない signal では呼ばない', async () => {
    const provider = answering('"ok"')
    const unwatchable = {
      aborted: false,
      addEventListener: () => {
        throw new Error('cannot watch')
      },
      removeEventListener: () => {}
    } as unknown as AbortSignal

    await expect(callAgentProvider(provider, payloadFor(ID), unwatchable, POLICY)).resolves.toEqual(
      { ok: false, failure: 'aborted' }
    )
    expect(provider.calls).toBe(0)
  })
})

describe('timeout（Loop 側で強制する）', () => {
  it('返さない Provider は Policy の時間で timeout。Provider 側の signal も止め、呼び直さない', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const state = controlled()
    let result: unknown = null
    const pending = callAgentProvider(state.provider, payloadFor(ID), live(), POLICY).then(
      (value) => {
        result = value
        return value
      }
    )

    await vi.advanceTimersByTimeAsync(POLICY.timeoutMs - 1)
    expect(result).toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    expect(result).toEqual({ ok: false, failure: 'timeout' })
    expect(state.calls).toHaveLength(1)
    expect(state.calls[0].signal.aborted).toBe(true)

    // 遅れて届いた応答・失敗は捨てる。
    state.resolve('{"action":{"type":"workspace_status"}}')
    state.reject(new Error('late'))
    await flush()

    expect(await pending).toEqual({ ok: false, failure: 'timeout' })
    expect(state.calls).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('応答が先なら timer は外す（後から timeout に変わらない）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const result = await callAgentProvider(answering('"ok"'), payloadFor(ID), live(), POLICY)

    expect(result).toEqual({ ok: true, text: '"ok"' })
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('応答の大きさ', () => {
  it('上限ちょうどは通り、1文字でも超えれば response-too-large', async () => {
    const exact = 'x'.repeat(POLICY.maxResponseChars)

    await expect(
      callAgentProvider(answering(exact), payloadFor(ID), live(), POLICY)
    ).resolves.toEqual({ ok: true, text: exact })
    await expect(
      callAgentProvider(answering(`${exact}x`), payloadFor(ID), live(), POLICY)
    ).resolves.toEqual({ ok: false, failure: 'response-too-large' })
  })

  it('オブジェクトは JSON にした後の長さで数える', async () => {
    const big = { action: { type: 'complete', answer: 'y'.repeat(POLICY.maxResponseChars) } }

    await expect(
      callAgentProvider(answering(big), payloadFor(ID), live(), POLICY)
    ).resolves.toEqual({
      ok: false,
      failure: 'response-too-large'
    })
  })
})

describe('JSON で表せない応答', () => {
  it('欄が黙って消える値・循環は、直さずに invalid-response', async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    for (const output of [
      undefined,
      { action: { type: 'workspace_status', approved: undefined } },
      { action: { type: 'workspace_status', run: () => 1 } },
      { action: { type: 'workspace_status', id: 1n } },
      { action: { type: 'workspace_status', n: Number.NaN } },
      [undefined],
      circular
    ]) {
      await expect(
        callAgentProvider(answering(output), payloadFor(ID), live(), POLICY)
      ).resolves.toEqual({ ok: false, failure: 'invalid-response' })
    }
  })
})

describe('Provider の失敗', () => {
  it('reject・同期の throw は provider-failed。Error の本文は結果に残らない', async () => {
    const rejecting: AgentProvider = {
      id: ID,
      contextWindowTokens: 32_000,
      next: async () => {
        throw new Error(`401 Unauthorized: key ${SECRET}`)
      }
    }
    const throwing: AgentProvider = {
      id: ID,
      contextWindowTokens: 32_000,
      next: () => {
        throw new Error(`boom ${SECRET}`)
      }
    }

    for (const provider of [rejecting, throwing]) {
      const result = await callAgentProvider(provider, payloadFor(ID), live(), POLICY)

      expect(result).toEqual({ ok: false, failure: 'provider-failed' })
      expect(JSON.stringify(result)).not.toContain(SECRET)
      expect(Object.keys(result).sort()).toEqual(['failure', 'ok'])
    }
  })

  it('Provider・Policy の形が壊れていれば呼ばずに provider-unavailable', async () => {
    const next = vi.fn(async () => '"ok"')
    const providers: unknown[] = [
      null,
      { id: '', contextWindowTokens: 1, next },
      { id: ID, contextWindowTokens: 1, next: 'not a function' },
      {
        get id(): string {
          throw new Error('broken')
        },
        contextWindowTokens: 1,
        next
      }
    ]

    for (const provider of providers) {
      await expect(
        callAgentProvider(provider as AgentProvider, payloadFor(ID), live(), POLICY)
      ).resolves.toEqual({ ok: false, failure: 'provider-unavailable' })
    }

    const policies: unknown[] = [
      null,
      {},
      { timeoutMs: 0, maxResponseChars: 100 },
      { timeoutMs: -1, maxResponseChars: 100 },
      { timeoutMs: Number.NaN, maxResponseChars: 100 },
      { timeoutMs: Number.POSITIVE_INFINITY, maxResponseChars: 100 },
      { timeoutMs: 1.5, maxResponseChars: 100 },
      { timeoutMs: 2_147_483_648, maxResponseChars: 100 },
      { timeoutMs: 1_000, maxResponseChars: 0 },
      { timeoutMs: '1000', maxResponseChars: 100 }
    ]

    for (const policy of policies) {
      await expect(
        callAgentProvider(
          { id: ID, contextWindowTokens: 1, next },
          payloadFor(ID),
          live(),
          policy as AgentProviderCallPolicy
        )
      ).resolves.toEqual({ ok: false, failure: 'provider-unavailable' })
    }

    expect(next).not.toHaveBeenCalled()
  })
})

describe('Adapter が伝える失敗の分類（STEP10-3）', () => {
  const REPORTED = [
    'authentication-failed',
    'authorization-failed',
    'request-rejected',
    'rate-limited',
    'temporary-failure',
    'network-failed'
  ] as const

  function throwing(thrown: unknown, sync = false): AgentProvider {
    return {
      id: ID,
      contextWindowTokens: 32_000,
      next: sync
        ? () => {
            throw thrown
          }
        : async () => {
            throw thrown
          }
    }
  }

  it.each(REPORTED)('AgentProviderError(%s) は、その分類だけになる', async (category) => {
    for (const sync of [false, true]) {
      await expect(
        callAgentProvider(
          throwing(new AgentProviderError(category), sync),
          payloadFor(ID),
          live(),
          POLICY
        )
      ).resolves.toEqual({ ok: false, failure: category })
    }
  })

  it('message・独自の欄は読まない（結果に残らない）', async () => {
    const error = Object.assign(new AgentProviderError('rate-limited'), {
      message: `API KEY=${SECRET}`,
      body: SECRET
    })
    const result = await callAgentProvider(throwing(error), payloadFor(ID), live(), POLICY)

    expect(result).toEqual({ ok: false, failure: 'rate-limited' })
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  it('AgentProviderError の message は固定で、分類以外を受け取らない', () => {
    const error = new AgentProviderError('network-failed')

    expect(error.message).toBe('The AI provider request failed.')
    expect(error.cause).toBeUndefined()
    expect(Object.keys(error).sort()).toEqual(['category', 'name'])
  })

  it('閉じた集合に無い分類・Loop が決める分類を名乗っても provider-failed', async () => {
    for (const category of [
      'aborted',
      'timeout',
      'invalid-payload',
      'retry-forever',
      'toString',
      42
    ]) {
      const error = new AgentProviderError('rate-limited')

      Object.defineProperty(error, 'category', { value: category })

      await expect(
        callAgentProvider(throwing(error), payloadFor(ID), live(), POLICY)
      ).resolves.toEqual({ ok: false, failure: 'provider-failed' })
    }
  })

  it('形だけ真似たもの・category の getter が投げるものは provider-failed', async () => {
    const lookalike = { name: 'AgentProviderError', category: 'rate-limited' }
    const broken = new AgentProviderError('rate-limited')

    Object.defineProperty(broken, 'category', {
      get() {
        throw new Error('broken')
      }
    })

    for (const thrown of [lookalike, broken, new Error('rate-limited'), null, undefined]) {
      await expect(
        callAgentProvider(throwing(thrown), payloadFor(ID), live(), POLICY)
      ).resolves.toEqual({ ok: false, failure: 'provider-failed' })
    }
  })
})
