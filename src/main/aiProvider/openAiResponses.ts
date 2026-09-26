import type { SafeExternalPayload } from '../security/externalSend/safeExternalPayload'
import {
  AGENT_PROVIDER_RETRY_AFTER_MAX_MS,
  type AgentProviderReportedFailure
} from '../agent/agentProvider'

/**
 * OpenAI Responses API の要求と応答の形（STEP10-6。Electron にも fs にも依存しない）。
 *
 * ここは**形だけ**を持つ ── 何を送るかは External Send Gate が発行した `SafeExternalPayload` が
 * 決め、応答を Action として信じるかは Agent Loop の `parseAgentTurn` と Security Core が決める。
 * 通信・Credential・中断は openAiProvider.ts。
 */

/**
 * 送り先（Adapter の中の定数。**これ以外の URL へは送らない**）。
 *
 * 設定・Workspace・環境変数・Provider の応答・Renderer のどこからも変えられない
 * （aiProviderCredentialSurface.test.ts / openAiProvider.test.ts が固定している）。API Key を任意の
 * URL へ送らせない（SSRF・Credential の持ち出し）ための要。
 */
export const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses'

/**
 * FN Agent の1ターン（`{"action": {...}}`）の JSON Schema（Structured Outputs の strict）。
 *
 * **これは OpenAI へのお願いで、検査ではない。** strict な Schema に沿った応答でも、Agent Loop の
 * `parseAgentTurn`（長さ・知らない欄・種類）と Security Core の Gate を必ず通る。Schema と
 * `parseAgentTurn` がずれていないことは openAiResponses.test.ts が見ている。
 *
 * strict では、すべての欄が必須・知らない欄は不可になる。省略できる欄（`file_read` の行）は
 * `null` を許し、`parseAgentTurn` は `null` を「指定なし」と読む。
 */
export const OPENAI_AGENT_TURN_SCHEMA = deepFreeze({
  type: 'object',
  properties: {
    action: {
      anyOf: [
        actionSchema('workspace_status', {}),
        actionSchema('workspace_list', { path: { type: 'string' } }),
        actionSchema('file_read', {
          path: { type: 'string' },
          startLine: { type: ['integer', 'null'] },
          endLine: { type: ['integer', 'null'] }
        }),
        actionSchema('file_search', { query: { type: 'string' } }),
        actionSchema('file_write', { path: { type: 'string' }, content: { type: 'string' } }),
        actionSchema('terminal_run', {
          command: { type: 'string' },
          args: { type: 'array', items: { type: 'string' } },
          cwd: { type: 'string' }
        }),
        actionSchema('complete', { answer: { type: 'string' } })
      ]
    }
  },
  required: ['action'],
  additionalProperties: false
})

function actionSchema(type: string, properties: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    properties: { type: { type: 'string', enum: [type] }, ...properties },
    required: ['type', ...Object.keys(properties)],
    additionalProperties: false
  }
}

/**
 * Responses API の要求の本文。
 *
 * **入れるのは `model` / `input` / `text`（Structured Outputs）/ `store` だけ。**
 *
 * - `input` は `SafeExternalPayload` の `parts` だけから作る（Adapter が Workspace・Terminal・
 *   Secret・Renderer を追加で読むことはない）。FN の指示文（`agent-instruction`）は `developer`、
 *   それ以外（利用者の指示・Tool の結果・ファイル）は `user` の発言として、種類の見出しを付けて渡す
 * - `tools` は**送らない**（Web Search・Computer Use・Hosted Shell・MCP・File Search・
 *   Code Interpreter のどれも OpenAI 側で有効にしない。副作用は FN の Security Core だけが扱う）
 * - `store: false` … OpenAI 側に応答を保存させない（後から取り出す使い方をしない）
 * - Credential は本文に入らない（Header だけ。openAiProvider.ts）
 */
