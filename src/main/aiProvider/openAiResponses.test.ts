import { describe, expect, it, vi } from 'vitest'
import { AGENT_ACTION_TYPES, parseAgentTurn } from '../agent/agentAction'
import { issueSafeExternalPayload } from '../security/externalSend/safeExternalPayload'
import {
  OPENAI_AGENT_TURN_SCHEMA,
  OPENAI_RESPONSES_ENDPOINT,
  buildOpenAiRequestBody,
  classifyOpenAiHttpStatus,
  parseRetryAfterMs,
  readBodyWithLimit,
  readOpenAiResponseText
} from './openAiResponses'

/**
 * OpenAI Responses API の要求と応答の形（STEP10-6）。通信は一切しない。
 */

const NOW = Date.parse('2026-09-25T00:00:00Z')

type JsonSchema = {
  readonly type?: string | readonly string[]
  readonly properties?: Readonly<Record<string, JsonSchema>>
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean
  readonly anyOf?: readonly JsonSchema[]
  readonly enum?: readonly string[]
  readonly items?: JsonSchema
}

const schema = OPENAI_AGENT_TURN_SCHEMA as JsonSchema
const variants = schema.properties?.action?.anyOf ?? []

/** Schema の1つの型から、strict な Structured Outputs が返しうる値を1つ作る。 */
function sampleOf(node: JsonSchema): unknown {
  if (node.enum !== undefined) {
    return node.enum[0]
  }

  const type = Array.isArray(node.type) ? node.type[0] : node.type

  switch (type) {
    case 'object':
      return Object.fromEntries(
        Object.entries(node.properties ?? {}).map(([key, value]) => [key, sampleOf(value)])
      )
    case 'array':
      return [sampleOf(node.items ?? { type: 'string' })]
    case 'integer':
      return 1
    case 'string':
      return 'x'
    default:
      throw new Error(`unexpected schema type ${String(type)}`)
  }
}

function responseOf(output: unknown, extra: Record<string, unknown> = {}): unknown {
  return { id: 'resp_x', object: 'response', status: 'completed', error: null, output, ...extra }
}

function message(content: unknown, extra: Record<string, unknown> = {}): unknown {
  return { type: 'message', role: 'assistant', status: 'completed', content, ...extra }
}

const TEXT = '{"action":{"type":"workspace_status"}}'

describe('Endpoint', () => {
  it('Responses API の公式の URL の定数1つ', () => {
    expect(OPENAI_RESPONSES_ENDPOINT).toBe('https://api.openai.com/v1/responses')
  })
})

describe('Structured Outputs の JSON Schema', () => {
  it('strict の形（root は object・知らない欄は不可・すべて必須）で、凍結されている', () => {
    expect(schema.type).toBe('object')
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(['action'])
    expect(Object.isFrozen(schema)).toBe(true)
    expect(Object.isFrozen(variants)).toBe(true)

    for (const variant of variants) {
      expect(variant.type).toBe('object')
      expect(variant.additionalProperties).toBe(false)
      expect([...(variant.required ?? [])].sort()).toEqual(
        Object.keys(variant.properties ?? {}).sort()
      )
    }
  })

  it('Action の種類は parseAgentTurn の閉じた集合と同じ', () => {
    expect(variants.map((variant) => variant.properties?.type?.enum?.[0]).sort()).toEqual([
      ...AGENT_ACTION_TYPES
    ])
  })

  it('Schema に沿った値は、どの種類も parseAgentTurn を通る（Schema と検査がずれていない）', () => {
    for (const variant of variants) {
      const output = JSON.stringify({ action: sampleOf(variant) })

      expect(parseAgentTurn(output), output).toMatchObject({ ok: true })
    }
  })

  it('file_read の行は null で「指定なし」（strict は欄を省けない）', () => {
    expect(
      parseAgentTurn(
        '{"action":{"type":"file_read","path":"a.ts","startLine":null,"endLine":null}}'
      )
    ).toEqual({
      ok: true,
      action: { type: 'file_read', path: 'a.ts', startLine: null, endLine: null }
    })
  })

  it('Schema に沿っていても、検査は緩まない（知らない欄・長すぎる値は parseAgentTurn が拒む）', () => {
    expect(parseAgentTurn('{"action":{"type":"workspace_status","approved":true}}')).toMatchObject({
      ok: false,
      reason: 'invalid-action'
    })
    expect(
      parseAgentTurn(JSON.stringify({ action: { type: 'file_search', query: 'x'.repeat(201) } }))
    ).toMatchObject({ ok: false })
  })
})

