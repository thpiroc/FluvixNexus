export { FLUVIX_API_KEY } from './api'
export type {
  EnvApi,
  FilesApi,
  FluvixApi,
  GitApi,
  GitHubApi,
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

export {
  SETTINGS_DOCUMENT_MAX_BYTES,
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_SECTION_IDS,
  emptySettingsSections,
  isSettingsSectionId
} from './settings'
export type {
  SettingsDocument,
  SettingsSectionId,
  SettingsSectionUpdate,
  SettingsSections,
  StoredAppearanceSettings,
  StoredEditorSettings,
  StoredFilesSettings,
  StoredGeneralSettings,
  StoredTerminalSettings
} from './settings'

export {
  DEFAULT_LANGUAGE_ID,
  fromLanguageArguments,
  isLanguageId,
  LANGUAGE_ARGUMENT_PREFIX,
  LANGUAGE_ATTRIBUTE,
  LANGUAGE_IDS,
  normalizeLanguageId,
  toLanguageArgument
} from './language'
export type { LanguageId } from './language'

export {
  DEFAULT_THEME_ID,
  THEME_ATTRIBUTE,
  THEME_IDS,
  THEME_WINDOW_BACKGROUND,
  fromThemeArguments,
  isThemeId,
  normalizeThemeId,
  toThemeArgument
} from './theme'
export type { ThemeId } from './theme'

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
  LoadSettingsResponse,
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
  SaveSettingsSectionRequest,
  SaveWorkspaceLayoutRequest,
  WindowCloseDecision,
  WindowCloseRequestedEvent,
  WorkspaceFileChangeSource,
  WorkspaceFilesChangedEvent,
  WriteWorkspaceFileRequest,
  WriteWorkspaceFileResponse
} from './ipc'
