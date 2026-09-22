import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 今の Workspace に対する入口（Security Core v1 の STEP2）。
 *
 * root は Main の正本（currentWorkspaceFolder.ts）からだけ取り、取れなければ拒否すること。
 */

const workspace = vi.hoisted(() => ({
  current: null as { rootPath: string } | null,
  fail: false
}))

vi.mock('../../workspaceFolder/currentWorkspaceFolder', () => ({
  getCurrentWorkspaceFolder: () => {
    if (workspace.fail) {
      throw new Error('store is broken')
    }

    return workspace.current
  }
}))

const { resolveAgentWorkspaceTarget } = await import('./currentWorkspaceBoundary')

let base: string

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'fx-boundary-current-')))
  await mkdir(join(base, 'workspace'))
  await writeFile(join(base, 'workspace', 'a.txt'), 'inside')

  workspace.current = { rootPath: join(base, 'workspace') }
  workspace.fail = false
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('resolveAgentWorkspaceTarget', () => {
  it('今の Workspace の root で確かめる', async () => {
    const result = await resolveAgentWorkspaceTarget('a.txt', 'read')

    expect(result.ok && result.target.realPath).toBe(join(base, 'workspace', 'a.txt'))
  })

  it('Workspace が開いていなければ no-workspace', async () => {
    workspace.current = null

    expect(await resolveAgentWorkspaceTarget('a.txt', 'read')).toEqual({
      ok: false,
      denial: 'no-workspace'
    })
  })

  it('Workspace を取得できなければ no-workspace（中には倒さない）', async () => {
    workspace.fail = true

    expect(await resolveAgentWorkspaceTarget('a.txt', 'read')).toEqual({
      ok: false,
      denial: 'no-workspace'
    })
  })

  it('保存された root が消えていれば no-workspace', async () => {
    workspace.current = { rootPath: join(base, 'gone') }

    expect(await resolveAgentWorkspaceTarget('a.txt', 'read')).toEqual({
      ok: false,
      denial: 'no-workspace'
    })
  })

  it('root を引数で差し替える口は無い（2つ目までしか読まない）', async () => {
    const call = resolveAgentWorkspaceTarget as unknown as (...args: unknown[]) => Promise<unknown>
    const result = (await call('a.txt', 'read', base)) as {
      ok: boolean
      target?: { realRootPath: string }
    }

    expect(result.ok && result.target?.realRootPath).toBe(join(base, 'workspace'))
  })
})