describe('要求の本文', () => {
  const payload = issueSafeExternalPayload(
    'openai',
    [
      { kind: 'agent-instruction', label: 'fn-agent-instruction', text: 'RULES' },
      { kind: 'user-prompt', label: 'user-request', text: 'fix the bug ***REDACTED***' },
      { kind: 'tool-result', label: null, text: 'action: workspace_status' }
    ],
    { secretsMasked: true, maskedCount: 1, categories: [], userNoticeRequired: true }
  )

  it('model / input / text / store だけ（tools も tool_choice も無い）', () => {
    const body = JSON.parse(buildOpenAiRequestBody('gpt-6-sol', payload)) as Record<string, unknown>

    expect(Object.keys(body).sort()).toEqual(['input', 'model', 'store', 'text'])
    expect(body.model).toBe('gpt-6-sol')
    expect(body.store).toBe(false)
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('tool_choice')
    expect(body.text).toEqual({
      format: {
        type: 'json_schema',
        name: 'fn_agent_turn',
        strict: true,
        schema: OPENAI_AGENT_TURN_SCHEMA
      }
    })
  })

  it('input は Payload の parts だけから作る（指示文は developer、ほかは user）', () => {
    const body = JSON.parse(buildOpenAiRequestBody('gpt-6-luna', payload)) as {
      input: { type: string; role: string; content: { type: string; text: string }[] }[]
    }

    expect(body.input).toEqual([
      {
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: '[agent-instruction: fn-agent-instruction]\nRULES' }]
      },
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: '[user-prompt: user-request]\nfix the bug ***REDACTED***' }
        ]
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '[tool-result]\naction: workspace_status' }]
      }
    ])
  })
})

describe('HTTP の状態の分類', () => {
  it.each([
    [400, 'request-rejected'],
    [401, 'authentication-failed'],
    [403, 'authorization-failed'],
    [404, 'request-rejected'],
    [408, 'temporary-failure'],
    [409, 'temporary-failure'],
    [413, 'request-rejected'],
    [422, 'request-rejected'],
    [429, 'rate-limited'],
    [500, 'temporary-failure'],
    [502, 'temporary-failure'],
    [503, 'temporary-failure'],
    [504, 'temporary-failure'],
    [599, 'temporary-failure'],
    [301, 'request-rejected'],
    [307, 'request-rejected'],
    [0, 'request-rejected']
  ] as const)('%i → %s', (status, category) => {
    expect(classifyOpenAiHttpStatus(status)).toBe(category)
  })
})

describe('Retry-After', () => {
  const headers = (entries: Record<string, string>): Headers => new Headers(entries)

  it('整数の秒・retry-after-ms（こちらを先に）・HTTP-date を読む', () => {
    expect(parseRetryAfterMs(headers({ 'retry-after': '3' }), NOW)).toBe(3_000)
    expect(parseRetryAfterMs(headers({ 'retry-after-ms': '1500' }), NOW)).toBe(1_500)
    expect(parseRetryAfterMs(headers({ 'retry-after-ms': '250', 'retry-after': '9' }), NOW)).toBe(
      250
    )
    expect(
      parseRetryAfterMs(headers({ 'retry-after': 'Fri, 25 Sep 2026 00:00:05 GMT' }), NOW)
    ).toBe(5_000)
    expect(
      parseRetryAfterMs(headers({ 'retry-after': 'Thu, 24 Sep 2026 23:59:00 GMT' }), NOW)
    ).toBe(0)
  })

  it('巨大な値は上限（60 秒）で切る', () => {
    expect(parseRetryAfterMs(headers({ 'retry-after': '86400' }), NOW)).toBe(60_000)
    expect(parseRetryAfterMs(headers({ 'retry-after-ms': '999999999999' }), NOW)).toBe(60_000)
    expect(
      parseRetryAfterMs(headers({ 'retry-after': 'Wed, 25 Sep 2030 00:00:00 GMT' }), NOW)
    ).toBe(60_000)
  })

  it('負・小数・文字・空・長すぎる・形の違う日付は読まない', () => {
    for (const value of [
      '-1',
      '1.5',
      '1e3',
      'abc',
      '',
      ' ',
      '0x10',
      '9'.repeat(13),
      '2026-09-25T00:00:05Z',
      'Fri, 25 Sep 2026 00:00:05 PST',
      '1'.repeat(80)
    ]) {
      expect(parseRetryAfterMs(headers({ 'retry-after': value }), NOW), value).toBeUndefined()
    }

    expect(parseRetryAfterMs(headers({}), NOW)).toBeUndefined()
  })
})

