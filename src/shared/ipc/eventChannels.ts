import type { IpcEventChannel } from './event'

/**
 * Main → Renderer イベントのチャンネル名の定数。
 *
 * channels.ts（要求 / 応答）と同じ作りにしてある。素の文字列で書くと typo が
 * 「誰も受け取らないイベント」になり、要求 / 応答と違って**失敗すら返らない**ため
 * 実行時にも気づけない。Main / Preload の双方から必ずこの定数を参照すること。
 *
 * 命名規則も同じく `<domain>:<action>`。要求 / 応答のチャンネル名とは
 * 別の名前空間だが、意味が重なる名前は避ける（`files:read-directory` に対する
 * `files:changed` のように、動詞と出来事で読み分けられる形にする）。
 */
export const IPC_EVENT_CHANNELS = {
  FILES_CHANGED: 'files:changed',
  WINDOW_CLOSE_REQUESTED: 'window:close-requested',
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_EXIT: 'terminal:exit',
  GIT_CHANGED: 'git:changed',
  LSP_SYNC_REQUESTED: 'lsp:sync-requested',
  LSP_DIAGNOSTICS: 'lsp:diagnostics',
  LSP_DIAGNOSTICS_CLEARED: 'lsp:diagnostics-cleared',
  LSP_STATUS_CHANGED: 'lsp:status-changed',
  DEBUG_BREAKPOINTS_CHANGED: 'debug:breakpoints-changed',
  DEBUG_CALL_STACK_CHANGED: 'debug:call-stack-changed',
  DEBUG_CONSOLE_ENTRY: 'debug:console-entry'
} as const satisfies Record<string, IpcEventChannel>

/**
 * 契約に定義されたイベントがすべて IPC_EVENT_CHANNELS に載っていることを型で保証する。
 * 契約だけ追加して定数を足し忘れると、ここでコンパイルエラーになる。
 */
type RegisteredEventChannel = (typeof IPC_EVENT_CHANNELS)[keyof typeof IPC_EVENT_CHANNELS]
type MissingEventChannels = Exclude<IpcEventChannel, RegisteredEventChannel>

const _assertAllEventChannelsRegistered: MissingEventChannels extends never
  ? true
  : { readonly __missingFromIpcEventChannels: MissingEventChannels } = true
void _assertAllEventChannelsRegistered

/**
 * 購読を受け付けてよいチャンネルか。
 *
 * Preload が Renderer から来た文字列をそのまま `ipcRenderer.on` へ渡さないために使う。
 * 契約に無いチャンネルを購読できると、Main の内部で使う任意のチャンネルを
 * Renderer から盗み聞きできてしまう（invoke 側で契約外のチャンネルを呼べないのと同じ線）。
 */
export function isIpcEventChannel(value: string): value is IpcEventChannel {
  return Object.values(IPC_EVENT_CHANNELS).some((channel) => channel === value)
}
