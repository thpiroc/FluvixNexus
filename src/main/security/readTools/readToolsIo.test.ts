import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isWindows } from '../../platform'
import { resolveWorkspaceTarget, type VerifiedWorkspaceTarget } from '../boundary/workspaceBoundary'
import {
  confirmPinnedWorkspaceRoot,
  listPinnedWorkspaceDirectory,
  readVerifiedFileBytes,
  resolvePinnedWorkspaceTarget
} from './readToolsIo'

/**
 * root を固定した確かめた読み取り（Security Core v1 の STEP9.1）。
 *
 * Boundary（STEP2）は本物を通し、実際のディスクに対して確かめる。フォルダのリンクは
 * Windows ではジャンクション（権限なしで作れる）、それ以外では symlink を使う。
 */

let base: string
let root: string
let outside: string

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'fx-read-tools-io-')))
  root = join(base, 'workspace')
  outside = join(base, 'outside')

  await mkdir(join(root, 'sub'), { recursive: true })
  await mkdir(outside)
  await writeFile(join(root, 'sub', 'a.txt'), 'inside\n')
  await writeFile(join(outside, 'a.txt'), 'outside\n')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

async function linkDirectory(target: string, path: string): Promise<void> {
  await symlink(target, path, isWindows ? 'junction' : 'dir')
}

async function pinnedRoot(): Promise<VerifiedWorkspaceTarget> {
  const resolved = await resolveWorkspaceTarget(root, '', 'read')

  if (!resolved.ok) {
    throw new Error(`root を確かめられない: ${resolved.denial}`)
  }

  return resolved.target
}

/** root を外のフォルダへのリンクに差し替える。 */
async function swapRoot(): Promise<void> {
  await rename(root, join(base, 'workspace-moved'))
  await linkDirectory(outside, root)
}

describe('root の固定', () => {
  it('変わっていなければ同じ root', async () => {
    expect(await confirmPinnedWorkspaceRoot(await pinnedRoot())).toBe(true)
  })

  it('root を外へのリンクに差し替えたら、同じ root ではない', async () => {
    const pinned = await pinnedRoot()

    await swapRoot()

    expect(await confirmPinnedWorkspaceRoot(pinned)).toBe(false)
    expect(await resolvePinnedWorkspaceTarget(pinned, 'a.txt', 'file')).toEqual({
      ok: false,
      rootChanged: true
    })
    expect(await listPinnedWorkspaceDirectory(pinned, '')).toEqual({
      ok: false,
      rootChanged: true
    })
  })

  it('root が消えたら、同じ root ではない', async () => {
    const pinned = await pinnedRoot()

    await rm(root, { recursive: true, force: true })

    expect(await confirmPinnedWorkspaceRoot(pinned)).toBe(false)
    expect(await resolvePinnedWorkspaceTarget(pinned, 'sub/a.txt', 'file')).toEqual({
      ok: false,
      rootChanged: true
    })
  })

  it('root 以外の対象・Boundary が発行していない形は、固定できる root として扱わない', async () => {
    const file = await resolveWorkspaceTarget(root, 'sub/a.txt', 'read')

    if (!file.ok) {
      throw new Error('対象を確かめられない')
    }

    const forged = { ...(await pinnedRoot()) }

    for (const candidate of [file.target, forged as VerifiedWorkspaceTarget]) {
      expect(await confirmPinnedWorkspaceRoot(candidate)).toBe(false)
      expect(await resolvePinnedWorkspaceTarget(candidate, 'sub/a.txt', 'file')).toEqual({
        ok: false,
        rootChanged: true
      })
    }
  })
})

