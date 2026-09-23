/**
 * Read Tool Gate の API（Security Core v1 の STEP9）。
 *
 * FN Agent の読み取り系 Action が**必ず通る**入口。
 *
 * ```
 * readAgentWorkspaceFile(path, range)   file_read        Boundary → Secret → Policy → ハンドル越し → Mask
 * listAgentWorkspaceDirectory(path)     workspace_list   Boundary → Secret の置き場所でない → 1階層
 * searchAgentWorkspace(query)           file_search      Secret ファイルは開かない → 一致した行を Mask
 * describeAgentWorkspaceStatus()        workspace_status 名前・Permission・Git の状態（絶対パスなし）
 * ```
 *
 * **検査を飛ばす・Secret ファイルを読む・Workspace の外を読む API は無い。**
 * IPC にも Preload にも出さない（readToolsSurface.test.ts が見ている）。
 */
export {
  describeAgentWorkspaceStatus,
  listAgentWorkspaceDirectory,
  readAgentWorkspaceFile,
  searchAgentWorkspace
} from './currentReadTools'
export {
  READ_TOOL_MAX_CHANGED_PATHS,
  READ_TOOL_MAX_EXCERPT_CHARS,
  READ_TOOL_MAX_LINES,
  READ_TOOL_MAX_LIST_ENTRIES,
  READ_TOOL_MAX_QUERY_LENGTH,
  READ_TOOL_MAX_SEARCH_MATCHES
} from './readToolsGate'

export type {
  FileReadOutcome,
  WorkspaceGitStatus,
  WorkspaceListEntry,
  WorkspaceListOutcome,
  WorkspaceSearchMatch,
  WorkspaceSearchOutcome,
  WorkspaceStatusOutcome
} from './readToolsGate'
