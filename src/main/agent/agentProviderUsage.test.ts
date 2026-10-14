import { describe, expect, it } from 'vitest'
import {
  issueSafeExternalPayload,
  type SafeExternalPayload
} from '../security/externalSend/safeExternalPayload'
import { AGENT_OUTPUT_MAX_CHARS } from './agentAction'
import {
  AGENT_CONTEXT_INPUT_RATIO,
  agentInstruction,
  createAgentContext,
  estimateTokens,
  type AgentContextBuildInput
} from './agentContext'
import {
  AGENT_PROVIDER_USAGE_MAX_TOKENS,
  createAgentProviderOutput,
  isAgentProviderOutput,
  readAgentProviderUsage,
  type AgentProvider
} from './agentProvider'
import { callAgentProvider } from './agentProviderCall'

/**
 * Token の実測値（STEP10 Closing。2026-10-14）。
 *
 * - 確かめるのは3つの数だけ（各 10,000,000 以下・reasoning は出力以下・無ければ null）
 * - 1つでも外れたら usage 全体が「無い」。**応答そのものは有効のまま**
 * - 印付きの戻り値だけが usage を運ぶ（形が同じだけの object は今までどおり JSON に直す）
 * - Context Manager は参考として持つだけで、build() の結果は変わらない
 */

const TEXT = '{"action":{"type":"workspace_status"}}'
const POLICY = { timeoutMs: 120_000, maxResponseChars: AGENT_OUTPUT_MAX_CHARS }
const USAGE = { inputTokens: 701, outputTokens: 30, reasoningTokens: 11 }

function payload(): SafeExternalPayload {
  return issueSafeExternalPayload(
    'fn-usage-test',
    [{ kind: 'user-prompt', label: 'user-request', text: 'x' }],
    { secretsMasked: false, maskedCount: 0, categories: [], userNoticeRequired: false }
  )
}

function providerOf(next: AgentProvider['next']): AgentProvider {
  return { id: 'fn-usage-test', contextWindowTokens: 128_000, next }
}

function live(): AbortSignal {
  return new AbortController().signal
}

describe('readAgentProviderUsage', () => {
  it('3つの数を凍結した新しい object で返す（渡された object・余計な欄は持ち回さない）', () => {
    const raw = { ...USAGE, totalTokens: 731, requestId: 'req_x' }
    const usage = readAgentProviderUsage(raw)

    expect(usage).toEqual(USAGE)
    expect(usage).not.toBe(raw)
    expect(Object.isFrozen(usage)).toBe(true)
    expect(Object.keys(usage as object).sort()).toEqual([
      'inputTokens',
      'outputTokens',
      'reasoningTokens'
    ])
  })

  it.each([
    ['欄が無い', { inputTokens: 1, outputTokens: 2 }],
    ['undefined', { inputTokens: 1, outputTokens: 2, reasoningTokens: undefined }],
    ['null', { inputTokens: 1, outputTokens: 2, reasoningTokens: null }]
  ])('reasoning が%s → null（入力・出力は使う）', (_name, raw) => {
    expect(readAgentProviderUsage(raw)).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      reasoningTokens: null
    })
  })

  it('0 と上限ちょうどは通る', () => {
    const max = AGENT_PROVIDER_USAGE_MAX_TOKENS

    expect(AGENT_PROVIDER_USAGE_MAX_TOKENS).toBe(10_000_000)
    expect(readAgentProviderUsage({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0 })).toEqual(
      { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 }
    )
    expect(
      readAgentProviderUsage({ inputTokens: max, outputTokens: max, reasoningTokens: max })
    ).toEqual({ inputTokens: max, outputTokens: max, reasoningTokens: max })
  })

  it.each([
    ['負の数', -1],
    ['小数', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['文字', '701'],
    ['bigint', 701n],
    ['上限を超える', AGENT_PROVIDER_USAGE_MAX_TOKENS + 1],
    ['安全でない整数', Number.MAX_SAFE_INTEGER + 2],
    ['無い', undefined],
    ['null', null]
  ])('入力・出力が%s → 全体が無い', (_name, bad) => {
    expect(readAgentProviderUsage({ ...USAGE, inputTokens: bad })).toBeUndefined()
    expect(readAgentProviderUsage({ ...USAGE, outputTokens: bad })).toBeUndefined()
  })

  it.each([
    ['負の数', -1],
    ['小数', 0.5],
    ['文字', '11'],
    ['上限を超える', AGENT_PROVIDER_USAGE_MAX_TOKENS + 1],
    ['出力より大きい', 31]
  ])('reasoning が%s → 全体が無い', (_name, bad) => {
    expect(readAgentProviderUsage({ ...USAGE, reasoningTokens: bad })).toBeUndefined()
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['数', 701],
    ['文字列', 'usage'],
    ['配列', [701, 30, 11]]
  ])('object でない（%s）→ 無い', (_name, raw) => {
    expect(readAgentProviderUsage(raw)).toBeUndefined()
  })

  it('getter は呼ばず、prototype の値も読まない', () => {
    let called = false
    const withGetter = Object.defineProperty({ outputTokens: 30 }, 'inputTokens', {
      enumerable: true,
      get: () => {
        called = true
        return 701
      }
    })

    expect(readAgentProviderUsage(withGetter)).toBeUndefined()
    expect(called).toBe(false)
    expect(readAgentProviderUsage(Object.create(USAGE))).toBeUndefined()
    expect(readAgentProviderUsage(JSON.parse('{"__proto__":{"inputTokens":1}}'))).toBeUndefined()
  })

  it('罠のある Proxy でも投げない', () => {
    const trap = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error('trap')
        }
      }
    )

    expect(readAgentProviderUsage(trap)).toBeUndefined()
  })
})

