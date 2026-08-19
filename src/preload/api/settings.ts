import type { SettingsApi } from '@shared/api'
import { IPC_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'

/**
 * settings ドメインの Preload API（アプリの設定の永続化）。
 *
 * workspace（レイアウト）と同じ形の薄いラッパ。**保存先のパスもファイル名も
 * 引数に無い**ことが要点で、Renderer から任意の場所へ書ける経路にはならない。
 */
export const settingsApi: SettingsApi = {
  loadEditor: () => invokeIpc(IPC_CHANNELS.SETTINGS_LOAD_EDITOR),
  saveEditor: (request) => invokeIpc(IPC_CHANNELS.SETTINGS_SAVE_EDITOR, request),
  loadFiles: () => invokeIpc(IPC_CHANNELS.SETTINGS_LOAD_FILES),
  saveFiles: (request) => invokeIpc(IPC_CHANNELS.SETTINGS_SAVE_FILES, request)
}
