export { FLUVIX_API_KEY } from './api'
export type { EnvApi, FluvixApi, PlatformId, RuntimeVersions, SystemApi, WorkspaceApi } from './api'

export { WORKSPACE_LAYOUT_DOCUMENT_MAX_BYTES, WORKSPACE_LAYOUT_SCHEMA_VERSION } from './workspace'
export type {
  StoredDockGroupNode,
  StoredDockNode,
  StoredDockSplitNode,
  StoredSplitDirection,
  StoredWorkspaceLayout,
  WorkspaceLayoutDocument
} from './workspace'

export { IPC_CHANNELS, ipcFailure, ipcSuccess } from './ipc'
export type {
  AppInfoResponse,
  IpcChannel,
  IpcContract,
  IpcErrorCode,
  IpcErrorPayload,
  IpcFailure,
  IpcInvokeArgs,
  IpcInvokeResult,
  IpcRequest,
  IpcResponse,
  IpcResult,
  IpcSuccess,
  LoadWorkspaceLayoutResponse,
  PingRequest,
  PingResponse,
  SaveWorkspaceLayoutRequest
} from './ipc'