export function buildOpenAiRequestBody(model: string, payload: SafeExternalPayload): string {
  const input = payload.parts.map((part) => ({
    type: 'message',
    role: part.kind === 'agent-instruction' ? 'developer' : 'user',
    content: [{ type: 'input_text', text: labelled(part.kind, part.label, part.text) }]
  }))

  return JSON.stringify({
    model,
    input,
    text: {
      format: {
        type: 'json_schema',
        name: 'fn_agent_turn',
        strict: true,
        schema: OPENAI_AGENT_TURN_SCHEMA
      }
    },
    store: false
  })
}

function labelled(kind: string, label: string | null, text: string): string {
  return `[${kind}${label === null ? '' : `: ${label}`}]\n${text}`
}

/**
 * HTTP の状態を閉じた分類へ（STEP10-3 の Policy に合わせる）。
 *
 * ```
 * 401        authentication-failed  呼び直さない
 * 403        authorization-failed   呼び直さない
 * 408 / 409  temporary-failure      呼び直す（要求の時間切れ・競合。時間を置けば通りうる）
 * 429        rate-limited           呼び直す
 * 5xx        temporary-failure      呼び直す
 * その他     request-rejected       呼び直さない（400 / 404 / 413 / 422・転送（3xx）など）
 * ```
 *
 * 本文は読まない（分類に使わない・保存もしない）。
 */
export function classifyOpenAiHttpStatus(status: number): AgentProviderReportedFailure {
  if (status === 401) {
    return 'authentication-failed'
  }

  if (status === 403) {
    return 'authorization-failed'
  }

  if (status === 429) {
    return 'rate-limited'
  }

  if (status === 408 || status === 409 || (status >= 500 && status <= 599)) {
    return 'temporary-failure'
  }

  return 'request-rejected'
}

/** Header の値の長さの上限（これより長い Retry-After は読まない）。 */
const RETRY_AFTER_MAX_LENGTH = 64

/**
 * Retry-After を「待ってほしいミリ秒」として読む（読めなければ undefined）。
 *
 * - `retry-after-ms`（整数のミリ秒）を先に、無ければ `retry-after`（整数の秒、または HTTP-date）
 * - 負・小数・長すぎる・日付として読めない値は読まない（呼ぶ側は既定の 1 秒を使う）
 * - **`AGENT_PROVIDER_RETRY_AFTER_MAX_MS`（60 秒）に飽和させる**（「少なくとも 60 秒」の意味。
 *   巨大な値をそのまま持ち回さない）。Agent Loop は 30 秒以内なら指定の時間以上待って呼び直し、
 *   超えるなら（飽和した値を含む）呼び直さない（STEP10-6。縮めて早く送り直さない）
 *
 * 生の値は返さない・保存しない（Audit にも載らない）。
 */
export function parseRetryAfterMs(headers: Headers, nowMs: number): number | undefined {
  const milliseconds = readHeader(headers, 'retry-after-ms')

  if (milliseconds !== null && /^\d{1,12}$/.test(milliseconds)) {
    return clampRetryAfter(Number(milliseconds))
  }

  const value = readHeader(headers, 'retry-after')

  if (value === null) {
    return undefined
  }

  if (/^\d{1,12}$/.test(value)) {
    return clampRetryAfter(Number(value) * 1000)
  }

  // HTTP-date（`Wed, 21 Oct 2026 07:28:00 GMT`）。数だけの値・小数を日付として読まない。
  if (/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) {
    const at = Date.parse(value)

    return Number.isFinite(at) ? clampRetryAfter(Math.max(0, at - nowMs)) : undefined
  }

  return undefined
}

function readHeader(headers: Headers, name: string): string | null {
  try {
    const value = headers.get(name)

    return value === null || value.length > RETRY_AFTER_MAX_LENGTH ? null : value.trim()
  } catch {
    return null
  }
}

function clampRetryAfter(milliseconds: number): number | undefined {
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0
    ? Math.min(milliseconds, AGENT_PROVIDER_RETRY_AFTER_MAX_MS)
    : undefined
}

