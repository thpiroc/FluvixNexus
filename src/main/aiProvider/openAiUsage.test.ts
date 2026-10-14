import { describe, expect, it } from 'vitest'
import { AGENT_OUTPUT_MAX_CHARS } from '../agent/agentAction'
import { isAgentProviderOutput, type AgentProvider } from '../agent/agentProvider'
import { callAgentProvider } from '../agent/agentProviderCall'
import {
  issueSafeExternalPayload,
  type SafeExternalPayload
} from '../security/externalSend/safeExternalPayload'
import { OPENAI_PROVIDER_ID, createOpenAiProvider, type OpenAiFetch } from './openAiProvider'
import { readOpenAiUsage } from './openAiResponses'

/**
 * OpenAI の応答の usage（STEP10 Closing。2026-10-14）。
 *
 * **実 OpenAI へは繋がない。** 読むのは `input_tokens` / `output_tokens` /
 * `output_tokens_details.reasoning_tokens` の3つだけで、usage が無い・壊れていても応答は有効。
 */

const KEY = 'fn-synthetic-openai-credential-usage-5d4c3b'
const CANARY = 'fn-synthetic-usage-canary-8e7f6a'
const TEXT = '{"action":{"type":"workspace_status"}}'
const POLICY = { timeoutMs: 120_000, maxResponseChars: AGENT_OUTPUT_MAX_CHARS }

/** STEP10-7 の実 API の応答で見た形（数は同じ・文字列は架空）。 */
const REAL_SHAPE = {
  input_tokens: 701,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens: 30,
  output_tokens_details: { reasoning_tokens: 11 },
  total_tokens: 731
}

function completed(usage: unknown, text: string = TEXT): unknown {
  return {
    id: `resp_${CANARY}`,
    object: 'response',
    status: 'completed',
    error: null,
    billing: { payer: CANARY },
    output: [
      { type: 'reasoning', summary: [] },
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        phase: 'final_answer',
        content: [{ type: 'output_text', text, annotations: [] }]
      }
    ],
    ...(usage === undefined ? {} : { usage })
  }
}

function payload(): SafeExternalPayload {
  return issueSafeExternalPayload(
    OPENAI_PROVIDER_ID,
    [{ kind: 'user-prompt', label: 'user-request', text: 'summarize the workspace' }],
    { secretsMasked: false, maskedCount: 0, categories: [], userNoticeRequired: false }
  )
}

function adapterReturning(body: unknown): AgentProvider {
  const fetch: OpenAiFetch = async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-request-id': CANARY }
    })
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

describe('readOpenAiUsage', () => {
  it('実 API の形から3つの数だけを取り出す（cached・total・他の欄は読まない）', () => {
    const usage = readOpenAiUsage({ ...(completed(REAL_SHAPE) as object) })

    expect(usage).toEqual({ inputTokens: 701, outputTokens: 30, reasoningTokens: 11 })
    expect(Object.isFrozen(usage)).toBe(true)
  })

  it.each([
    ['output_tokens_details が無い', { input_tokens: 5, output_tokens: 3 }],
    [
      'output_tokens_details が null',
      { input_tokens: 5, output_tokens: 3, output_tokens_details: null }
    ],
    ['reasoning_tokens が無い', { input_tokens: 5, output_tokens: 3, output_tokens_details: {} }],
    [
      'reasoning_tokens が null',
      { input_tokens: 5, output_tokens: 3, output_tokens_details: { reasoning_tokens: null } }
    ]
  ])('%s → reasoning は null（入力・出力は使う）', (_name, usage) => {
    expect(readOpenAiUsage({ usage })).toEqual({
      inputTokens: 5,
      outputTokens: 3,
      reasoningTokens: null
    })
  })

  it.each([
    ['usage が無い', {}],
    ['usage が null', { usage: null }],
    ['usage が配列', { usage: [701, 30] }],
    ['input_tokens が無い', { usage: { output_tokens: 30 } }],
    ['input_tokens が文字', { usage: { ...REAL_SHAPE, input_tokens: '701' } }],
    ['output_tokens が負', { usage: { ...REAL_SHAPE, output_tokens: -1 } }],
    ['上限を超える', { usage: { ...REAL_SHAPE, input_tokens: 10_000_001 } }],
    [
      'reasoning が出力より大きい',
      { usage: { ...REAL_SHAPE, output_tokens_details: { reasoning_tokens: 31 } } }
    ],
    [
      'reasoning が文字',
      { usage: { ...REAL_SHAPE, output_tokens_details: { reasoning_tokens: '11' } } }
    ],
    ['output_tokens_details が文字', { usage: { ...REAL_SHAPE, output_tokens_details: 'x' } }],
    ['応答が object でない', 'usage'],
    ['応答が null', null]
  ])('%s → 無い', (_name, raw) => {
    expect(readOpenAiUsage(raw)).toBeUndefined()
  })

  it('getter・prototype の usage は読まない', () => {
    let called = false
    const withGetter = Object.defineProperty({}, 'usage', {
      enumerable: true,
      get: () => {
        called = true
        return REAL_SHAPE
      }
    })

    expect(readOpenAiUsage(withGetter)).toBeUndefined()
    expect(called).toBe(false)
    expect(readOpenAiUsage(Object.create({ usage: REAL_SHAPE }))).toBeUndefined()
  })
})

describe('Adapter（本物の境界を通す）', () => {
  it('usage があれば、文字列はそのままに usage が結果に載る', async () => {
    const result = await callAgentProvider(
      adapterReturning(completed(REAL_SHAPE)),
      payload(),
      new AbortController().signal,
      POLICY
    )

    expect(result).toEqual({
      ok: true,
      text: TEXT,
      usage: { inputTokens: 701, outputTokens: 30, reasoningTokens: 11 }
    })
  })

  it.each([
    ['usage が無い', undefined],
    ['usage が壊れている', { input_tokens: -5, output_tokens: 'x' }],
    ['上限を超える', { input_tokens: 10_000_001, output_tokens: 1 }]
  ])('%s → 応答は有効のまま（失敗にしない・usage の欄が無い）', async (_name, usage) => {
    const result = await callAgentProvider(
      adapterReturning(completed(usage)),
      payload(),
      new AbortController().signal,
      POLICY
    )

    expect(result).toEqual({ ok: true, text: TEXT })
    expect(Object.hasOwn(result, 'usage')).toBe(false)
  })

  it('usage が正しくても、本文の形が壊れていれば invalid-response のまま', async () => {
    const body = { ...(completed(REAL_SHAPE) as object), status: 'incomplete' }

    await expect(
      callAgentProvider(adapterReturning(body), payload(), new AbortController().signal, POLICY)
    ).resolves.toEqual({ ok: false, failure: 'invalid-response' })
  })

  it('next の戻り値は印付きで、文字列と3つの数だけ（Key・Header・本文・request ID は無い）', async () => {
    const output = await adapterReturning(
      completed({ ...REAL_SHAPE, input_tokens_details: { cached_tokens: 0, note: CANARY } })
    ).next(payload(), new AbortController().signal)

    expect(isAgentProviderOutput(output)).toBe(true)
    expect(Object.keys(output as object).sort()).toEqual(['text', 'usage'])
    expect(Object.keys((output as { usage: object }).usage).sort()).toEqual([
      'inputTokens',
      'outputTokens',
      'reasoningTokens'
    ])

    const serialized = JSON.stringify(output)

    for (const secret of [KEY, CANARY, 'Bearer', 'authorization', 'billing', 'resp_']) {
      expect(serialized).not.toContain(secret)
    }
  })
})
