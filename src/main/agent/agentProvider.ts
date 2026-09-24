import type { SafeExternalPayload } from '../security/externalSend'
import { AGENT_OUTPUT_MAX_CHARS } from './agentAction'

/**
 * FN Agent が次の Action を尋ねる相手（AI Provider）の契約（Security Core v1 の STEP9 / STEP10）。
 *
 * **Provider は信頼しない。** Provider が返すものは未検査の出力で、Agent Loop の Schema と
 * Security Core の Gate を必ず通る。Provider を呼ぶのは Main だけで、Renderer から Provider・
 * Payload・signal・応答へ届く口は無い。
 *
 * ```
 * Agent Loop
 *   ↓ sendThroughExternalGate（STEP5）     検査して伏せた SafeExternalPayload（1回きり）
 *   ↓ callAgentProvider（STEP10。agentProviderCall.ts）
 *       Payload を確かめ直す・providerId を照合する・abort / timeout を Loop 側で強制する・
 *       応答の大きさを確かめる・失敗は閉じた分類だけで返す
 *   ↓ AgentProvider.next                   ← この契約
 * ```
 *
 * **`next` を呼んでよいのは `callAgentProvider` だけ**（agentProviderCallSurface.test.ts が
 * 見ている）。Agent Loop も Provider を直に await しない。
 *
 * ## STEP10 前半（10-1〜10-3）と後半
 *
 * 実 Provider の Adapter・Credential Store（API Key の保存）・Model の選択は STEP10 後半
 * （10-5 / 10-6）。Provider の API Key はこの契約にも Payload にも入らない（認証は Adapter が
 * Header で行い、Credential は Prompt・Context・Audit・Error のどれにも入れない。DESIGN.md §6.4）。
 */
export interface AgentProvider {
  /**
   * Provider の識別子（External Send Gate の `providerId`。小文字・数字・ハイフン・40 文字まで）。
   * Audit の `subject` に載る。**`callAgentProvider` は Payload の `providerId` とこれが同じで
   * なければ `next` を呼ばない**（別の Provider 宛ての Payload を送らない）。
   */
  readonly id: string
  /**
   * モデルが1回に受け取れる Context の大きさ（Token）。入力の Budget はこの約 70%
   * （main/agent/agentContext.ts）。
   */
  readonly contextWindowTokens: number
  /**
   * 次の Action を尋ねる。返り値は**未検査の出力**（JSON の文字列、または JSON で表せる値）。
   *
   * `signal` は停止・Workspace の切り替え・timeout で中断される。中断されたら、結果を返さずに
   * 投げてよい。**signal を守らない Provider でも Agent Loop は待たない** ── 待つのをやめるのは
   * `callAgentProvider` の側で、遅れて届いた応答・失敗は捨てる。
   *
   * 失敗の種類を伝えるときは `AgentProviderError`（下）を投げる。それ以外の投げ方は、中身を
   * 読まずに `provider-failed`（分類できない失敗。呼び直さない）になる。
   */
  readonly next: (payload: SafeExternalPayload, signal: AbortSignal) => Promise<unknown>
}

/**
 * Provider Adapter が「どう失敗したか」を伝えられる分類（閉じた集合。STEP10-3）。
 *
 * 実 Adapter（STEP10-6）が HTTP の状態・通信の失敗をここへ写す。**写すのは種類だけで、
 * HTTP の本文・Error の本文・Header・Credential は渡さない**（渡す欄が無い）。
 *
 * ```
 * authentication-failed  認証できない（HTTP 401・API Key の誤り）          呼び直さない
 * authorization-failed   権限が無い（HTTP 403・Model を使えない）          呼び直さない
 * request-rejected       要求そのものが受け付けられない（その他の 4xx）    呼び直さない
 * rate-limited           回数の制限（HTTP 429）                            呼び直してよい
 * temporary-failure      Provider 側の一時的な失敗（HTTP 5xx・過負荷）     呼び直してよい
 * network-failed         通信が成り立たなかった（接続・DNS・TLS・切断）    呼び直してよい
 * ```
 */
