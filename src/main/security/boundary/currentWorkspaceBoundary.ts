import { getCurrentWorkspaceFolder } from '../../workspaceFolder/currentWorkspaceFolder'
import { resolveWorkspaceTarget, type WorkspaceBoundaryResult } from './workspaceBoundary'

/**
 * 今開いている Workspace に対して、Agent が指したパスを確かめる（Security Core v1 の STEP2）。
 *
 * Agent の Gate が使う入口はこちら。**root を引数に取らない** ── Workspace root は
 * Main が持つ正本（currentWorkspaceFolder.ts）からだけ取り、Agent・Renderer が
 * 渡した root で境界を引き直せないようにする。
 *
 * Workspace が開いていない・取得に失敗した、はどちらも `no-workspace` で拒否する。
 */
export async function resolveAgentWorkspaceTarget(
  rawRelativePath: unknown,
  access: unknown
): Promise<WorkspaceBoundaryResult> {
  let rootPath: string | null

  try {
    rootPath = getCurrentWorkspaceFolder()?.rootPath ?? null
  } catch {
    rootPath = null
  }

  if (rootPath === null) {
    return NO_WORKSPACE
  }

  return resolveWorkspaceTarget(rootPath, rawRelativePath, access)
}

const NO_WORKSPACE: WorkspaceBoundaryResult = Object.freeze({
  ok: false,
  denial: 'no-workspace'
})
