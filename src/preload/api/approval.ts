import type { ApprovalApi } from '@shared/api'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'
import { subscribeIpcEvent } from '../ipc/subscribe'

/**
 * approval ドメインの Preload API（FN Agent の操作の承認。Security Core v1 の STEP6）。
 *
 * 他のドメインと同じく「IPC 呼び出しを型付きの関数に包んだだけ」に留める。
 *
 * **承認を作る API も、承認を使い切る API も公開しない。** ここにあるのは
 * 「Main が出した確認を受け取る」経路と「利用者が続行 / 取り消しを選んだと伝える」
 * 経路の2つだけで、Renderer が承認そのものを成立させる手段は無い
 * （最終的な確認は Main が Native ダイアログで行う。shared/ipc/contracts/approval.ts）。
 */
export const approvalApi: ApprovalApi = {
  onRequested: (listener) => subscribeIpcEvent(IPC_EVENT_CHANNELS.APPROVAL_REQUESTED, listener),
  respond: (request) => invokeIpc(IPC_CHANNELS.APPROVAL_RESPOND, request)
}
