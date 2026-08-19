import type { IpcChannel } from './contract'

/**
 * IPC チャンネル名の定数。
 *
 * チャンネル名は文字列リテラルのため、素の文字列で書くと typo がそのまま
 * 「ハンドラのないチャンネル」になり実行時まで気づけない。
 * Main / Preload の双方から必ずこの定数を参照すること。
 *
 * 命名規則は `<domain>:<action>` とし、ドメインごとにグループ化する。
 */
export const IPC_CHANNELS = {
  SYSTEM_PING: 'system:ping',
  SYSTEM_APP_INFO: 'system:app-info',
  WINDOW_RESPOND_CLOSE: 'window:respond-close',
  WORKSPACE_LOAD_LAYOUT: 'workspace:load-layout',
  WORKSPACE_SAVE_LAYOUT: 'workspace:save-layout',
  WORKSPACE_FOLDER_GET_CURRENT: 'workspace-folder:get-current',
  WORKSPACE_FOLDER_OPEN: 'workspace-folder:open',
  WORKSPACE_FOLDER_CLOSE: 'workspace-folder:close',
  FILES_READ_DIRECTORY: 'files:read-directory',
  FILES_READ_FILE: 'files:read-file',
  FILES_WRITE_FILE: 'files:write-file',
  FILES_CREATE: 'files:create',
  FILES_RENAME: 'files:rename',
  FILES_MOVE: 'files:move',
  FILES_COPY: 'files:copy',
  FILES_DELETE: 'files:delete',
  FILES_SEARCH: 'files:search',
  FILES_SEARCH_CONTENT: 'files:search-content',
  FILES_CANCEL_SEARCH: 'files:cancel-search',
  SETTINGS_LOAD_EDITOR: 'settings:load-editor',
  SETTINGS_SAVE_EDITOR: 'settings:save-editor',
  SETTINGS_LOAD_FILES: 'settings:load-files',
  SETTINGS_SAVE_FILES: 'settings:save-files'
} as const satisfies Record<string, IpcChannel>

/**
 * 契約に定義されたチャンネルがすべて IPC_CHANNELS に載っていることを型で保証する。
 * 契約だけ追加して定数を足し忘れると、ここでコンパイルエラーになる。
 */
type RegisteredChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
type MissingChannels = Exclude<IpcChannel, RegisteredChannel>

// MissingChannels が never でなければ「定数への追加漏れ」を意味する。
// 追加漏れの場合、コンパイルエラーのメッセージに不足しているチャンネル名が出る。
const _assertAllChannelsRegistered: MissingChannels extends never
  ? true
  : { readonly __missingFromIpcChannels: MissingChannels } = true
void _assertAllChannelsRegistered
