import type { LspApi } from '@shared/api'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'
import { subscribeIpcEvent } from '../ipc/subscribe'

/**
 * lsp ドメインの Preload API（Session 5-2）。
 *
 * 他のドメインと同じく「IPC 呼び出しを型付きの関数に包んだだけ」に留める。
 * `child_process` はもちろん、LSP の電文の組み立てをここへ持ち込まないこと ──
 * サーバを立てるのも、URI を作るのも、どのサーバへ送るかを決めるのも Main の責務で、
 * Preload が提供するのは経路だけになる（preload/api/index.ts）。
 *
 * `files` API が「相対位置しか受け取らない」ことで境界を作っているのに対し、
 * こちらは**それに加えて渡す欄そのものが無い**。実行ファイルも作業ディレクトリも、
 * どのサーバへ送るかも要求に含まれず、決めるのは開いたファイルの拡張子になる
 * （main/lsp/documentLanguage.ts）。Terminal の `shellId` にあたる欄すら無い。
 *
 * `onSyncRequested` は `files.onChanged` と同じ経路で、
 * Electron の event オブジェクトを剥がすのは subscribe.ts の責務。
 */
export const lspApi: LspApi = {
  didOpen: (request) => invokeIpc(IPC_CHANNELS.LSP_DID_OPEN, request),
  didChange: (request) => invokeIpc(IPC_CHANNELS.LSP_DID_CHANGE, request),
  didSave: (request) => invokeIpc(IPC_CHANNELS.LSP_DID_SAVE, request),
  didClose: (request) => invokeIpc(IPC_CHANNELS.LSP_DID_CLOSE, request),
  onSyncRequested: (listener) => subscribeIpcEvent(IPC_EVENT_CHANNELS.LSP_SYNC_REQUESTED, listener)
}