export type AgentProviderReportedFailure =
  | 'authentication-failed'
  | 'authorization-failed'
  | 'request-rejected'
  | 'rate-limited'
  | 'temporary-failure'
  | 'network-failed'

const REPORTED_FAILURES: readonly AgentProviderReportedFailure[] = Object.freeze([
  'authentication-failed',
  'authorization-failed',
  'network-failed',
  'rate-limited',
  'request-rejected',
  'temporary-failure'
])

/** Adapter が伝えてよい分類か（Object の prototype の名前などを分類と読まない）。 */
export function isAgentProviderReportedFailure(
  value: unknown
): value is AgentProviderReportedFailure {
  return typeof value === 'string' && (REPORTED_FAILURES as readonly string[]).includes(value)
}

/**
 * Provider Adapter が失敗の種類を伝えるための例外。
 *
 * **本文を持たない。** message は固定の文言で、引数は分類だけ。原因の Error（`cause`）も
 * 受け取らない ── HTTP の本文・Error の本文・Credential が、この例外を通って Loop・Audit・
 * Renderer へ運ばれる形を作らない。`callAgentProvider` はここから `category` だけを読み、
 * 知らない値なら `provider-failed` として扱う。
 */
export class AgentProviderError extends Error {
  readonly category: AgentProviderReportedFailure

  constructor(category: AgentProviderReportedFailure) {
    super('The AI provider request failed.')
    this.name = 'AgentProviderError'
    this.category = category
  }
}

/**
 * Provider の呼び出しが失敗した理由（閉じた集合）。
 *
 * **「どう失敗したか」だけを持つ。** Error の本文・HTTP の本文・Credential・Provider が返した
 * 任意の文字列は、この分類にも結果の型にも入らない（持つ欄が無い）。
 *
 * ```
 * aborted               作業の signal が止まった（停止・Workspace の切り替え）
 * timeout               Policy の時間内に応答が無かった
 * invalid-payload       Gate が発行した・まだ使われていない SafeExternalPayload ではない
 * provider-mismatch     Payload の providerId が Provider の id と違う（別の Provider 宛て）
 * provider-unavailable  Provider・Policy の形が壊れていて、安全に呼べない
 * provider-failed       Provider が投げた・reject した（分類できない失敗）
 * response-too-large    応答が Policy の上限を超えた
 * invalid-response      応答を JSON の文字列として正確に表せない（循環・関数・undefined など）
 * （ほかに Adapter が伝える AgentProviderReportedFailure の6つ）
 * ```
 *
 * 呼び直すかどうかは `isRetryableProviderFailure`（下）の1か所で決まる。
 */
export type AgentProviderFailure =
  | 'aborted'
  | 'timeout'
  | 'invalid-payload'
  | 'provider-mismatch'
  | 'provider-unavailable'
  | 'provider-failed'
  | 'response-too-large'
  | 'invalid-response'
  | AgentProviderReportedFailure

/**
 * 呼び直してよい失敗か（STEP10-3。2026-09-24 確定）。
 *
 * **呼び直すのは、時間を置けば通りうる3つだけ**（回数の制限・Provider 側の一時的な失敗・通信の
 * 失敗）。Security・契約・設定の失敗（Payload・宛先・形・大きさ・認証・権限・拒否）と、分類
 * できない失敗は呼び直さない ── 呼び直しで隠すと、同じ誤りを黙って繰り返すことになる。
 * `aborted`（停止・halt）と `timeout` も呼び直さない。
 *
 * `Record` で全部の分類を書かせているため、分類を足すと型検査でここの判断を求められる。
 */
const RETRYABLE: Readonly<Record<AgentProviderFailure, boolean>> = Object.freeze({
  aborted: false,
  timeout: false,
  'invalid-payload': false,
  'provider-mismatch': false,
  'provider-unavailable': false,
  'provider-failed': false,
  'response-too-large': false,
  'invalid-response': false,
  'authentication-failed': false,
  'authorization-failed': false,
  'request-rejected': false,
  'rate-limited': true,
  'temporary-failure': true,
  'network-failed': true
})

export const AGENT_PROVIDER_FAILURES: readonly AgentProviderFailure[] = Object.freeze(
  (Object.keys(RETRYABLE) as AgentProviderFailure[]).sort()
)

