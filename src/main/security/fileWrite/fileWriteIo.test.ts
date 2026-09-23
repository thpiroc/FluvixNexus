import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isWindows } from '../../platform'
import {
  resolveWorkspaceTarget,
  type VerifiedWorkspaceTarget,
  type WorkspaceBoundaryResult
} from '../boundary/workspaceBoundary'
import { readCurrentFile, writeConfirmedFile } from './fileWriteIo'

/**
 * 実際にディスクを読む / 書く部分（Security Core v1 の STEP7）。
 *
 * 一時フォルダへ本物のファイルを作って確かめる。**Boundary（STEP2）が確かめた対象
 * しか渡さない** ── この層は「確かめた対象を、確かめたまま触る」ことだけを持つ。
 *
 * ```
 * base/
 *   workspace/       ← root
 *     a.txt
 *     sub/
 *   outside/
 * ```
 */

let base: string
let root: string
let outside: string

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'fx-file-write-')))
  root = join(base, 'workspace')
  outside = join(base, 'outside')

  await mkdir(join(root, 'sub'), { recursive: true })
  await mkdir(outside)
  await writeFile(join(root, 'a.txt'), 'one\ntwo\n')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

async function target(relativePath: string): Promise<VerifiedWorkspaceTarget> {
  return expectTarget(await resolveWorkspaceTarget(root, relativePath, 'write'))
}

