import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import * as factsModule from './boundaryFacts'
import * as syntaxModule from './agentPathSyntax'
import * as boundaryModule from './workspaceBoundary'

/**
 * Workspace Boundary を緩める・飛ばす API が無いこと（Security Core v1 の STEP2）。
 *
 * policySurface.test.ts（STEP1）と同じく、公開する名前を**一覧で固定**する。
 * 名前を足すときはこのテストも書き換えることになり、そこで見直す機会が必ず生まれる。
 */

vi.mock('../../workspaceFolder/currentWorkspaceFolder', () => ({
  getCurrentWorkspaceFolder: () => null
}))

const boundaryApi = await import('./index')

/** 境界を緩める・止める口に見える名前。 */
const FORBIDDEN_NAME =
  /disable|bypass|override|skip|unsafe|allowAll|trust|force|assume|markVerified|setVerified|unchecked|insecure|grant|unlock/i

const BOUNDARY_DIRECTORY = join(__dirname)

describe('公開する名前', () => {
  it('Boundary API の入口', () => {
    expect(Object.keys(boundaryApi).sort()).toEqual([
      'confirmOpenedWorkspaceFile',
      'fileReadTargetFacts',
      'fileWriteTargetFacts',
      'isVerifiedWorkspaceTarget',
      'recheckWorkspaceTarget',
      'resolveAgentWorkspaceTarget'
    ])
  })

  it('内部の module も、決めた名前しか公開しない', () => {
    expect(Object.keys(boundaryModule).sort()).toEqual([
      'confirmOpenedWorkspaceFile',
      'isVerifiedWorkspaceTarget',
      'recheckWorkspaceTarget',
      'resolveWorkspaceTarget'
    ])
    expect(Object.keys(factsModule).sort()).toEqual(['fileReadTargetFacts', 'fileWriteTargetFacts'])
    expect(Object.keys(syntaxModule).sort()).toEqual(['normalizeAgentRelativePath'])
  })

  it('boundary フォルダのどのファイルも、境界を緩める名前を export していない', () => {
    const sources = readdirSync(BOUNDARY_DIRECTORY).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts')
    )

    expect(sources.sort()).toEqual([
      'agentPathSyntax.ts',
      'boundaryFacts.ts',
      'currentWorkspaceBoundary.ts',
      'index.ts',
      'workspaceBoundary.ts'
    ])

    for (const name of sources) {
      const exported = readFileSync(join(BOUNDARY_DIRECTORY, name), 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('export'))

      expect(exported.filter((line) => FORBIDDEN_NAME.test(line))).toEqual([])
    }
  })
})
