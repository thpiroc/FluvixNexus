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
  FILES_SAVE_AS: 'files:save-as',
  FILES_CREATE: 'files:create',
  FILES_RENAME: 'files:rename',
  FILES_MOVE: 'files:move',
  FILES_COPY: 'files:copy',
  FILES_DELETE: 'files:delete',
  FILES_SEARCH: 'files:search',
  FILES_SEARCH_CONTENT: 'files:search-content',
  FILES_CANCEL_SEARCH: 'files:cancel-search',
  TERMINAL_LIST_SHELLS: 'terminal:list-shells',
  TERMINAL_LIST_BUSY: 'terminal:list-busy',
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_DISPOSE: 'terminal:dispose',
  GIT_GET_REPOSITORY: 'git:get-repository',
  GIT_INIT: 'git:init',
  GIT_STAGE: 'git:stage',
  GIT_UNSTAGE: 'git:unstage',
  GIT_COMMIT: 'git:commit',
  GIT_PUSH: 'git:push',
  GIT_PULL: 'git:pull',
  GIT_FETCH: 'git:fetch',
  GIT_COMMIT_AND_PUSH: 'git:commit-and-push',
  GIT_LIST_BRANCHES: 'git:list-branches',
  GIT_LIST_COMMITS: 'git:list-commits',
  GIT_GET_COMMIT_DETAIL: 'git:get-commit-detail',
  GIT_GET_COMMIT_FILE_DIFF: 'git:get-commit-file-diff',
  GIT_SWITCH_BRANCH: 'git:switch-branch',
  GIT_CREATE_BRANCH: 'git:create-branch',
  GIT_DELETE_BRANCH: 'git:delete-branch',
  GIT_RENAME_BRANCH: 'git:rename-branch',
  GIT_MERGE_BRANCH: 'git:merge-branch',
  GIT_ABORT_MERGE: 'git:abort-merge',
  GIT_GET_MERGE_MESSAGE: 'git:get-merge-message',
  GIT_LIST_REMOTE_BRANCHES: 'git:list-remote-branches',
  GIT_CREATE_TRACKING_BRANCH: 'git:create-tracking-branch',
  GIT_LIST_REMOTES: 'git:list-remotes',
  GIT_ADD_REMOTE: 'git:add-remote',
  GIT_SET_REMOTE_URL: 'git:set-remote-url',
  GIT_RENAME_REMOTE: 'git:rename-remote',
  GIT_REMOVE_REMOTE: 'git:remove-remote',
  GIT_LIST_STASHES: 'git:list-stashes',
  GIT_STASH_PUSH: 'git:stash-push',
  GIT_STASH_POP: 'git:stash-pop',
  GIT_STASH_DROP: 'git:stash-drop',
  GIT_GET_FILE_DIFF: 'git:get-file-diff',
  GIT_GET_CONFLICT_DIFF: 'git:get-conflict-diff',
  GIT_DISCARD: 'git:discard',
  GIT_RESOLVE_CONFLICT: 'git:resolve-conflict',
  GITHUB_GET_STATUS: 'github:get-status',
  GITHUB_PUBLISH: 'github:publish',
  LSP_DID_OPEN: 'lsp:did-open',
  LSP_DID_CHANGE: 'lsp:did-change',
  LSP_DID_SAVE: 'lsp:did-save',
  LSP_DID_CLOSE: 'lsp:did-close',
  LSP_GET_STATUS: 'lsp:get-status',
  SETTINGS_LOAD: 'settings:load',
  SETTINGS_SAVE_SECTION: 'settings:save-section'
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
