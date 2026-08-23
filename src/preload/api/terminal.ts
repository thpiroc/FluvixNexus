import type { TerminalApi } from '@shared/api'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'
import { subscribeIpcEvent } from '../ipc/subscribe'

/**
 * terminal ドメインの Preload API（Session 3-7-1 / 3-7-2）。
 *
 * 他のドメインと同じく「IPC 呼び出しを型付きの関数に包んだだけ」に留める。
 * `child_process` はもちろん、node-pty をここへ持ち込まないこと ──
 * プロセスを立てるのは Main の責務で、Preload が提供するのは経路だけになる
 * （preload/api/index.ts）。
 *
 * `files` API が「相対位置しか受け取らない」ことで境界を作っているのに対し、
 * こちらは**渡す欄そのものが無い**ことで作っている。起動する実行ファイルも
 * 作業ディレクトリも要求に含まれず、決めるのは Main
 * （main/terminal/shellCommand.ts と、今開いている Workspace）。
 * Session 3-7-2 で足した `shellId` はその表の**行**を指すだけで、
 * 行の中身を渡せる欄が増えたわけではない。
 *
 * `onData` / `onExit` は `files.onChanged` と同じ経路で、
 * Electron の event オブジェクトを剥がすのは subscribe.ts の責務。
 */
export const terminalApi: TerminalApi = {
  listShells: () => invokeIpc(IPC_CHANNELS.TERMINAL_LIST_SHELLS),
  listBusy: () => invokeIpc(IPC_CHANNELS.TERMINAL_LIST_BUSY),
  create: (request) => invokeIpc(IPC_CHANNELS.TERMINAL_CREATE, request),
  write: (request) => invokeIpc(IPC_CHANNELS.TERMINAL_WRITE, request),
  resize: (request) => invokeIpc(IPC_CHANNELS.TERMINAL_RESIZE, request),
  dispose: (request) => invokeIpc(IPC_CHANNELS.TERMINAL_DISPOSE, request),
  onData: (listener) => subscribeIpcEvent(IPC_EVENT_CHANNELS.TERMINAL_DATA, listener),
  onExit: (listener) => subscribeIpcEvent(IPC_EVENT_CHANNELS.TERMINAL_EXIT, listener)
}
