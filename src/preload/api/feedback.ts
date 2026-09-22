import type { FeedbackApi } from '@shared/api'
import { IPC_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'

/**
 * feedback ドメインの Preload API。
 *
 * 他のドメインと同じく「IPC 呼び出しを型付きの関数に包んだだけ」に留める。
 * Notion へ出る処理も、その token もここには無い ── 外へ出るのは Main だけ
 * （main/feedback/）。
 */
export const feedbackApi: FeedbackApi = {
  submit: (request) => invokeIpc(IPC_CHANNELS.FEEDBACK_SUBMIT, request)
}
