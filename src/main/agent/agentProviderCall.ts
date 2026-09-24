import { isSafeExternalPayload } from '../security/externalSend/safeExternalPayload'
import {
  AgentProviderError,
  isAgentProviderReportedFailure,
  type AgentProvider,
  type AgentProviderCallPolicy,
  type AgentProviderCallResult,
  type AgentProviderFailure
} from './agentProvider'

/**
 * Provider の呼び出しの境界（Security Core v1 の STEP10-2。Electron にも fs にも依存しない）。
 *
 * **Agent Loop から `AgentProvider.next` を呼ぶのはここだけ**（agentProviderCallSurface.test.ts が
 * 見ている）。Loop は Provider を直に await せず、ここが返す分類済みの結果だけを受け取る。
 *
 * ```
 * callAgentProvider(provider, payload, signal, policy)
 *   1. Provider・Policy の形              壊れていれば呼ばない（provider-unavailable）
 *   2. 作業の signal                      止まっていれば呼ばない（aborted）
 *   3. SafeExternalPayload か             写し・偽造・取り消し済みは送らない（invalid-payload）
 *   4. payload.providerId === provider.id 別の Provider 宛ては送らない（provider-mismatch）
 *   5. next(payload, 呼び出しの signal)    ここまで await を挟まない（3 と 4 の間に取り消されない）
 *   6. 応答・作業の signal の abort・timeout のうち、最初に成立したものだけを採る
 *   7. 応答を JSON の文字列にし、上限を確かめる（response-too-large / invalid-response）
 * ```
 *
 * ## Provider が signal を守らなくても待たない
 *
 * Provider の Promise そのものは止められない。止めるのは**待つこと**のほう ── 作業の signal が
 * abort されるか timeout が来た時点で、Provider の応答を待たずに結果を返す。その後に Provider が
 * resolve しても reject しても、結果は1度決まったものから変わらない（遅れた応答は捨てる）。
 * Provider の Promise には最初から受け手を付けておくため、遅れた reject が unhandled rejection に
 * なることもない。
 *
 * Provider へ渡す signal は、作業の signal ともこの呼び出しの timeout とも連動する別の signal。
 * 実 Provider（STEP10-6）はこれで HTTP の要求を中断できる。
 *
 * ## 失敗は分類だけ
 *
 * **Error の本文・HTTP の本文・Credential・Provider が返した任意の文字列は持たない。**
 * 投げられたものからは、`AgentProviderError` の分類（閉じた集合）だけを読み、それ以外は中身を
 * 読まずに `provider-failed` へ畳む。message・cause・stack・独自の欄は読まない。
 * **この関数は投げない。**
 *
 * ## ここでしないこと
 *
 * 再試行。失敗の後に Provider をもう一度呼ぶかどうかは Agent Loop が再試行の Policy
 * （STEP10-3。agentProvider.ts の `isRetryableProviderFailure`）で決め、呼び直すときも
 * Context → External Send Gate → 新しい Payload からやり直す。この関数は1回しか呼ばない。実 HTTP の応答をバイト数で途中で打ち切る処理は実 Provider Adapter
 * （STEP10-6）が持つ。
 */
export function callAgentProvider(
  provider: AgentProvider,
  payload: unknown,
  signal: AbortSignal,
  policy: AgentProviderCallPolicy
): Promise<AgentProviderCallResult> {
  const limits = readPolicy(policy)
  const target = readProvider(provider)

  if (limits === null || target === null) {
    return failed('provider-unavailable')
  }

  if (isAborted(signal)) {
    return failed('aborted')
  }

  // 型だけに頼らない。Gate が発行し、まだ取り消されていない Payload だけを送る。
  if (!isSafeExternalPayload(payload)) {
    return failed('invalid-payload')
  }

  if (readPayloadProviderId(payload) !== target.id) {
    return failed('provider-mismatch')
  }

  return new Promise<AgentProviderCallResult>((resolve) => {
    const call = new AbortController()
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const onAbort = (): void => {
      settle({ ok: false, failure: 'aborted' })
    }

    function settle(result: AgentProviderCallResult): void {
      if (settled) {
        return
      }

      settled = true

      if (timer !== null) {
        clearTimeout(timer)
      }

      try {
        signal.removeEventListener('abort', onAbort)
      } catch {
        // 外せなくても、settled が2度目を止める。
      }

      resolve(Object.freeze(result))

      // Provider にも中断を伝える（守るかどうかは Provider 次第。守らなくても結果は変わらない）。
      try {
        call.abort()
      } catch {
        // 結果はもう決まっている。
      }
    }

    try {
      signal.addEventListener('abort', onAbort, { once: true })
    } catch {
      // 見張れない signal では呼ばない。
      settle({ ok: false, failure: 'aborted' })
      return
    }

    // 見張りを付けた後にもう一度（付ける前に止まっていた場合）。
    if (isAborted(signal)) {
      settle({ ok: false, failure: 'aborted' })
      return
    }

    timer = setTimeout(() => {
      settle({ ok: false, failure: 'timeout' })
    }, limits.timeoutMs)

    let pending: Promise<unknown>

    try {
      pending = Promise.resolve(target.next.call(provider, payload, call.signal))
    } catch (thrown) {
      settle({ ok: false, failure: failureOf(thrown) })
      return
    }

    /*
      受け手は最初から付けておく。先に abort / timeout で決まった後に resolve / reject しても、
      settled が止めるので結果は変わらず、reject が unhandled rejection にもならない。
    */
    pending.then(
      (output) => {
        if (settled) {
          return
        }

        let result: AgentProviderCallResult

        try {
          result = readResponse(output, limits.maxResponseChars)
        } catch {
          result = { ok: false, failure: 'invalid-response' }
        }

        settle(result)
      },
      (thrown: unknown) => {
        settle({ ok: false, failure: failureOf(thrown) })
      }
    )
  })
}

