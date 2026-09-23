import type { SafeTerminalCommandDisplay, SafeTerminalRunResult } from '../../security/terminalRun'

/**
 * FN Agent の Terminal の提案（Security Core v1 の STEP8）。Main → Renderer の片道。
 *
 * ```
 * agent-terminal:proposed   何を実行しようとしているか（Mask 済みの command / 引数 / 場所）
 * agent-terminal:settled    その提案が終わった（実行した場合は、伏せた後の結果）
 * ```
 *
 * 承認そのものは STEP6 の `approval:requested` が別に届く（File Write と同じ分け方。
 * shared/ipc/events/agentFileWrite.ts）。画面を出してよいのは2つが揃い、かつ
 * **同じコマンド・同じ場所**を指しているときだけ。
 *
 * **Renderer から Main へ向かうチャンネルは無い。** 承認の意思表示は STEP6 の
 * `approval:respond` だけで、コマンドを頼む・書き換える・もう一度実行する口は作らない。
 * 載っているのは表示用の値だけで、実行する exact な argv も raw な出力も無い。
 */

export interface AgentTerminalProposedEvent {
  /** その提案の識別子（Main が発番する）。 */
  readonly proposalId: string
  readonly command: SafeTerminalCommandDisplay
}

export interface AgentTerminalSettledEvent {
  /** 終わった提案の識別子。 */
  readonly proposalId: string
  /** 実行した場合の結果。**実行しなかった（拒否・取り消し・期限切れ）なら `null`。** */
  readonly result: SafeTerminalRunResult | null
}

export interface AgentTerminalIpcEventContract {
  'agent-terminal:proposed': AgentTerminalProposedEvent
  'agent-terminal:settled': AgentTerminalSettledEvent
}