describe('応答の形（Fail Closed）', () => {
  it('output_text を1つだけ持つ assistant の message から文字列を取り出す', () => {
    expect(
      readOpenAiResponseText(responseOf([message([{ type: 'output_text', text: TEXT }])]))
    ).toBe(TEXT)
  })

  it('reasoning の項目は読まずに飛ばす', () => {
    expect(
      readOpenAiResponseText(
        responseOf([
          { type: 'reasoning', summary: [] },
          message([{ type: 'output_text', text: TEXT, annotations: [] }])
        ])
      )
    ).toBe(TEXT)
  })

  const text = [{ type: 'output_text', text: TEXT }]

  it.each([
    ['object でない', 'x'],
    ['null', null],
    ['配列', [text]],
    ['object が response でない', responseOf([message(text)], { object: 'chat.completion' })],
    ['status が incomplete', responseOf([message(text)], { status: 'incomplete' })],
    ['status が failed', responseOf([message(text)], { status: 'failed' })],
    ['error がある', responseOf([message(text)], { error: { message: 'boom' } })],
    ['output が無い', { object: 'response', status: 'completed' }],
    ['output が空', responseOf([])],
    ['output が配列でない', responseOf({ 0: message(text) })],
    ['output が多すぎる', responseOf(Array.from({ length: 17 }, () => ({ type: 'reasoning' })))],
    ['message が2つ', responseOf([message(text), message(text)])],
    ['message が無い（reasoning だけ）', responseOf([{ type: 'reasoning' }])],
    ['Tool の呼び出し', responseOf([{ type: 'function_call', name: 'x', arguments: '{}' }])],
    ['Web Search', responseOf([{ type: 'web_search_call' }, message(text)])],
    ['知らない種類', responseOf([{ type: 'computer_call' }, message(text)])],
    ['項目が object でない', responseOf(['message'])],
    ['role が assistant でない', responseOf([message(text, { role: 'user' })])],
    ['message が in_progress', responseOf([message(text, { status: 'in_progress' })])],
    ['content が2つ', responseOf([message([...text, ...text])])],
    ['content が空', responseOf([message([])])],
    ['refusal', responseOf([message([{ type: 'refusal', refusal: 'no' }])])],
    ['text が文字列でない', responseOf([message([{ type: 'output_text', text: 42 }])])],
    ['text が空白だけ', responseOf([message([{ type: 'output_text', text: '  \n' }])])]
  ])('%s → null', (_name, raw) => {
    expect(readOpenAiResponseText(raw)).toBeNull()
  })
})

describe('バイト数の上限（受信しながら数える）', () => {
  function streamed(chunks: readonly Uint8Array[]): {
    readonly response: Response
    readonly pulled: () => number
    readonly cancelled: () => boolean
  } {
    let index = 0
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index]
        index += 1

        if (chunk === undefined) {
          controller.close()
        } else {
          controller.enqueue(chunk)
        }
      },
      cancel() {
        cancelled = true
      }
    })

    return {
      response: new Response(body, { status: 200 }),
      pulled: () => index,
      cancelled: () => cancelled
    }
  }

  const chunk = (size: number): Uint8Array => new Uint8Array(size).fill(0x61)

  it('上限ちょうどまでは読む', async () => {
    const { response } = streamed([chunk(4), chunk(4)])

    const read = await readBodyWithLimit(response, 8)

    expect(read.kind).toBe('ok')
    expect(read.kind === 'ok' ? read.bytes.byteLength : -1).toBe(8)
  })

  it('超えた時点で読むのをやめて stream を cancel し、部分を返さない', async () => {
    const chunks = Array.from({ length: 100 }, () => chunk(4))
    const { response, pulled, cancelled } = streamed(chunks)

    await expect(readBodyWithLimit(response, 10)).resolves.toEqual({ kind: 'too-large' })
    expect(cancelled()).toBe(true)
    // 100 個のうち、上限を超えるまでの数個しか要求していない（全文を読み込んでいない）。
    expect(pulled()).toBeLessThan(10)
  })

  it('Content-Length が上限を超えていれば、読み始めない', async () => {
    const pull = vi.fn()
    const response = new Response(new ReadableStream({ pull }), {
      status: 200,
      headers: { 'content-length': '1000' }
    })

    await expect(readBodyWithLimit(response, 10)).resolves.toEqual({ kind: 'too-large' })
    expect(pull.mock.calls.length).toBeLessThanOrEqual(1)
  })
})
