import type { AgentTaskApi } from '@shared/api'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'
import { subscribeIpcEvent } from '../ipc/subscribe'

/**
 * agent-task ドメインの Preload API（FN Agent の作業。Security Core v1 の STEP9）。
 *
 * 他のドメインと同じく「IPC 呼び出しを型付きの関数に包んだだけ」に留める。
 *
 * 公開するのは**意思表示と状態の受け取りだけ**（始めて・止めて・上限だが続けて / やめて・
 * 今の状態）。Action を渡す・Tool を呼ぶ・承認する・Security の判断を渡す API は無い
 * （agentTaskSurface.test.ts が見ている）。承認は `approval.respond`（STEP6）だけが進める。
 */
export const agentTaskApi: AgentTaskApi = {
  start: (request) => invokeIpc(IPC_CHANNELS.AGENT_TASK_START, request),
  stop: () => invokeIpc(IPC_CHANNELS.AGENT_TASK_STOP),
  continueTask: (request) => invokeIpc(IPC_CHANNELS.AGENT_TASK_CONTINUE, request),
  getState: () => invokeIpc(IPC_CHANNELS.AGENT_TASK_GET_STATE),
  onStateChanged: (listener) =>
    subscribeIpcEvent(IPC_EVENT_CHANNELS.AGENT_TASK_STATE_CHANGED, listener)
}
