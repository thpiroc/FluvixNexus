/**
 * IPC 契約レイヤーの公開窓口。
 *
 * Main / Preload / Renderer はこのモジュール経由でのみ IPC の型と定数を参照する。
 * shared 層のルールどおり、ここに実装（ipcMain / ipcRenderer への依存）は置かない。
 *
 * 扱う経路は2つあり、契約も別々になっている。
 *   - 要求と応答（Renderer → Main）… contract.ts / channels.ts
 *   - イベント（Main → Renderer）  … event.ts / eventChannels.ts
 */
export { IPC_CHANNELS } from './channels'
export { IPC_EVENT_CHANNELS, isIpcEventChannel } from './eventChannels'
export { ipcFailure, ipcSuccess } from './result'

export type {
  IpcChannel,
  IpcContract,
  IpcInvokeArgs,
  IpcInvokeResult,
  IpcRequest,
  IpcResponse
} from './contract'
export type {
  IpcEventChannel,
  IpcEventContract,
  IpcEventListener,
  IpcEventPayload,
  IpcEventUnsubscribe
} from './event'
export type { IpcErrorCode, IpcErrorPayload, IpcFailure, IpcResult, IpcSuccess } from './result'
export type {
  AppInfoResponse,
  PingRequest,
  PingResponse,
  SystemIpcContract
} from './contracts/system'
export type {
  LoadWorkspaceLayoutResponse,
  SaveWorkspaceLayoutRequest,
  WorkspaceIpcContract
} from './contracts/workspace'
export type {
  GetCurrentWorkspaceFolderResponse,
  OpenWorkspaceFolderResponse,
  WorkspaceFolderIpcContract
} from './contracts/workspaceFolder'
export type {
  CancelWorkspaceFileSearchRequest,
  CancelWorkspaceFileSearchResponse,
  CopyWorkspaceEntryRequest,
  CopyWorkspaceEntryResponse,
  CreateWorkspaceEntryRequest,
  CreateWorkspaceEntryResponse,
  DeleteWorkspaceEntryRequest,
  DeleteWorkspaceEntryResponse,
  FilesIpcContract,
  MoveWorkspaceEntryRequest,
  MoveWorkspaceEntryResponse,
  ReadWorkspaceDirectoryRequest,
  ReadWorkspaceDirectoryResponse,
  ReadWorkspaceFileRequest,
  ReadWorkspaceFileResponse,
  RenameWorkspaceEntryRequest,
  RenameWorkspaceEntryResponse,
  SaveWorkspaceFileAsRequest,
  SaveWorkspaceFileAsResponse,
  SearchWorkspaceFileContentsRequest,
  SearchWorkspaceFileContentsResponse,
  SearchWorkspaceFilesRequest,
  SearchWorkspaceFilesResponse,
  WriteWorkspaceFileRequest,
  WriteWorkspaceFileResponse,
  WriteWorkspaceFileStatus
} from './contracts/files'
export type {
  ChangeLspDocumentRequest,
  CloseLspDocumentRequest,
  LspCompletionRequest,
  LspCompletionResponse,
  LspDefinitionRequest,
  LspDefinitionResponse,
  LspHoverRequest,
  LspHoverResponse,
  LspIpcContract,
  LspReferencesRequest,
  LspReferencesResponse,
  LspStatusResponse,
  OpenLspDocumentRequest,
  OpenLspDocumentResponse,
  SaveLspDocumentRequest
} from './contracts/lsp'
export type {
  LoadSettingsResponse,
  SaveSettingsSectionRequest,
  SettingsIpcContract
} from './contracts/settings'
export type {
  AddGitRemoteRequest,
  CommitAndPushGitChangesRequest,
  CommitGitChangesRequest,
  CreateGitBranchRequest,
  CreateGitTrackingBranchRequest,
  DiscardGitChangesRequest,
  GetGitCommitDetailRequest,
  GetGitCommitDetailResponse,
  GetGitCommitFileDiffRequest,
  GetGitCommitFileDiffResponse,
  GetGitConflictDiffRequest,
  GetGitConflictDiffResponse,
  GetGitFileDiffRequest,
  GetGitFileDiffResponse,
  GetGitMergeMessageResponse,
  GetGitRepositoryResponse,
  GitIpcContract,
  GitOperationResponse,
  GitStashEntryRequest,
  ListGitBranchesResponse,
  ListGitCommitsResponse,
  ListGitRemoteBranchesResponse,
  ListGitRemotesResponse,
  ListGitStashesResponse,
  RemoveGitRemoteRequest,
  RenameGitRemoteRequest,
  ResolveGitConflictRequest,
  SetGitRemoteUrlRequest,
  StageGitChangesRequest,
  SwitchGitBranchRequest,
  UnstageGitChangesRequest
} from './contracts/git'
export type {
  GetGitHubStatusResponse,
  GitHubIpcContract,
  PublishGitHubRepositoryRequest,
  PublishGitHubRepositoryResponse
} from './contracts/github'
export type {
  CreateTerminalSessionRequest,
  CreateTerminalSessionResponse,
  DisposeTerminalSessionRequest,
  ListBusyTerminalSessionsResponse,
  ListTerminalShellsResponse,
  ResizeTerminalRequest,
  TerminalIpcContract,
  WriteTerminalInputRequest
} from './contracts/terminal'
export type {
  RespondWindowCloseRequest,
  WindowCloseDecision,
  WindowIpcContract
} from './contracts/window'
export type {
  FilesIpcEventContract,
  WorkspaceFileChangeSource,
  WorkspaceFilesChangedEvent
} from './events/files'
export type { GitChangedEvent, GitIpcEventContract } from './events/git'
export type {
  LspDiagnosticsClearedEvent,
  LspDiagnosticsEvent,
  LspIpcEventContract,
  LspStatusChangedEvent,
  LspSyncRequestedEvent
} from './events/lsp'
export type {
  TerminalExitEvent,
  TerminalIpcEventContract,
  TerminalOutputEvent
} from './events/terminal'
export type { WindowCloseRequestedEvent, WindowIpcEventContract } from './events/window'
