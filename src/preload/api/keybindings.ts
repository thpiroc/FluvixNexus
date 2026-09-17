import type { KeybindingsApi } from '@shared/api'
import { IPC_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'

/**
 * keybindings ドメインの Preload API（Shortcuts S3）。
 *
 * settings と同じ薄いラッパ。**保存先のパスもファイル名も引数に無い。**
 */
export const keybindingsApi: KeybindingsApi = {
  load: () => invokeIpc(IPC_CHANNELS.KEYBINDINGS_LOAD),
  save: (request) => invokeIpc(IPC_CHANNELS.KEYBINDINGS_SAVE, request)
}
