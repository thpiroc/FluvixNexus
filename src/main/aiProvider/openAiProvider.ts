import { isAllowedModelId } from '@shared/aiProvider'
import {
  AGENT_PROVIDER_HTTP_POLICY,
  AgentProviderError,
  isRetryableProviderFailure,
  type AgentProvider,
  type AgentProviderHttpPolicy
} from '../agent/agentProvider'
import {
  isSafeExternalPayload,
  type SafeExternalPayload
} from '../security/externalSend/safeExternalPayload'
import type { AiProviderCredentialUse } from './aiProviderCredentialStore'
import {
  OPENAI_RESPONSES_ENDPOINT,
  buildOpenAiRequestBody,
  cancelBody,
  classifyOpenAiHttpStatus,
  parseRetryAfterMs,
  readBodyWithLimit,
  readOpenAiResponseText
} from './openAiResponses'

/**
 * OpenAI の Provider Adapter（Security Core v1 の STEP10-6。2026-09-25）。
 *
 * ```
 * Agent Loop
 *   ↓ External Send Gate（STEP5）        検査して伏せた SafeExternalPayload（1回きり）
 *   ↓ callAgentProvider（STEP10-2）       providerId の照合・abort / timeout（120 秒）・文字数の上限
 *   ↓ この Adapter の next                 Payload を確かめ直す → 要求の本文 → Credential → fetch
 *   ↓ POST https://api.openai.com/v1/responses（固定）
 *   ↑ 状態の分類・Retry-After・バイト数の上限・応答の形の検査 → 1ターンの文字列（未検査のまま）
 *   ↑ parseAgentTurn → Security Core（Gate）
 * ```
 *
 * ## ここに無いもの
 *
 * - **URL を変える入口**（baseUrl / endpoint / proxy / host の欄は options に無い）。送り先は
 *   `OPENAI_RESPONSES_ENDPOINT` だけ
 * - **SDK**（`fetch` を直に使う。依存は増えていない）
 * - **自前の timeout**（120 秒は境界の1か所。Adapter は境界から渡る signal を fetch と本文の読み取りに
 *   つなぎ、止まったら通信ごと止める。Adapter が signal を守らなくても、境界は待たずに戻る）
 * - **呼び直し**（Agent Loop が Policy で決め、毎回 Context → Gate → 新しい Payload からやり直す）
 * - **Credential の保持**。Key は `withCredential` の callback の中で Header に載せるだけで、
 *   この object・状態・Error・ログに残らない。呼ぶたびに Credential Store から復号し直す
 *
 * ## 失敗は分類だけ
 *
 * `AgentProviderError(category)` で閉じた分類を伝える。HTTP の本文・Error の本文・Header・Key は
 * 運ばない。失敗の応答の本文は**読まずに捨てる**。
 */

export const OPENAI_PROVIDER_ID = 'openai'

/**
 * OpenAI の Model が1回に受け取れる Context の大きさ（Token）。Agent の Context はこの約 70% に
 * 収める（main/agent/agentContext.ts）。
 *
 * **FN Agent v1 の意図的な Policy 上限**（3つの Model で共通。2026-09-26 確定）。OpenAI 公式の
 * context window は 1,050,000（最大入力 922,000）だが、v1 では安全側・Context の肥大化の抑制・
 * コストの予測しやすさのために 128,000 を使う。拡張は v1.1 以降に利用状況を見て再検討する（DESIGN.md）。
 */
export const OPENAI_CONTEXT_WINDOW_TOKENS = 128_000

/** 通信の関数（本物は globalThis.fetch。テストは偽物を渡す）。 */
export type OpenAiFetch = (url: string, init: RequestInit) => Promise<Response>

/** Credential Store の `withCredential` を openai に結び付けたもの。 */
export type OpenAiCredentialAccess = <T>(use: (apiKey: string) => T) => AiProviderCredentialUse<T>

