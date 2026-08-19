import type { WindowApi } from '@shared/api'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'
import { subscribeIpcEvent } from '../ipc/subscribe'

/**
 * window ドメインの Preload API（閉じてよいかの確認）。
 *
 * 他のドメインと同じく「IPC 呼び出しを型付きの関数に包んだだけ」に留める。
 *
 * **ウィンドウを閉じる / アプリを終了する API は公開しない。** ここにあるのは
 * 「Main が閉じようとしている」に対する返事の経路だけで、Renderer が
 * 閉じる操作を始める手段は無い（それは Main の責務。ARCHITECTURE.md §1）。
 */
export const windowApi: WindowApi = {
  onCloseRequested: (listener) =>
    subscribeIpcEvent(IPC_EVENT_CHANNELS.WINDOW_CLOSE_REQUESTED, listener),
  respondClose: (request) => invokeIpc(IPC_CHANNELS.WINDOW_RESPOND_CLOSE, request)
}
