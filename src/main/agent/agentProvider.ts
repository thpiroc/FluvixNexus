import type { SafeExternalPayload } from '../security/externalSend'

/**
 * FN Agent が次の Action を尋ねる相手（AI Provider）の形（Security Core v1 の STEP9）。
 *
 * **受け取れるのは External Send Gate（STEP5）が発行した `SafeExternalPayload` だけ。**
 * Agent Loop は Context を `sendThroughExternalGate` に渡し、Gate が allow のときに
 * 渡してくる Payload をそのまま `next` へ渡す（Payload を持ち回す経路は無い）。
 *
 * ## STEP9 と STEP10
 *
 * STEP9 には**実際の AI Provider は無い。** 開発ビルドだけで使える Scripted Provider
 * （scriptedProvider.ts）で Agent Loop を End-to-End で動かす。OpenAI などの実 Provider・
 * Credential Store（API Key の保存）・Abort / timeout の作り込みは STEP10（Provider 境界）。
 * Provider の API Key はこの形に入れない（Credential は Payload とも別。DESIGN.md §6.4）。
 */
export interface AgentProvider {
  /**
   * Provider の識別子（External Send Gate の `providerId`。小文字・数字・ハイフン・40 文字まで）。
   * Audit の `subject` に載る。
   */
  readonly id: string
  /**
   * モデルが1回に受け取れる Context の大きさ（Token）。入力の Budget はこの約 70%
   * （main/agent/agentContext.ts）。
   */
  readonly contextWindowTokens: number
  /**
   * 次の Action を尋ねる。返り値は**未検査の出力**（Agent Loop が Schema で確かめる）。
   *
   * `signal` は利用者の停止で中断される。中断されたら、結果を返さずに投げてよい。
   */
  readonly next: (payload: SafeExternalPayload, signal: AbortSignal) => Promise<unknown>
}