function expectTarget(result: WorkspaceBoundaryResult): VerifiedWorkspaceTarget {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.denial}`)
  }

  return result.target
}

async function hashOfCurrent(relativePath: string): Promise<string> {
  const current = await readCurrentFile(await target(relativePath))

  if (!current.ok) {
    throw new Error(`expected ok, got ${current.denial}`)
  }

  return current.contentHash
}

/** ファイルの symlink。Windows では権限が要るため、作れなければ false。 */
async function tryLinkFile(source: string, path: string): Promise<boolean> {
  try {
    await symlink(source, path, 'file')
    return true
  } catch {
    return false
  }
}

describe('今の中身を読む', () => {
  it('本文と文字コードを返す', async () => {
    const current = await readCurrentFile(await target('a.txt'))

    expect(current.ok && current.text).toBe('one\ntwo\n')
    expect(current.ok && current.encoding).toBe('utf8')
  })

  it('BOM 付きは utf8-bom として読み、本文からは BOM を落とす', async () => {
    await writeFile(join(root, 'bom.txt'), Buffer.from('﻿hello', 'utf8'))

    const current = await readCurrentFile(await target('bom.txt'))

    expect(current.ok && current.encoding).toBe('utf8-bom')
    expect(current.ok && current.text).toBe('hello')
  })

  it('binary は拒む', async () => {
    await writeFile(join(root, 'bin.dat'), Buffer.from([0x01, 0x00, 0x02]))

    expect(await readCurrentFile(await target('bin.dat'))).toEqual({
      ok: false,
      denial: 'unsupported-content'
    })
  })

  it('まだ無いファイルは読めない', async () => {
    expect(await readCurrentFile(await target('sub/new.txt'))).toEqual({
      ok: false,
      denial: 'invalid-request'
    })
  })

  it('中身が同じなら、指紋も同じ', async () => {
    const first = await hashOfCurrent('a.txt')

    await writeFile(join(root, 'b.txt'), 'one\ntwo\n')

    expect(await hashOfCurrent('b.txt')).toBe(first)
  })
})

describe('既存ファイルへ書く', () => {
  it('書いた通りの中身になる', async () => {
    const hash = await hashOfCurrent('a.txt')
    const result = await writeConfirmedFile(await target('a.txt'), Buffer.from('next\n'), hash)

    expect(result).toEqual({ ok: true })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('next\n')
  })

  it('短くなる変更でも、古い中身が残らない（truncate している）', async () => {
    const hash = await hashOfCurrent('a.txt')

    await writeConfirmedFile(await target('a.txt'), Buffer.from('x'), hash)

    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('x')
  })

  it('空の本文でも書ける', async () => {
    const hash = await hashOfCurrent('a.txt')

    expect(await writeConfirmedFile(await target('a.txt'), Buffer.alloc(0), hash)).toEqual({
      ok: true
    })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('')
  })

  it('承認したときから中身が変わっていたら書かない', async () => {
    const hash = await hashOfCurrent('a.txt')
    const resolved = await target('a.txt')

    // 承認を見せている間に、別のプロセスが書き換えた。
    await writeFile(join(root, 'a.txt'), 'changed by someone else\n')

    expect(await writeConfirmedFile(resolved, Buffer.from('next\n'), hash)).toEqual({
      ok: false,
      denial: 'existing-file-changed'
    })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('changed by someone else\n')
  })

  it('指紋を渡さずに既存ファイルへ書こうとしたら拒む', async () => {
    expect(await writeConfirmedFile(await target('a.txt'), Buffer.from('x'), null)).toEqual({
      ok: false,
      denial: 'invalid-request'
    })
  })

  it('確かめた後に消されていたら書かない', async () => {
    const hash = await hashOfCurrent('a.txt')
    const resolved = await target('a.txt')

    await rm(join(root, 'a.txt'))

    expect(await writeConfirmedFile(resolved, Buffer.from('x'), hash)).toEqual({
      ok: false,
      denial: 'not-found'
    })
  })

  it('確かめた後に hard link を張られたら書かない', async () => {
    const hash = await hashOfCurrent('a.txt')
    const resolved = await target('a.txt')

    await link(join(root, 'a.txt'), join(root, 'sub', 'linked.txt'))

    expect(await writeConfirmedFile(resolved, Buffer.from('x'), hash)).toEqual({
      ok: false,
      denial: 'handle-unconfirmed'
    })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
  })

  it('確かめた後に別のファイルへ差し替えられたら書かない', async () => {
    const hash = await hashOfCurrent('a.txt')
    const resolved = await target('a.txt')

    await rm(join(root, 'a.txt'))
    await writeFile(join(root, 'a.txt'), 'a different file\n')

    expect(await writeConfirmedFile(resolved, Buffer.from('x'), hash)).toEqual({
      ok: false,
      denial: 'handle-unconfirmed'
    })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('a different file\n')
  })

  it('確かめた後に symlink へ差し替えられたら書かない', async () => {
    const hash = await hashOfCurrent('a.txt')
    const resolved = await target('a.txt')

    await writeFile(join(outside, 'victim.txt'), 'outside\n')
    await rm(join(root, 'a.txt'))

    if (!(await tryLinkFile(join(outside, 'victim.txt'), join(root, 'a.txt')))) {
      return
    }

    expect(await writeConfirmedFile(resolved, Buffer.from('x'), hash)).toEqual({
      ok: false,
      denial: 'handle-unconfirmed'
    })
    expect(await readFile(join(outside, 'victim.txt'), 'utf8')).toBe('outside\n')
  })
})

describe('新しいファイルを作る', () => {
  it('作って、書いた通りの中身になる', async () => {
    const result = await writeConfirmedFile(
      await target('sub/new.txt'),
      Buffer.from('created\n'),
      null
    )

    expect(result).toEqual({ ok: true })
    expect(await readFile(join(root, 'sub', 'new.txt'), 'utf8')).toBe('created\n')
  })

  it('空のファイルも作れる（作った後に消してしまわない）', async () => {
    expect(await writeConfirmedFile(await target('sub/empty.txt'), Buffer.alloc(0), null)).toEqual({
      ok: true
    })
    expect(await readFile(join(root, 'sub', 'empty.txt'), 'utf8')).toBe('')
  })

  it('確かめてから作るまでの間に、同じ位置へファイルができていたら作らない', async () => {
    const resolved = await target('sub/new.txt')

    await writeFile(join(root, 'sub', 'new.txt'), 'someone else\n')

    expect(await writeConfirmedFile(resolved, Buffer.from('mine\n'), null)).toEqual({
      ok: false,
      denial: 'target-exists'
    })
    expect(await readFile(join(root, 'sub', 'new.txt'), 'utf8')).toBe('someone else\n')
  })

  it('指紋を渡して新規作成しようとしたら拒む', async () => {
    expect(await writeConfirmedFile(await target('sub/new.txt'), Buffer.from('x'), 'abc')).toEqual({
      ok: false,
      denial: 'invalid-request'
    })
  })

  it('親が消えていたら作らない', async () => {
    const resolved = await target('sub/new.txt')

    await rm(join(root, 'sub'), { recursive: true })

    expect(await writeConfirmedFile(resolved, Buffer.from('x'), null)).toEqual({
      ok: false,
      denial: 'open-failed'
    })
  })

  it('親が Workspace の外を指すリンクへ差し替えられても、外へファイルを残さない', async () => {
    const resolved = await target('sub/new.txt')

    await rm(join(root, 'sub'), { recursive: true })
    await symlink(outside, join(root, 'sub'), isWindows ? 'junction' : 'dir')

    const result = await writeConfirmedFile(resolved, Buffer.from('escaped\n'), null)

    expect(result.ok).toBe(false)

    // 中身は1バイトも書かれず、作ってしまった空のファイルも片付いている。
    await expect(readFile(join(outside, 'new.txt'), 'utf8')).rejects.toThrow()
  })
})

describe('確かめた対象しか触らない', () => {
  it('読み取りとして確かめた対象では書けない', async () => {
    const readTarget = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'read'))
    const hash = await hashOfCurrent('a.txt')

    expect(await writeConfirmedFile(readTarget, Buffer.from('x'), hash)).toEqual({
      ok: false,
      denial: 'invalid-request'
    })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
  })

  it('Boundary が作ったものでない対象は触らない', async () => {
    const fake = {
      access: 'write',
      rootPath: root,
      realRootPath: root,
      requestedRelativePath: 'a.txt',
      realPath: join(root, 'a.txt'),
      canonicalRelativePath: 'a.txt',
      aliased: false,
      state: { kind: 'file', identity: { dev: 0n, ino: 0n }, linkCount: 1n }
    } as unknown as VerifiedWorkspaceTarget

    expect(await writeConfirmedFile(fake, Buffer.from('x'), 'abc')).toEqual({
      ok: false,
      denial: 'handle-unconfirmed'
    })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
  })
})
