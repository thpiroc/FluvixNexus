import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createExternalSendGate } from '../security/externalSend/externalSendGate'
import { issueSafeExternalPayload } from '../security/externalSend/safeExternalPayload'
import { createAgentLoop } from './agentLoop'
import {
  AGENT_PROVIDER_RETRY_AFTER_MAX_MS,
  AgentProviderError,
  readRetryAfterMs,
  type AgentProvider
} from './agentProvider'
import { callAgentProvider } from './agentProviderCall'

/**
 * Retry-After の目安が境界を通るときの確かめ直し（STEP10-6）。
 *
 * Adapter が渡すのは解析済みの整数（ミリ秒）だけで、境界はそれを**呼び直してよい失敗のときだけ**・
 * 範囲の中のときだけ結果に載せる。Loop は上限（30 秒）以内ならその時間以上待って呼び直し、超えるなら
 * 呼び直さない（下の describe と openAiProvider.loop.test.ts）。
 */

const ID = 'fn-test-provider'
const POLICY = { timeoutMs: 60_000, maxResponseChars: 100_000 }

function payload(): ReturnType<typeof issueSafeExternalPayload> {
  return issueSafeExternalPayload(ID, [{ kind: 'user-prompt', label: null, text: 'x' }], {
    secretsMasked: false,
    maskedCount: 0,
    categories: [],
    userNoticeRequired: false
  })
}

function throwing(error: unknown): AgentProvider {
  return {
    id: ID,
    contextWindowTokens: 32_000,
    next: async () => {
      throw error
    }
  }
}

describe('AgentProviderError の retryAfterMs', () => {
  it('0 以上・上限以下の整数だけを持つ（それ以外は欄ごと無い）', () => {
    expect(new AgentProviderError('rate-limited', { retryAfterMs: 1_500 }).retryAfterMs).toBe(1_500)
    expect(new AgentProviderError('rate-limited', { retryAfterMs: 0 }).retryAfterMs).toBe(0)

    for (const value of [-1, 1.5, Number.NaN, Infinity, AGENT_PROVIDER_RETRY_AFTER_MAX_MS + 1]) {
      const error = new AgentProviderError('rate-limited', { retryAfterMs: value })

      expect(Object.keys(error).sort()).toEqual(['category', 'name'])
      expect(error.retryAfterMs).toBeUndefined()
    }

    expect(readRetryAfterMs('1000')).toBeUndefined()
  })
})

describe('境界', () => {
  it('呼び直してよい失敗のときだけ、目安を結果に載せる', async () => {
    await expect(
      callAgentProvider(
        throwing(new AgentProviderError('rate-limited', { retryAfterMs: 2_000 })),
        payload(),
        new AbortController().signal,
        POLICY
      )
    ).resolves.toEqual({ ok: false, failure: 'rate-limited', retryAfterMs: 2_000 })

    await expect(
      callAgentProvider(
        throwing(new AgentProviderError('authentication-failed', { retryAfterMs: 2_000 })),
        payload(),
        new AbortController().signal,
        POLICY
      )
    ).resolves.toEqual({ ok: false, failure: 'authentication-failed' })
  })

  it('後から書き換えた範囲外の値・投げる getter は載せない', async () => {
    // 正規の constructor を通らずに作った（prototype だけ借りた）もの。範囲の確認を迂回できない。
    const huge = Object.create(AgentProviderError.prototype, {
      category: { value: 'temporary-failure' },
      retryAfterMs: { value: 10 ** 12 }
    }) as AgentProviderError

    const broken = Object.create(AgentProviderError.prototype, {
      category: { value: 'network-failed' },
      retryAfterMs: {
        get() {
          throw new Error('broken')
        }
      }
    }) as AgentProviderError

    await expect(
      callAgentProvider(throwing(huge), payload(), new AbortController().signal, POLICY)
    ).resolves.toEqual({ ok: false, failure: 'temporary-failure' })
    await expect(
      callAgentProvider(throwing(broken), payload(), new AbortController().signal, POLICY)
    ).resolves.toEqual({ ok: false, failure: 'provider-failed' })
  })
})

