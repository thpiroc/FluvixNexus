/**
 * IPC 契約レイヤーの公開窓口。
 *
 * Main / Preload / Renderer はこのモジュール経由でのみ IPC の型と定数を参照する。
 * shared 層のルールどおり、ここに実装（ipcMain / ipcRenderer への依存）は置かない。
 */
export { IPC_CHANNELS } from './channels'
export { ipcFailure, ipcSuccess } from './result'

export type {
  IpcChannel,
  IpcContract,
  IpcInvokeArgs,
  IpcInvokeResult,
  IpcRequest,
  IpcResponse
} from './contract'
export type { IpcErrorCode, IpcErrorPayload, IpcFailure, IpcResult, IpcSuccess } from './result'
export type {
  AppInfoResponse,
  PingRequest,
  PingResponse,
  SystemIpcContract
} from './contracts/system'
