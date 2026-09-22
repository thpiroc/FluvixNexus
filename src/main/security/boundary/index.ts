/**
 * Workspace Boundary の API（Security Core v1 の STEP2）。
 *
 * 後の STEP の Gate（File Write・Secret Detection・Context 収集 …）が使う入口。
 *
 * ```
 * resolveAgentWorkspaceTarget(path, access)  今の Workspace に対して Main が確かめる
 * recheckWorkspaceTarget(target)             操作の直前にもう一度確かめる
 * confirmOpenedWorkspaceFile(target, handle) 開いたハンドルが確かめた実体か
 * fileReadTargetFacts / fileWriteTargetFacts decideSecurityAction へ渡す事実を作る
 * ```
 *
 * 確かめたことを表す真偽値を外から受け取る口は無い。境界を緩める・確認を飛ばす API も
 * 作らない（公開する名前は boundarySurface.test.ts が固定している）。
 */
export { fileReadTargetFacts, fileWriteTargetFacts } from './boundaryFacts'
export { resolveAgentWorkspaceTarget } from './currentWorkspaceBoundary'
export {
  confirmOpenedWorkspaceFile,
  isVerifiedWorkspaceTarget,
  recheckWorkspaceTarget
} from './workspaceBoundary'

export type {
  FileIdentity,
  VerifiedWorkspaceTarget,
  WorkspaceAccess,
  WorkspaceBoundaryDenial,
  WorkspaceBoundaryResult,
  WorkspaceTargetState
} from './workspaceBoundary'