describe('Loop の待ち方（Policy の上限の扱い。2026-09-26 確定）', () => {
  /** 1回目は Retry-After 付きの rate-limited、2回目は complete を返す Provider。 */
  function limited(retryAfterMs: number): AgentProvider & { readonly calls: () => number } {
    let count = 0

    return {
      id: ID,
      contextWindowTokens: 32_000,
      calls: () => count,
      next: async () => {
        count += 1

        if (count === 1) {
          throw new AgentProviderError('rate-limited', { retryAfterMs })
        }

        return { action: { type: 'complete', answer: 'done' } }
      }
    }
  }

  function loopOf(
    provider: AgentProvider,
    retryPolicy: Record<string, number>
  ): ReturnType<typeof createAgentLoop> {
    const gate = createExternalSendGate({
      readPolicy: () => ({ permissionMode: 'ask' }),
      recordEvent: () => {}
    })

    return createAgentLoop({
      createProvider: () => provider,
      isProviderAvailable: () => true,
      isAgentEnabled: () => true,
      hasWorkspace: () => true,
      readPermissionMode: () => 'ask',
      sendToProvider: (request, deliver) => gate.send(request, deliver),
      providerCallPolicy: POLICY,
      providerRetryPolicy: retryPolicy as never,
      toolbox: {} as never,
      isSideEffectInProgress: () => false,
      cancelPendingApprovals: () => 0,
      recordEvent: () => {},
      emitState: () => {}
    })
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function run(
    retryAfterMs: number,
    retryPolicy: Record<string, number>
  ): Promise<{ readonly calls: number; readonly status: string }> {
    const provider = limited(retryAfterMs)
    const loop = loopOf(provider, retryPolicy)

    loop.start('x')
    // 偽の時計を 2 分進める（上限の中の待ちはここで明ける。実時間は待たない）。
    await vi.advanceTimersByTimeAsync(120_000)
    await loop.whenIdle()

    return { calls: provider.calls(), status: loop.getState().status }
  }

  it('上限の中なら呼び直し、上限を超えるなら呼び直さない（30 秒へ縮めない）', async () => {
    const policy = { maxAttempts: 3, retryDelayMs: 1_000, maxRetryAfterMs: 30_000 }

    expect(await run(30_000, policy)).toMatchObject({ calls: 2, status: 'completed' })
    expect(await run(30_001, policy)).toMatchObject({ calls: 1, status: 'failed' })
    expect(await run(AGENT_PROVIDER_RETRY_AFTER_MAX_MS, policy)).toMatchObject({
      calls: 1,
      status: 'failed'
    })
  })

  it('上限の欄が無い Policy では、上限は retryDelayMs（それより長い Retry-After では呼び直さない）', async () => {
    const policy = { maxAttempts: 3, retryDelayMs: 1_000 }

    expect(await run(500, policy)).toMatchObject({ calls: 2, status: 'completed' })
    expect(await run(1_000, policy)).toMatchObject({ calls: 2, status: 'completed' })
    expect(await run(1_001, policy)).toMatchObject({ calls: 1, status: 'failed' })
  })

  it('上限が天井（60 秒）以上の Policy は読まない（飽和した値を上限の中と取り違えない）', async () => {
    const policy = {
      maxAttempts: 3,
      retryDelayMs: 1_000,
      maxRetryAfterMs: AGENT_PROVIDER_RETRY_AFTER_MAX_MS
    }

    expect(await run(AGENT_PROVIDER_RETRY_AFTER_MAX_MS, policy)).toMatchObject({
      calls: 1,
      status: 'failed'
    })
    expect(await run(5_000, policy)).toMatchObject({ calls: 1, status: 'failed' })
  })
})
