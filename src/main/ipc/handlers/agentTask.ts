import type { AgentTaskStartResult, AgentTaskState } from '@shared/agent'
import { IPC_CHANNELS } from '@shared/ipc'
import {
  continueAgentTask,
  getAgentTaskState,
  startAgentTask,
  stopAgentTask
} from '../../agent/currentAgentLoop'
import { handleIpc } from '../registry'

/**
 * agent-task ドメインのハンドラ（FN Agent の作業。Security Core v1 の STEP9）。
 *
 * ここが持つのは**経路だけ。** 指示の検査・Loop の進め方・止め方は Agent Loop
 * （main/agent/）が、Action を実行してよいかは Security Core が決める。
 *
 * Renderer が送れるのは「始めて」「止めて」「上限だが続けて / やめて」の意思表示だけで、
 * **Action・Tool・承認・Security の判断を渡す口は無い**（承認は STEP6 の
 * `approval:respond` と Main の Native Dialog だけが進める）。送信元のウィンドウは
 * 基盤（registry.ts）が検証する。
 */
export function registerAgentTaskHandlers(): void {
  handleIpc(IPC_CHANNELS.AGENT_TASK_START, (request): AgentTaskStartResult =>
    startAgentTask(readPrompt(request))
  )

  handleIpc(IPC_CHANNELS.AGENT_TASK_STOP, (): void => {
    stopAgentTask()
  })

  handleIpc(IPC_CHANNELS.AGENT_TASK_CONTINUE, (request): void => {
    continueAgentTask(readDecision(request))
  })

  handleIpc(IPC_CHANNELS.AGENT_TASK_GET_STATE, (): AgentTaskState => getAgentTaskState())
}

/** 型を名乗っているだけとして読む（中身の検査は Agent Loop が行う）。 */
function readPrompt(request: unknown): unknown {
  return typeof request === 'object' && request !== null
    ? (request as { readonly prompt?: unknown }).prompt
    : undefined
}

function readDecision(request: unknown): unknown {
  return typeof request === 'object' && request !== null
    ? (request as { readonly decision?: unknown }).decision
    : undefined
}
