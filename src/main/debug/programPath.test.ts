import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'fs/promises'
import { realpathSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkDebugProgramPathForSave,
  resolveDebugProgramPath,
  type DebugProgramFileSystem
} from './programPath'

/**
 * program の相対位置の2段の検証（Session 6-10）。
 *
 * **実ディスクで確かめる。** 境界の2段目は symlink / ジャンクションの指し先を見ることで、
 * 偽の fs では「本当に realpath が外を返したか」を確かめられない
 * （main/files/readWorkspaceFile.ts のテストと同じ判断）。
 */

const fileSystem: DebugProgramFileSystem = {
  realpath: (path) => realpathSync.native(path),
  isFile: (path) => {
    try {
      return statSync(path).isFile()
    } catch {
      return false
    }
  }
}

let base: string
let root: string
let outside: string

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'fx-program-path-')))
  root = join(base, 'workspace')
  outside = join(base, 'outside')

  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(outside)
  await writeFile(join(root, 'src', 'app.js'), 'console.log(1)\n')
  await writeFile(join(outside, 'evil.js'), 'console.log(2)\n')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

/** Windows ではジャンクション（管理者権限が要らない）、それ以外はディレクトリの symlink。 */
async function linkDirectory(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir')
    return true
  } catch {
    return false
  }
}

describe('resolveDebugProgramPath (start time)', () => {
  it('resolves a file inside the workspace to its real path', () => {
    expect(resolveDebugProgramPath(root, 'src/app.js', fileSystem)).toEqual({
      status: 'ok',
      absolutePath: join(root, 'src', 'app.js'),
      rootRealPath: root
    })
  })

  it.each(['../outside/evil.js', 'C:\\Windows\\notepad.exe', '/etc/passwd', '', 'a\0b'])(
    'rejects %j at the string stage',
    (relativePath) => {
      expect(resolveDebugProgramPath(root, relativePath, fileSystem)).toEqual({
        status: 'invalid-path'
      })
    }
  )

  it('rejects a link inside the workspace that points outside', async ({ skip }) => {
    if (!(await linkDirectory(outside, join(root, 'linked')))) {
      skip()
    }

    expect(resolveDebugProgramPath(root, 'linked/evil.js', fileSystem)).toEqual({
      status: 'outside-workspace'
    })
  })

  it('accepts a link inside the workspace that points inside', async ({ skip }) => {
    if (!(await linkDirectory(join(root, 'src'), join(root, 'alias')))) {
      skip()
    }

    expect(resolveDebugProgramPath(root, 'alias/app.js', fileSystem)).toEqual({
      status: 'ok',
      absolutePath: join(root, 'src', 'app.js'),
      rootRealPath: root
    })
  })

  it('reports a missing file and a folder as not-found', () => {
    expect(resolveDebugProgramPath(root, 'src/missing.js', fileSystem)).toEqual({
      status: 'not-found'
    })
    expect(resolveDebugProgramPath(root, 'src', fileSystem)).toEqual({ status: 'not-found' })
  })

  it('reports not-found when the workspace root itself is gone', async () => {
    await rm(root, { recursive: true, force: true })

    expect(resolveDebugProgramPath(root, 'src/app.js', fileSystem)).toEqual({
      status: 'not-found'
    })
  })
})

describe('checkDebugProgramPathForSave (save time)', () => {
  it('accepts an existing file and a file that does not exist yet', () => {
    expect(checkDebugProgramPathForSave(root, 'src/app.js', fileSystem)).toBe('ok')
    expect(checkDebugProgramPathForSave(root, 'src/not-written-yet.py', fileSystem)).toBe('ok')
  })

  it('rejects string-stage problems', () => {
    expect(checkDebugProgramPathForSave(root, '../outside/evil.js', fileSystem)).toBe(
      'invalid-path'
    )
  })

  it('rejects an existing link that points outside', async ({ skip }) => {
    if (!(await linkDirectory(outside, join(root, 'linked')))) {
      skip()
    }

    expect(checkDebugProgramPathForSave(root, 'linked/evil.js', fileSystem)).toBe(
      'outside-workspace'
    )
  })
})

describe('stage 1 without touching the disk', () => {
  it('rejects the string stage before calling realpath', () => {
    const calls: string[] = []
    const spy: DebugProgramFileSystem = {
      realpath: (path) => {
        calls.push(path)
        return path
      },
      isFile: () => true
    }

    expect(resolveDebugProgramPath('D:\\proj', '..\\x.js', spy)).toEqual({ status: 'invalid-path' })
    expect(calls).toEqual([])
  })
})