/** 応答の本文を上限まで読んだ結果。 */
export type LimitedBody =
  { readonly kind: 'ok'; readonly bytes: Uint8Array } | { readonly kind: 'too-large' }

/**
 * 応答の本文を、**受信しながらバイト数を数えて**読む。
 *
 * `Content-Length` が上限を超えていれば読み始めない。読みながら上限を超えた時点で読むのをやめ
 * （stream を cancel し）、それまでに読んだ部分は捨てる ── 部分的な応答は解釈しない。
 * 読み取りの失敗（切断・中断）はそのまま投げる（呼ぶ側が signal を見て分類する）。
 */
export async function readBodyWithLimit(
  response: Response,
  maxBytes: number
): Promise<LimitedBody> {
  const declared = readHeader(response.headers, 'content-length')

  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    await cancelBody(response)
    return { kind: 'too-large' }
  }

  const body = response.body

  if (body === null) {
    return { kind: 'ok', bytes: new Uint8Array(0) }
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    if (!(value instanceof Uint8Array)) {
      await reader.cancel().catch(() => undefined)
      throw new TypeError('unexpected chunk')
    }

    total += value.byteLength

    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return { kind: 'too-large' }
    }

    chunks.push(value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return { kind: 'ok', bytes }
}

/** 読まない本文を捨てる（失敗の応答の本文は読まない）。 */
export async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // 捨てられなくても、結果は変わらない。
  }
}

/** Responses API の応答で、FN が受け取る `output` の件数の上限（reasoning の要約を含む）。 */
const OUTPUT_ITEMS_MAX = 16

/**
 * Responses API の応答（JSON として読んだもの）から、FN Agent の1ターンの文字列を取り出す。
 * **形が1か所でも違えば null**（Fail Closed）。
 *
 * ```
 * { "object": "response", "status": "completed", "error": null,
 *   "output": [ { "type": "reasoning", … }?,                       ← 読まずに飛ばす
 *               { "type": "message", "role": "assistant",
 *                 "content": [ { "type": "output_text", "text": "…" } ] } ] }
 * ```
 *
 * - `status` が `completed` 以外（incomplete・failed など）は受け取らない
 * - `message` はちょうど1つ・`content` は `output_text` ちょうど1つ・文字列が空でない
 * - `refusal`・Tool の呼び出し（`function_call` / `web_search_call` など）・知らない種類は受け取らない
 *   （Tool は有効にしていないので、来ること自体が想定外）
 *
 * 取り出した文字列は**未検査の出力**のまま Agent Loop へ渡る（parseAgentTurn → Security Core）。
 */
export function readOpenAiResponseText(raw: unknown): string | null {
  if (!isRecord(raw) || raw.object !== 'response' || raw.status !== 'completed') {
    return null
  }

  if (raw.error !== undefined && raw.error !== null) {
    return null
  }

  const output = raw.output

  if (!Array.isArray(output) || output.length === 0 || output.length > OUTPUT_ITEMS_MAX) {
    return null
  }

  const messages: Record<string, unknown>[] = []

  for (const item of output) {
    if (!isRecord(item)) {
      return null
    }

    if (item.type === 'reasoning') {
      continue
    }

    if (item.type !== 'message') {
      return null
    }

    messages.push(item)
  }

  if (messages.length !== 1) {
    return null
  }

  const [message] = messages

  if (message.role !== 'assistant') {
    return null
  }

  if (message.status !== undefined && message.status !== 'completed') {
    return null
  }

  const content = message.content

  if (!Array.isArray(content) || content.length !== 1) {
    return null
  }

  const [part] = content

  if (!isRecord(part) || part.type !== 'output_text' || typeof part.text !== 'string') {
    return null
  }

  return part.text.trim().length === 0 ? null : part.text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) {
      deepFreeze(entry)
    }

    Object.freeze(value)
  }

  return value
}
