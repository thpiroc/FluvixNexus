import type { SettingsApi } from '@shared/api'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'
import { subscribeIpcEvent } from '../ipc/subscribe'

/**
 * settings ドメインの Preload API（アプリの設定の永続化）。
 *
 * workspace（レイアウト）と同じ形の薄いラッパ。**保存先のパスもファイル名も
 * 引数に無い**ことが要点で、Renderer から任意の場所へ書ける経路にはならない。
 *
 * Session 4-3A で6つのメソッドが2つになったが、Preload が薄いままなのは変わらない
 * ── ここは IPC を包むだけで、section の中身も既定値も知らない。
 * ユーザー設定 / ワークスペース設定に分かれた後も同じで、scope は要求の欄として
 * 素通しするだけ（確かめるのは Main。main/ipc/handlers/settings.ts）。
 */
export const settingsApi: SettingsApi = {
  load: () => invokeIpc(IPC_CHANNELS.SETTINGS_LOAD),
  saveSection: (request) => invokeIpc(IPC_CHANNELS.SETTINGS_SAVE_SECTION, request),
  onWorkspaceChanged: (listener) =>
    subscribeIpcEvent(IPC_EVENT_CHANNELS.SETTINGS_WORKSPACE_CHANGED, listener)
}