describe('位置1件の確かめ直し', () => {
  it('中のファイル・フォルダは通す', async () => {
    const pinned = await pinnedRoot()

    expect(await resolvePinnedWorkspaceTarget(pinned, 'sub/a.txt', 'file')).toMatchObject({
      ok: true,
      target: { canonicalRelativePath: 'sub/a.txt', aliased: false }
    })
    expect(await resolvePinnedWorkspaceTarget(pinned, 'sub', 'directory')).toMatchObject({
      ok: true
    })
  })

  it('中を指すリンクを通る位置（aliased）は通さない', async () => {
    await linkDirectory(join(root, 'sub'), join(root, 'alias'))

    expect(await resolvePinnedWorkspaceTarget(await pinnedRoot(), 'alias/a.txt', 'file')).toEqual({
      ok: false,
      rootChanged: false
    })
  })

  it('外を指すリンクを通る位置は通さない（root は変わっていない）', async () => {
    await linkDirectory(outside, join(root, 'ext'))

    expect(await resolvePinnedWorkspaceTarget(await pinnedRoot(), 'ext/a.txt', 'file')).toEqual({
      ok: false,
      rootChanged: false
    })
  })

  it('無い位置・種別の違う位置は通さない', async () => {
    const pinned = await pinnedRoot()

    for (const [path, kind] of [
      ['missing.txt', 'file'],
      ['sub', 'file'],
      ['sub/a.txt', 'directory']
    ] as const) {
      expect(await resolvePinnedWorkspaceTarget(pinned, path, kind)).toEqual({
        ok: false,
        rootChanged: false
      })
    }
  })
})

describe('確かめたハンドル越しの読み取り', () => {
  it('確かめた後で別のファイルに置き換えられたら（identity 不一致）、読まない', async () => {
    const resolved = await resolvePinnedWorkspaceTarget(await pinnedRoot(), 'sub/a.txt', 'file')

    if (!resolved.ok) {
      throw new Error('対象を確かめられない')
    }

    await rm(join(root, 'sub', 'a.txt'))
    await writeFile(join(root, 'sub', 'a.txt'), 'replaced\n')

    expect(await readVerifiedFileBytes(resolved.target)).toEqual({
      ok: false,
      denial: 'handle-unconfirmed'
    })
  })

  it('確かめた後で途中のフォルダを外へのリンクに差し替えたら、外は読まない', async () => {
    const resolved = await resolvePinnedWorkspaceTarget(await pinnedRoot(), 'sub/a.txt', 'file')

    if (!resolved.ok) {
      throw new Error('対象を確かめられない')
    }

    await rename(join(root, 'sub'), join(base, 'sub-moved'))
    await linkDirectory(outside, join(root, 'sub'))

    expect(await readVerifiedFileBytes(resolved.target)).toEqual({
      ok: false,
      denial: 'handle-unconfirmed'
    })
  })
})

describe('フォルダを並べる', () => {
  it('root と中のフォルダを並べる', async () => {
    const pinned = await pinnedRoot()
    const top = await listPinnedWorkspaceDirectory(pinned, '')
    const sub = await listPinnedWorkspaceDirectory(pinned, 'sub')

    expect(top.ok && top.entries.map((entry) => entry.name)).toEqual(['sub'])
    expect(sub.ok && sub.entries.map((entry) => entry.name)).toEqual(['a.txt'])
  })

  it('外へのリンクに差し替えられたフォルダは、並べる前に落とす', async () => {
    const pinned = await pinnedRoot()

    await rename(join(root, 'sub'), join(base, 'sub-moved'))
    await linkDirectory(outside, join(root, 'sub'))

    expect(await listPinnedWorkspaceDirectory(pinned, 'sub')).toEqual({
      ok: false,
      rootChanged: false
    })
  })

  it('消えたフォルダ・ファイルは並べない', async () => {
    const pinned = await pinnedRoot()

    expect(await listPinnedWorkspaceDirectory(pinned, 'missing')).toEqual({
      ok: false,
      rootChanged: false
    })
    expect(await listPinnedWorkspaceDirectory(pinned, 'sub/a.txt')).toEqual({
      ok: false,
      rootChanged: false
    })
  })
})
