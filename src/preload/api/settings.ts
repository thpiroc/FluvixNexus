import type { SettingsApi } from '@shared/api'
import { IPC_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'

/**
 * settings ドメインの Preload API（アプリの設定の永続化）。
 *
 * workspace（レイアウト）と同じ形の薄いラッパ。**保存先のパスもファイル名も
 * 引数に無い**ことが要点で、Renderer から任意の場所へ書ける経路にはならない。
 *
 * Session 4-3A で6つのメソッドが2つになったが、Preload が薄いままなのは変わらない
 * ── ここは IPC を包むだけで、section の中身も既定値も知らない。
 */
export const settingsApi: SettingsApi = {
  load: () => invokeIpc(IPC_CHANNELS.SETTINGS_LOAD),
  saveSection: (request) => invokeIpc(IPC_CHANNELS.SETTINGS_SAVE_SECTION, request)
}
