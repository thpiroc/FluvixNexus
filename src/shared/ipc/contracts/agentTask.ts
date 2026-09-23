import type {
  AgentTaskContinueDecision,
  AgentTaskStartResult,
  AgentTaskState
} from '../../agent/agentTask'

/**
 * agent-task ドメインの IPC 契約（FN Agent の作業。Security Core v1 の STEP9）。
 *
 * ## Renderer が送れるのは意思表示だけ
 *
 * ```
 * agent-task:start      利用者の指示で作業を始めて
 * agent-task:stop       止めて（承認待ちは取り消し、次の Action を始めない）
 * agent-task:continue   Loop の上限に達したが、続けて / やめて
 * agent-task:get-state  今の状態（パネルを開いたとき用）
 * ```
 *
 * **Action を渡す口・Tool を呼ぶ口・承認する口は無い。** どの Action を実行するかは
 * AI の提案を Main の Agent Loop が Schema で確かめ、Security Core が判断する。
 * 承認は STEP6 の `approval:respond` と Main の Native Dialog だけが決める
 * （このドメインから承認は進められない）。
 *
 * 指示の文字列は**未検査の入力**として扱う。Main は長さを見るだけで、AI へ渡すときは
 * External Send Gate（STEP5）が必ず検査して伏せる。
 */

export interface StartAgentTaskRequest {
  /** 利用者の指示（1〜20,000 文字）。 */
  readonly prompt: string
}

export interface ContinueAgentTaskRequest {
  readonly decision: AgentTaskContinueDecision
}

export interface AgentTaskIpcContract {
  'agent-task:start': {
    request: StartAgentTaskRequest
    response: AgentTaskStartResult
  }
  'agent-task:stop': {
    request: void
    response: void
  }
  'agent-task:continue': {
    request: ContinueAgentTaskRequest
    response: void
  }
  'agent-task:get-state': {
    request: void
    response: AgentTaskState
  }
}