describe('createAgentProviderOutput（印付きの戻り値）', () => {
  it('文字列と確かめた usage だけを持つ凍結した値で、印が付く', () => {
    const output = createAgentProviderOutput(TEXT, { ...USAGE, body: 'secret' })

    expect(output).toEqual({ text: TEXT, usage: USAGE })
    expect(Object.keys(output).sort()).toEqual(['text', 'usage'])
    expect(Object.isFrozen(output)).toBe(true)
    expect(isAgentProviderOutput(output)).toBe(true)
  })

  it('usage が無い・壊れていても戻り値は作る（usage の欄ごと無い）', () => {
    for (const usage of [undefined, null, { inputTokens: -1, outputTokens: 1 }, 'x']) {
      const output = createAgentProviderOutput(TEXT, usage)

      expect(output).toEqual({ text: TEXT })
      expect(Object.hasOwn(output, 'usage')).toBe(false)
      expect(isAgentProviderOutput(output)).toBe(true)
    }
  })

  it('文字列でない text では作らない', () => {
    expect(() => createAgentProviderOutput(42 as unknown as string, USAGE)).toThrow(TypeError)
  })

  it('形が同じだけの object・写しには印が無い', () => {
    const output = createAgentProviderOutput(TEXT, USAGE)

    expect(isAgentProviderOutput({ text: TEXT, usage: USAGE })).toBe(false)
    expect(isAgentProviderOutput(JSON.parse(JSON.stringify(output)))).toBe(false)
    expect(isAgentProviderOutput({ ...output })).toBe(false)
    expect(isAgentProviderOutput(null)).toBe(false)
    expect(isAgentProviderOutput(TEXT)).toBe(false)
  })
})

