export { FLUVIX_API_KEY } from './api'
export type {
  EnvApi,
  FilesApi,
  FluvixApi,
  GitApi,
  PlatformId,
  RuntimeVersions,
  SettingsApi,
  SystemApi,
  WindowApi,
  WorkspaceApi,
  WorkspaceFolderApi
} from './api'

export {
  FILE_ENCODINGS,
  FILE_NAME_MAX_LENGTH,
  FILES_BINARY_SNIFF_BYTES,
  FILES_DIRECTORY_MAX_ENTRIES,
  FILES_FILE_MAX_BYTES,
  FILES_RELATIVE_PATH_MAX_LENGTH,
  WORKSPACE_ROOT_RELATIVE_PATH,
  findFileNameProblem,
  isAtOrUnder,
  isFileEncoding,
  joinRelativePath,
  normalizeFileName,
  parentRelativePath,
  rebaseRelativePath,
  splitRelativePath
} from './files'
export type {
  FileEncoding,
  FileEntry,
  FileEntryType,
  FileLineEnding,
  FileNameProblem,
  FileRevision,
  WorkspaceFileChange,
  WorkspaceFileChangeKind,
  WorkspaceFileStatus
} from './files'

export type { GitFailureReason, GitHead, GitRepositoryState } from './git'

export { EDITOR_SETTINGS_DOCUMENT_MAX_BYTES, EDITOR_SETTINGS_SCHEMA_VERSION } from './settings'
export type { EditorSettingsDocument, StoredAutoSaveSettings } from './settings'

export {
  WORKSPACE_FOLDER_DOCUMENT_MAX_BYTES,
  WORKSPACE_FOLDER_SCHEMA_VERSION,
  WORKSPACE_LAYOUT_DOCUMENT_MAX_BYTES,
  WORKSPACE_LAYOUT_SCHEMA_VERSION,
  WORKSPACE_ROOT_PATH_MAX_LENGTH
} from './workspace'
export type {
  StoredDockGroupNode,
  StoredDockNode,
  StoredDockSplitNode,
  StoredSplitDirection,
  StoredWorkspaceFolder,
  StoredWorkspaceLayout,
  WorkspaceFolder,
  WorkspaceFolderDocument,
  WorkspaceLayoutDocument
} from './workspace'

export { IPC_CHANNELS, IPC_EVENT_CHANNELS, ipcFailure, ipcSuccess, isIpcEventChannel } from './ipc'
export type {
  AppInfoResponse,
  CreateWorkspaceEntryRequest,
  CreateWorkspaceEntryResponse,
  DeleteWorkspaceEntryRequest,
  DeleteWorkspaceEntryResponse,
  GetCurrentWorkspaceFolderResponse,
  GetGitRepositoryResponse,
  IpcChannel,
  IpcContract,
  IpcErrorCode,
  IpcErrorPayload,
  IpcEventChannel,
  IpcEventContract,
  IpcEventListener,
  IpcEventPayload,
  IpcEventUnsubscribe,
  IpcFailure,
  IpcInvokeArgs,
  IpcInvokeResult,
  IpcRequest,
  IpcResponse,
  IpcResult,
  IpcSuccess,
  LoadEditorSettingsResponse,
  LoadWorkspaceLayoutResponse,
  OpenWorkspaceFolderResponse,
  PingRequest,
  PingResponse,
  ReadWorkspaceDirectoryRequest,
  ReadWorkspaceDirectoryResponse,
  ReadWorkspaceFileRequest,
  ReadWorkspaceFileResponse,
  RenameWorkspaceEntryRequest,
  RenameWorkspaceEntryResponse,
  RespondWindowCloseRequest,
  SaveEditorSettingsRequest,
  SaveWorkspaceLayoutRequest,
  WindowCloseDecision,
  WindowCloseRequestedEvent,
  WorkspaceFileChangeSource,
  WorkspaceFilesChangedEvent,
  WriteWorkspaceFileRequest,
  WriteWorkspaceFileResponse
} from './ipc'