export interface OpenAiProviderOptions {
  /** allowlist にある Model（無ければ Adapter を作らない）。 */
  readonly model: string
  readonly fetch: OpenAiFetch
  readonly withCredential: OpenAiCredentialAccess
  /** 応答のバイト数の上限（既定は AGENT_PROVIDER_HTTP_POLICY）。 */
  readonly httpPolicy?: AgentProviderHttpPolicy
  /** 今の時刻（Retry-After の HTTP-date 用。既定は Date.now）。 */
  readonly now?: () => number
}

/** OpenAI の Adapter を作る。Model が allowlist に無ければ null（作らない）。 */
export function createOpenAiProvider(options: OpenAiProviderOptions): AgentProvider | null {
  const model: unknown = options.model

  if (!isAllowedModelId(OPENAI_PROVIDER_ID, model)) {
    return null
  }

  const send = options.fetch
  const withCredential = options.withCredential
  const maxBytes = readMaxBytes(options.httpPolicy)
  const now = options.now ?? Date.now

  async function next(payload: SafeExternalPayload, signal: AbortSignal): Promise<unknown> {
    // 境界も確かめるが、Adapter でももう一度（Gate の発行した・自分宛ての Payload だけを送る）。
    if (!isSafeExternalPayload(payload) || payload.providerId !== OPENAI_PROVIDER_ID) {
      throw new AgentProviderError('request-rejected')
    }

    if (signal.aborted) {
      throw new Error('aborted')
    }

    // 本文は Payload の parts だけから作る（await の前に。Payload はこの呼び出しの間だけ有効）。
    const body = buildOpenAiRequestBody(model as string, payload)

    /*
      Key はこの callback の中でだけ Header に載る。戻り値は fetch の Promise で、Key そのものは
      返らない。Credential が無い・壊れている・復号できないなら fetch を呼ばない。
    */
    const requested = withCredential((apiKey) =>
      send(OPENAI_RESPONSES_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body,
        signal,
        // 転送（3xx）を追わない ── Credential を別の場所へ運ばせない。3xx は request-rejected。
        redirect: 'manual'
      })
    )

    if (!requested.ok) {
      throw new AgentProviderError('authentication-failed')
    }

    let response: Response

    try {
      response = await requested.value
    } catch {
      throw failureOfTransport(signal)
    }

    if (!(response instanceof Response)) {
      throw new AgentProviderError('invalid-response')
    }

    if (response.status < 200 || response.status > 299) {
      const category = classifyOpenAiHttpStatus(response.status)
      const retryAfterMs = isRetryableProviderFailure(category)
        ? parseRetryAfterMs(response.headers, now())
        : undefined

      // 失敗の応答の本文は読まない（分類にも使わない・どこにも残さない）。
      await cancelBody(response)

      throw new AgentProviderError(category, { retryAfterMs })
    }

    if (!/^application\/json\b/i.test(response.headers.get('content-type') ?? '')) {
      await cancelBody(response)
      throw new AgentProviderError('invalid-response')
    }

    let read: Awaited<ReturnType<typeof readBodyWithLimit>>

    try {
      read = await readBodyWithLimit(response, maxBytes)
    } catch {
      throw failureOfTransport(signal)
    }

    if (read.kind === 'too-large') {
      throw new AgentProviderError('response-too-large')
    }

    let text: string | null

    try {
      text = readOpenAiResponseText(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.bytes))
      )
    } catch {
      text = null
    }

    if (text === null) {
      throw new AgentProviderError('invalid-response')
    }

    return text
  }

  return Object.freeze({
    id: OPENAI_PROVIDER_ID,
    contextWindowTokens: OPENAI_CONTEXT_WINDOW_TOKENS,
    next
  })
}

/**
 * 通信・本文の読み取りが投げたとき。止めた（stop / halt / timeout）なら中断で、境界がすでに
 * `aborted` / `timeout` を決めている（ここで何を投げても結果は変わらない）。それ以外は通信の失敗。
 */
function failureOfTransport(signal: AbortSignal): Error {
  return signal.aborted ? new Error('aborted') : new AgentProviderError('network-failed')
}

function readMaxBytes(policy: AgentProviderHttpPolicy | undefined): number {
  const value: unknown = (policy ?? AGENT_PROVIDER_HTTP_POLICY).maxResponseBytes

  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : AGENT_PROVIDER_HTTP_POLICY.maxResponseBytes
}