describe('callAgentProvider（境界）', () => {
  it('印付きの戻り値 → 文字列と確かめ直した usage を返す', async () => {
    const result = await callAgentProvider(
      providerOf(async () => createAgentProviderOutput(TEXT, USAGE)),
      payload(),
      live(),
      POLICY
    )

    expect(result).toEqual({ ok: true, text: TEXT, usage: USAGE })
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('印付きでも usage が無ければ、今までと同じ結果（usage の欄が無い）', async () => {
    const result = await callAgentProvider(
      providerOf(async () => createAgentProviderOutput(TEXT)),
      payload(),
      live(),
      POLICY
    )

    expect(result).toEqual({ ok: true, text: TEXT })
    expect(Object.hasOwn(result, 'usage')).toBe(false)
  })

  it('文字列の応答（Scripted Provider と同じ）は usage を持たない', async () => {
    const result = await callAgentProvider(
      providerOf(async () => TEXT),
      payload(),
      live(),
      POLICY
    )

    expect(result).toEqual({ ok: true, text: TEXT })
  })

  it('偽装した { text, usage } は usage にならず、今までどおり JSON の文字列に直す', async () => {
    const forged = { text: TEXT, usage: USAGE }
    const result = await callAgentProvider(
      providerOf(async () => forged),
      payload(),
      live(),
      POLICY
    )

    expect(result).toEqual({ ok: true, text: JSON.stringify(forged) })
  })

  it('印付きでも文字数の上限は効く（usage があっても response-too-large）', async () => {
    const result = await callAgentProvider(
      providerOf(async () => createAgentProviderOutput('x'.repeat(11), USAGE)),
      payload(),
      live(),
      { timeoutMs: 120_000, maxResponseChars: 10 }
    )

    expect(result).toEqual({ ok: false, failure: 'response-too-large' })
  })

  it('止めた後に届いた印付きの戻り値は捨てる（aborted のまま・usage も無い）', async () => {
    const controller = new AbortController()
    let release: () => void = () => {}
    const pending = callAgentProvider(
      providerOf(
        () =>
          new Promise((resolve) => {
            release = () => resolve(createAgentProviderOutput(TEXT, USAGE))
          })
      ),
      payload(),
      controller.signal,
      POLICY
    )

    controller.abort()
    release()

    await expect(pending).resolves.toEqual({ ok: false, failure: 'aborted' })
  })
})

describe('Context Manager は参考として持つだけ', () => {
  const BUILD: AgentContextBuildInput = {
    providerId: 'fn-scripted-dev',
    permissionMode: 'ask',
    loopsUsed: 0,
    loopLimit: 20
  }

  /** 詳細 800 Token の結果を3つ足した Context（畳まないと入らない大きさの Window）。 */
  function filled(windowTokens: number): ReturnType<typeof createAgentContext> {
    const context = createAgentContext('x', windowTokens)

    for (const turn of [1, 2, 3]) {
      context.add(turn, {
        category: 'terminal',
        label: `t${turn}`,
        header: 'action: terminal_run\nstatus: ok',
        detail: 'z'.repeat(2_400)
      })
    }

    return context
  }

  const fixed = estimateTokens(agentInstruction(BUILD)) + estimateTokens('x')
  const roomy = 128_000
  const tight = Math.ceil((fixed + 1_300) / AGENT_CONTEXT_INPUT_RATIO)
  const tooSmall = Math.ceil(fixed / AGENT_CONTEXT_INPUT_RATIO) - 1

  it('最初は null・記録すると読める・壊れた値は「無い」（前の値も捨てる）', () => {
    const context = createAgentContext('x', roomy)

    expect(context.lastUsage()).toBeNull()

    context.recordUsage(USAGE)
    expect(context.lastUsage()).toEqual(USAGE)

    context.recordUsage({ inputTokens: -1, outputTokens: 1 })
    expect(context.lastUsage()).toBeNull()

    context.recordUsage(USAGE)
    context.recordUsage(undefined)
    expect(context.lastUsage()).toBeNull()
  })

  it.each([
    ['余裕のある Window', roomy],
    ['畳めば入る Window', tight],
    ['畳んでも入らない Window', tooSmall]
  ])('%s：usage の有無・大小で build() の結果は変わらない', (_name, windowTokens) => {
    const baseline = JSON.stringify(filled(windowTokens).build(BUILD))

    for (const usage of [
      { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
      { inputTokens: AGENT_PROVIDER_USAGE_MAX_TOKENS, outputTokens: 1, reasoningTokens: null },
      USAGE
    ]) {
      const context = filled(windowTokens)

      context.recordUsage(usage)
      expect(JSON.stringify(context.build(BUILD))).toBe(baseline)
    }
  })
})