export function isRetryableProviderFailure(failure: unknown): boolean {
  return (
    typeof failure === 'string' &&
    Object.hasOwn(RETRYABLE, failure) &&
    RETRYABLE[failure as AgentProviderFailure]
  )
}

/**
 * Provider の呼び出し1回の結果（`callAgentProvider` が返す）。
 *
 * 成功なら応答を **JSON の文字列**として持つ（文字列の応答はそのまま、それ以外は1度だけ
 * JSON へ直した写し）。Agent Loop はこの文字列を Schema（parseAgentTurn）へ渡す ──
 * Provider のオブジェクトそのもの（getter・Proxy・prototype）を Loop へ持ち込まない。
 */
export type AgentProviderCallResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly failure: AgentProviderFailure }

/**
 * Provider の呼び出しの Policy（Loop 側で強制する値）。
 *
 * 値はこの1か所にだけ置き、Agent Loop へは依存として渡す（テストは短い値に差し替える）。
 */
export interface AgentProviderCallPolicy {
  /** 応答を待つ上限（ミリ秒）。過ぎたら `timeout`。 */
  readonly timeoutMs: number
  /** 応答（JSON の文字列）の文字数の上限。超えたら `response-too-large`。 */
  readonly maxResponseChars: number
}

/**
 * 今の呼び出しの Policy。
 *
 * - `timeoutMs` … **120 秒（2026-09-24 正式採用）。** 停止・halt・Workspace の切り替えでは
 *   待たずに終わる（callAgentProvider が作業の signal で即座に戻る）
 * - `maxResponseChars` … Schema が読む上限（`AGENT_OUTPUT_MAX_CHARS`）と同じ。実 HTTP の応答を
 *   読みながらバイト数で打ち切る上限は、実 Provider Adapter（STEP10-6）で足す
 */
export const AGENT_PROVIDER_CALL_POLICY: AgentProviderCallPolicy = Object.freeze({
  timeoutMs: 120_000,
  maxResponseChars: AGENT_OUTPUT_MAX_CHARS
})

/**
 * 呼び直しの Policy（STEP10-3）。
 *
 * 呼び直すのは `isRetryableProviderFailure` が真の失敗だけ。回数・待ち時間はこの形で
 * Agent Loop へ渡し、実 Provider ごとの待ち方（Retry-After・Backoff）は STEP10-6 で
 * この値を差し替える形で足す。
 *
 * 数えるのは **Provider への試み（Attempt）** で、Agent Loop の Turn とは別（STEP10-4）。
 * 呼び直しは Turn を使わず、通った応答を受け取ったときだけ Turn が1つ進む。
 */
export interface AgentProviderRetryPolicy {
  /** 通った応答を1つ得るまでに Provider を呼ぶ回数の上限（初回を含む。Turn は使わない）。 */
  readonly maxAttempts: number
  /** 呼び直す前に待つ時間（ミリ秒・固定）。待っている間に止めれば、次は呼ばない。 */
  readonly retryDelayMs: number
}

/**
 * 呼び出し回数の天井（初回 ＋ 呼び直し 2 回）。Policy がこれを超える値を持っていても、
 * Agent Loop はこれより多くは呼ばない（無制限の呼び直しを作らない）。
 */
export const AGENT_PROVIDER_MAX_ATTEMPTS = 3

/**
 * 今の呼び直しの Policy。
 *
 * - `maxAttempts` … 3（初回 ＋ 最大 2 回。2026-09-24 確定）
 * - `retryDelayMs` … **固定 1 秒（2026-09-24 に STEP10 前半の汎用 Policy として正式採用）。**
 *   すぐに叩き直さないための間で、指数的な Backoff・jitter・Provider ごとの Retry-After は
 *   入れていない（実 Provider ごとの待ち方は STEP10-6）
 */
export const AGENT_PROVIDER_RETRY_POLICY: AgentProviderRetryPolicy = Object.freeze({
  maxAttempts: AGENT_PROVIDER_MAX_ATTEMPTS,
  retryDelayMs: 1_000
})
