import type { AgentTaskState } from '../../agent/agentTask'

/**
 * FN Agent の作業の状態が変わった（Security Core v1 の STEP9）。Main → Renderer の片道。
 *
 * 載るのは表示用の状態（今の作業の種類・対象の1行・回数・最終回答）だけ。
 * Tool の詳細・ファイルの中身・コマンドの出力・Provider とのやり取りは載らない
 * （shared/agent/agentTask.ts）。
 */
export interface AgentTaskIpcEventContract {
  'agent-task:state-changed': AgentTaskState
}
