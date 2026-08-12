import type { WorkspaceApi } from '@shared/api'
import { IPC_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'

/**
 * workspace ドメインの Preload API。
 *
 * system と同じく「IPC 呼び出しを型付きの関数に包んだだけ」に留める。
 * 保存形式の組み立ても検証もここでは行わない（前者は Renderer、後者は Main の責務）。
 * Preload に判断を置くと、Main と Renderer の間に第三の実装が生まれてしまう。
 */
export const workspaceApi: WorkspaceApi = {
  loadLayout: () => invokeIpc(IPC_CHANNELS.WORKSPACE_LOAD_LAYOUT),
  saveLayout: (request) => invokeIpc(IPC_CHANNELS.WORKSPACE_SAVE_LAYOUT, request)
}