/**
 * 投げられたものを分類にする。読むのは `AgentProviderError` の `category` だけで、閉じた集合に
 * 無い値・読めない値・ほかの例外は `provider-failed`（分類できない失敗）。
 */
function failureOf(thrown: unknown): AgentProviderFailure {
  try {
    if (thrown instanceof AgentProviderError) {
      const category: unknown = thrown.category

      if (isAgentProviderReportedFailure(category)) {
        return category
      }
    }
  } catch {
    // getter が投げた・prototype が壊れている。分類できない失敗として扱う。
  }

  return 'provider-failed'
}

function failed(failure: AgentProviderFailure): Promise<AgentProviderCallResult> {
  return Promise.resolve(Object.freeze({ ok: false as const, failure }))
}

/** Policy の値を1度だけ読む。使えない値なら `null`（呼ばない）。 */
function readPolicy(policy: unknown): AgentProviderCallPolicy | null {
  try {
    if (typeof policy !== 'object' || policy === null) {
      return null
    }

    const { timeoutMs, maxResponseChars } = policy as Record<string, unknown>

    if (!isPositiveInteger(timeoutMs) || timeoutMs > TIMER_MAX_MS) {
      return null
    }

    if (!isPositiveInteger(maxResponseChars)) {
      return null
    }

    return { timeoutMs, maxResponseChars }
  } catch {
    return null
  }
}

/** setTimeout が扱える上限（これを超えるとすぐに発火する）。 */
const TIMER_MAX_MS = 2_147_483_647

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** Provider の id と next を1度だけ読む（getter で呼ぶたびに変わる値を使わない）。 */
function readProvider(
  provider: unknown
): { readonly id: string; readonly next: AgentProvider['next'] } | null {
  try {
    if (typeof provider !== 'object' || provider === null) {
      return null
    }

    const { id, next } = provider as Record<string, unknown>

    if (typeof id !== 'string' || id.length === 0 || typeof next !== 'function') {
      return null
    }

    return { id, next: next as AgentProvider['next'] }
  } catch {
    return null
  }
}

function readPayloadProviderId(payload: { readonly providerId: string }): unknown {
  try {
    return payload.providerId
  } catch {
    return undefined
  }
}

/** 渡されたのに読めない signal は、止まっていると読む。 */
function isAborted(signal: unknown): boolean {
  if (typeof signal !== 'object' || signal === null) {
    return true
  }

  try {
    return (signal as AbortSignal).aborted !== false
  } catch {
    return true
  }
}

/**
 * 応答を JSON の文字列にして、上限を確かめる。
 *
 * 文字列はそのまま。それ以外は **1度だけ** JSON へ直す（getter・toJSON はここで1度だけ動き、
 * Loop へは写しの文字列だけが渡る）。JSON で正確に表せない値（`undefined`・関数・symbol・
 * bigint・有限でない数・循環）は、直すと欄が黙って消えて Schema の「知らない欄を拒む」が
 * 効かなくなるため、直さずに `invalid-response` にする。
 */
function readResponse(output: unknown, maxChars: number): AgentProviderCallResult {
  let text: string

  if (typeof output === 'string') {
    text = output
  } else {
    try {
      const json: unknown = JSON.stringify(output, strictJsonValue)

      if (typeof json !== 'string') {
        return { ok: false, failure: 'invalid-response' }
      }

      text = json
    } catch {
      return { ok: false, failure: 'invalid-response' }
    }
  }

  if (text.length > maxChars) {
    return { ok: false, failure: 'response-too-large' }
  }

  return { ok: true, text }
}

function strictJsonValue(_key: string, value: unknown): unknown {
  switch (typeof value) {
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      throw new TypeError('not representable as JSON')
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError('not representable as JSON')
      }

      return value
    default:
      return value
  }
}
