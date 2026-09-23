import { readWorkspaceDirectory } from '../../files/readWorkspaceDirectory'
import { searchWorkspaceFileContents } from '../../files/searchWorkspaceFileContents'
import { describeGitRepository } from '../../git/gitRepository'
import { getCurrentWorkspaceFolder } from '../../workspaceFolder/currentWorkspaceFolder'
import { recordAuditEvent } from '../audit/currentAuditLog'
import { resolveAgentWorkspaceTarget } from '../boundary/currentWorkspaceBoundary'
import { getCurrentSecurityPolicy } from '../policy/currentSecurityPolicy'
import {
  createReadToolsGate,
  type FileReadOutcome,
  type WorkspaceListOutcome,
  type WorkspaceSearchOutcome,
  type WorkspaceStatusOutcome
} from './readToolsGate'
import {
  confirmPinnedWorkspaceRoot,
  listPinnedWorkspaceDirectory,
  readVerifiedFileBytes,
  resolvePinnedWorkspaceTarget
} from './readToolsIo'

/**
 * 今の Read Tool Gate（Security Core v1 の STEP9）。
 *
 * **Main の Security Core が持つ、Agent の読み取りの唯一の入口。** Policy は Main が保存から
 * 読み直したもの（STEP1）、Workspace root は Main が持つ正本（STEP2）、記録先は Main の
 * Audit Log（STEP4）で、**どれも引数では差し替えられない**（差し替えられる形
 * `createReadToolsGate` はこの folder の中だけにある）。
 *
 * IPC にも Preload にも出さない。呼ぶのは Agent Loop（main/agent/）だけ。
 */

const gate = createReadToolsGate({
  readPolicy: getCurrentSecurityPolicy,
  recordEvent: recordAuditEvent,
  resolveTarget: (relativePath) => resolveAgentWorkspaceTarget(relativePath, 'read'),
  readBytes: readVerifiedFileBytes,
  readDirectory: readWorkspaceDirectory,
  resolvePinnedTarget: resolvePinnedWorkspaceTarget,
  listPinnedDirectory: listPinnedWorkspaceDirectory,
  confirmPinnedRoot: confirmPinnedWorkspaceRoot,
  searchContents: searchWorkspaceFileContents,
  readWorkspaceName: () => getCurrentWorkspaceFolder()?.displayName ?? null,
  readGitRepository: async () => (await describeGitRepository()).repository
})

/** Workspace の中のテキストファイルを、範囲を指定して読む（file_read）。 */
export function readAgentWorkspaceFile(
  relativePath: unknown,
  range?: unknown
): Promise<FileReadOutcome> {
  return gate.readFile(relativePath, range)
}

/** Workspace の中のフォルダを1階層だけ一覧にする（workspace_list）。 */
export function listAgentWorkspaceDirectory(relativePath: unknown): Promise<WorkspaceListOutcome> {
  return gate.listDirectory(relativePath)
}

/** Workspace の中を文字列で探す（file_search）。 */
export function searchAgentWorkspace(query: unknown): Promise<WorkspaceSearchOutcome> {
  return gate.search(query)
}

/** 今の Workspace の状態を、安全な情報だけで返す（workspace_status）。 */
export function describeAgentWorkspaceStatus(): Promise<WorkspaceStatusOutcome> {
  return gate.describeStatus()
}
