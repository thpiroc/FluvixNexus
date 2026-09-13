import type { DebugApi } from '@shared/api'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'
import { subscribeIpcEvent } from '../ipc/subscribe'

/**
 * debug ドメインの Preload API（Session 6-3 ── Breakpoint / Session 6-4 ── 実行制御）。
 *
 * 他のドメインと同じく「IPC 呼び出しを型付きの関数に包んだだけ」に留める。
 * `child_process` はもちろん、**DAP の電文の組み立てをここへ持ち込まない**
 * ── adapter を立てるのも、`Source` の絶対パスを作るのも、`setBreakpoints` や
 * `next` を組み立てるのも Main の責務で、Preload が提供するのは経路だけになる
 * （preload/api/index.ts）。
 *
 * `lsp` API が「渡す欄そのものが無い」ことで境界を作っているのと同じ形で、
 * こちらも渡せるのは**Workspace の中の相対位置と行**の2つだけになる。
 * 実行制御の6つは**引数を1つも取らない** ── どの操作かは関数（＝チャンネル）が決め、
 * adapter の名前も、DAP の method 名も、`threadId` も、絶対パスも、渡す欄が存在しない
 * （shared/ipc/contracts/debug.ts）。
 *
 * 購読の `onBreakpointsChanged` は `files.onChanged` と同じ経路で、
 * Electron の event オブジェクトを剥がすのは subscribe.ts の責務。
 * **払い出される payload に絶対パスは載らない** ── 載るのは Main が
 * 「Workspace の中だ」と確かめた相対位置だけになる。
 *
 * `evaluate`（Session 6-7）は **DAP の `evaluate` を送る口ではなく、app-domain の
 * 「式を1つ評価する」口**になる。渡せるのは式・frame・閉じた集合の文脈の3つで、
 * DAP の request 名を渡す欄はここにも契約にも無い（`stepOver` が `next` になるのと
 * 同じ線 ── 翻訳は Main の中）。
 *
 * `getStatus` / `onStatusChanged`（Session 6-9）は `lsp.getStatus` と同じ**読むだけの口**で、
 * 引数を1つも取らない。返るのは閉じた集合の1語だけになる。
 *
 * **Debug Session を起動する口はここに無い**（Debug Profile を入れる Session まで。
 * Session 6-9 で増えたのは状態を読む口だけ）。
 */
export const debugApi: DebugApi = {
  listBreakpoints: () => invokeIpc(IPC_CHANNELS.DEBUG_LIST_BREAKPOINTS),
  toggleBreakpoint: (request) => invokeIpc(IPC_CHANNELS.DEBUG_TOGGLE_BREAKPOINT, request),
  listCallStack: () => invokeIpc(IPC_CHANNELS.DEBUG_LIST_CALL_STACK),
  /*
    Variables（Session 6-6）。載せるのは `frameId` / `handle` の1欄だけで、
    ほかに何が付いてきても Main へは渡さない（`variablesReference` を運ぶ経路を作らない）。
  */
  listScopes: (request) => invokeIpc(IPC_CHANNELS.DEBUG_LIST_SCOPES, { frameId: request?.frameId }),
  listVariables: (request) =>
    invokeIpc(IPC_CHANNELS.DEBUG_LIST_VARIABLES, { handle: request?.handle }),
  /*
    Evaluate（Session 6-7）。載せるのは3欄だけで、`command` / `variablesReference` /
    `threadId` を運ぶ経路は無い。**式は加工しない** ── Preload が trim すると、
    Main が見る値と利用者が打った値が食い違う。
  */
  evaluate: (request) =>
    invokeIpc(IPC_CHANNELS.DEBUG_EVALUATE, {
      expression: request?.expression,
      frameId: request?.frameId,
      context: request?.context
    }),
  continue: () => invokeIpc(IPC_CHANNELS.DEBUG_CONTINUE),
  pause: () => invokeIpc(IPC_CHANNELS.DEBUG_PAUSE),
  stepOver: () => invokeIpc(IPC_CHANNELS.DEBUG_STEP_OVER),
  stepInto: () => invokeIpc(IPC_CHANNELS.DEBUG_STEP_INTO),
  stepOut: () => invokeIpc(IPC_CHANNELS.DEBUG_STEP_OUT),
  stop: () => invokeIpc(IPC_CHANNELS.DEBUG_STOP),
  getStatus: () => invokeIpc(IPC_CHANNELS.DEBUG_GET_STATUS),
  onBreakpointsChanged: (listener) =>
    subscribeIpcEvent(IPC_EVENT_CHANNELS.DEBUG_BREAKPOINTS_CHANGED, listener),
  onCallStackChanged: (listener) =>
    subscribeIpcEvent(IPC_EVENT_CHANNELS.DEBUG_CALL_STACK_CHANGED, listener),
  onConsoleEntry: (listener) => subscribeIpcEvent(IPC_EVENT_CHANNELS.DEBUG_CONSOLE_ENTRY, listener),
  onStatusChanged: (listener) =>
    subscribeIpcEvent(IPC_EVENT_CHANNELS.DEBUG_STATUS_CHANGED, listener)
}
