import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiProviderCredentialState, AiProviderPreferences } from '@shared/aiProvider'
import { AGENT_OUTPUT_MAX_CHARS } from '../agent/agentAction'
import { callAgentProvider } from '../agent/agentProviderCall'
import { issueSafeExternalPayload } from '../security/externalSend/safeExternalPayload'

/**
 * 設定と Credential から正式な Provider を作る（STEP10-6）。
 *
 * service（Electron）だけを差し替える。作った Adapter は本物で、`globalThis.fetch` を偽物にして
 * 呼ぶ ── 組み立てで送り先が変わらないこと・Key が Store からだけ来ることを確かめる。
 */

const KEY = 'fn-synthetic-openai-credential-runtime-4d3c2b'

const state = vi.hoisted(() => ({
  preferences: { providerId: null, modelId: null } as AiProviderPreferences,
  credential: 'not-set' as AiProviderCredentialState,
  withCredential: vi.fn()
}))

vi.mock('./aiProviderService', () => ({
  readAiProviderPreferences: () => state.preferences,
  getAiProviderCredentialStore: () => ({
    getState: () => state.credential,
    withCredential: state.withCredential
  })
}))

const { createConfiguredAgentProvider, isConfiguredAgentProviderAvailable } =
  await import('./aiProviderRuntime')

beforeEach(() => {
  state.preferences = { providerId: 'openai', modelId: 'gpt-6-sol' }
  state.credential = 'set'
  state.withCredential.mockReset()
  state.withCredential.mockImplementation((providerId: string, use: (key: string) => unknown) =>
    providerId === 'openai' ? { ok: true, value: use(KEY) } : { ok: false, failure: 'not-set' }
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('作れる条件', () => {
  it('Provider・Model・API Key が揃えば OpenAI の Adapter', () => {
    for (const modelId of ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']) {
      state.preferences = { providerId: 'openai', modelId }

      expect(createConfiguredAgentProvider()?.id).toBe('openai')
      expect(isConfiguredAgentProviderAvailable()).toBe(true)
    }
  })

  it.each([
    ['Provider 未選択', { providerId: null, modelId: null }, 'set'],
    ['Model が allowlist に無い', { providerId: 'openai', modelId: 'gpt-anything' }, 'set'],
    ['Model が壊れて未選択', { providerId: 'openai', modelId: null }, 'set'],
    ['Scripted を名乗る', { providerId: 'scripted', modelId: 'gpt-6-sol' }, 'set'],
    ['API Key 未設定', { providerId: 'openai', modelId: 'gpt-6-sol' }, 'not-set'],
    ['API Key を使えない', { providerId: 'openai', modelId: 'gpt-6-sol' }, 'unusable']
  ] as const)('%s → 作らない', (_name, preferences, credential) => {
    state.preferences = preferences as AiProviderPreferences
    state.credential = credential

    expect(createConfiguredAgentProvider()).toBeNull()
    expect(isConfiguredAgentProviderAvailable()).toBe(false)
  })

  it('作るときに Key を取り出さない（通信の直前に1回ずつ）', () => {
    createConfiguredAgentProvider()

    expect(state.withCredential).not.toHaveBeenCalled()
  })
})

describe('組み立てた Adapter', () => {
  it('globalThis.fetch で固定の Endpoint へ送り、Key は openai の Credential から毎回取り出す', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            object: 'response',
            status: 'completed',
            error: null,
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: '{"action":{"type":"workspace_status"}}' }]
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    )

    vi.stubGlobal('fetch', fetch)
    state.preferences = { providerId: 'openai', modelId: 'gpt-6-luna' }

    const provider = createConfiguredAgentProvider()

    if (provider === null) {
      throw new Error('not created')
    }

    for (let round = 0; round < 2; round += 1) {
      const payload = issueSafeExternalPayload(
        'openai',
        [{ kind: 'user-prompt', label: null, text: 'x' }],
        { secretsMasked: false, maskedCount: 0, categories: [], userNoticeRequired: false }
      )

      await expect(
        callAgentProvider(provider, payload, new AbortController().signal, {
          timeoutMs: 120_000,
          maxResponseChars: AGENT_OUTPUT_MAX_CHARS
        })
      ).resolves.toMatchObject({ ok: true })
    }

    expect(fetch.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      'https://api.openai.com/v1/responses',
      'https://api.openai.com/v1/responses'
    ])
    expect(
      JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    ).toMatchObject({ model: 'gpt-6-luna' })
    expect(state.withCredential).toHaveBeenCalledTimes(2)
    expect(state.withCredential.mock.calls.map((call) => call[0])).toEqual(['openai', 'openai'])
  })
})
