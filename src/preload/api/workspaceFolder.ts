import type { WorkspaceFolderApi } from '@shared/api'
import { IPC_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'

/**
 * workspace-folder ドメインの Preload API（開いているプロジェクトフォルダ）。
 *
 * 他のドメインと同じく「IPC 呼び出しを型付きの関数に包んだだけ」に留める。
 * ダイアログを出すのも、パスを検証するのも、保存するのも Main の責務。
 *
 * 3つとも引数を取らないのが要点で、Renderer が開く場所を指定する手段が
 * どこにも無いことがこの層でも見て取れる。
 */
export const workspaceFolderApi: WorkspaceFolderApi = {
  getCurrent: () => invokeIpc(IPC_CHANNELS.WORKSPACE_FOLDER_GET_CURRENT),
  open: () => invokeIpc(IPC_CHANNELS.WORKSPACE_FOLDER_OPEN),
  close: () => invokeIpc(IPC_CHANNELS.WORKSPACE_FOLDER_CLOSE)
}
