import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile
} from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isWindows } from '../platform'
import { copyDirectoryContents } from './copyTree'

/**
 * フォルダの再帰コピーの検証。
 *
 * mutateWorkspaceEntry.test.ts と同じく**実際のディスクを触る。** 確かめたいことが
 * 「リンクを辿らないか」「中身がそのまま運べているか」という、写しの fs では
 * 何も確かめられない性質のものだからにほかならない
 * （ジャンクションを lstat がどう答えるかを決めるのは OS であって、この実装ではない）。
 *
 * ここには Workspace の話が出てこない。境界の検証は呼び出し側
 * （mutateWorkspaceEntry.ts）が済ませてから呼ぶ形にしてあり、
 * この層が持つのは「2点の間で fs をどう回すか」だけになる。
 */

let base: string
let source: string
let destination: string
/** コピー範囲の外。リンクを辿っていないことを、中身が来ていないことで確かめる。 */
let outside: string

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'fx-copytree-')))

  source = join(base, 'source')
  destination = join(base, 'destination')
  outside = join(base, 'outside')

  await mkdir(source)
  await mkdir(destination)
  await mkdir(outside)
  await writeFile(join(outside, 'secret.txt'), 'secret')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true }).catch(() => undefined)
})

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

describe('copyDirectoryContents', () => {
  it('ファイルを中身ごと運ぶ', async () => {
    await writeFile(join(source, 'main.ts'), 'hello')

    expect(await copyDirectoryContents(source, destination)).toEqual({
      status: 'ok',
      skippedCount: 0
    })

    expect(await readFile(join(destination, 'main.ts'), 'utf8')).toBe('hello')
    // 元は残る。
    expect(await readFile(join(source, 'main.ts'), 'utf8')).toBe('hello')
  })

  it('深い階層をそのまま運ぶ', async () => {
    await mkdir(join(source, 'a', 'b', 'c', 'd'), { recursive: true })
    await writeFile(join(source, 'a', 'b', 'c', 'd', 'deep.txt'), 'deep')
    await writeFile(join(source, 'a', 'top.txt'), 'top')

    expect(await copyDirectoryContents(source, destination)).toMatchObject({ status: 'ok' })

    expect(await readFile(join(destination, 'a', 'b', 'c', 'd', 'deep.txt'), 'utf8')).toBe('deep')
    expect(await readFile(join(destination, 'a', 'top.txt'), 'utf8')).toBe('top')
  })

  /*
    空のフォルダは中身が無いだけで、形としては運ぶ対象。とばすと
    「コピーしたのにフォルダが消えている」になる。
  */
  it('空のフォルダも作る', async () => {
    await mkdir(join(source, 'empty'))
    await mkdir(join(source, 'nested'))
    await mkdir(join(source, 'nested', 'alsoEmpty'))

    expect(await copyDirectoryContents(source, destination)).toMatchObject({ status: 'ok' })

    expect(await readdir(join(destination, 'empty'))).toEqual([])
    expect(await readdir(join(destination, 'nested', 'alsoEmpty'))).toEqual([])
  })

  it('中身がまったく無くても成功する', async () => {
    expect(await copyDirectoryContents(source, destination)).toEqual({
      status: 'ok',
      skippedCount: 0
    })
  })

  it('末尾に空白を持つ名前も字義どおり運ぶ', async () => {
    await writeFile(join(source, 'notes.txt'), 'the neighbour')
    await writeFile(join(source, 'notes.txt '), 'the real one')

    expect(await copyDirectoryContents(source, destination)).toMatchObject({ status: 'ok' })

    expect(await readFile(join(destination, 'notes.txt'), 'utf8')).toBe('the neighbour')
    expect(await readFile(join(destination, 'notes.txt '), 'utf8')).toBe('the real one')
  })

  /*
    行き先が無い（呼び出し側が作る約束を破った場合）。投げずに結末として返し、
    途中まで作ったものはそのまま残す ── 片付けに fs.rm を持ち出さない。
  */
  it('行き先が無ければ失敗として返す（例外にしない）', async () => {
    await writeFile(join(source, 'main.ts'), 'x')

    const outcome = await copyDirectoryContents(source, join(base, 'missing'))

    expect(outcome.status).toBe('failed')
  })

  it('行き先に同名のものがあれば上書きせずに失敗する', async () => {
    await writeFile(join(source, 'main.ts'), 'new')
    await writeFile(join(destination, 'main.ts'), 'existing')

    expect(await copyDirectoryContents(source, destination)).toMatchObject({ status: 'failed' })

    expect(await readFile(join(destination, 'main.ts'), 'utf8')).toBe('existing')
  })

  /* ------------------------------------------------ リンクを辿らない */

  /**
   * Windows のジャンクションは管理者権限なしで作れる。作れない環境では飛ばす
   * （作れないことを失敗として報告しても直しようがない）。
   */
  async function tryLink(target: string, path: string): Promise<boolean> {
    try {
      await symlink(target, path, isWindows ? 'junction' : 'dir')
      return true
    } catch {
      return false
    }
  }

  it('外を指すリンクは辿らず、数えてとばす', async ({ skip }) => {
    if (!(await tryLink(outside, join(source, 'link')))) {
      skip()
    }

    await writeFile(join(source, 'main.ts'), 'x')

    expect(await copyDirectoryContents(source, destination)).toEqual({
      status: 'ok',
      skippedCount: 1
    })

    // リンクそのものも、その指し先の中身も、コピー先には現れない。
    expect(await exists(join(destination, 'link'))).toBe(false)
    expect(await exists(join(destination, 'secret.txt'))).toBe(false)
    // 運べるものは運ぶ（リンク1つで全体を止めない）。
    expect(await readFile(join(destination, 'main.ts'), 'utf8')).toBe('x')
  })

  /*
    中を指すリンクもとばす。辿ると、祖先を指していた場合に再帰が終わらない
    （そして「循環が無い」という前提が崩れると、深さの上限が要るようになる）。
  */
  it('中を指すリンクもとばす', async ({ skip }) => {
    await mkdir(join(source, 'real'))
    await writeFile(join(source, 'real', 'kept.txt'), 'kept')

    if (!(await tryLink(source, join(source, 'real', 'loop')))) {
      skip()
    }

    expect(await copyDirectoryContents(source, destination)).toEqual({
      status: 'ok',
      skippedCount: 1
    })

    expect(await readFile(join(destination, 'real', 'kept.txt'), 'utf8')).toBe('kept')
    expect(await exists(join(destination, 'real', 'loop'))).toBe(false)
  })

  it('深いところにあるリンクもとばして数える', async ({ skip }) => {
    await mkdir(join(source, 'a', 'b'), { recursive: true })

    const first = await tryLink(outside, join(source, 'a', 'one'))
    const second = await tryLink(outside, join(source, 'a', 'b', 'two'))

    if (!first || !second) {
      skip()
    }

    expect(await copyDirectoryContents(source, destination)).toEqual({
      status: 'ok',
      skippedCount: 2
    })

    expect(await exists(join(destination, 'a', 'b'))).toBe(true)
    expect(await exists(join(destination, 'a', 'one'))).toBe(false)
    expect(await exists(join(destination, 'a', 'b', 'two'))).toBe(false)
    expect(await exists(join(outside, 'secret.txt'))).toBe(true)
  })

  /*
    ファイルを指すリンクも同じ扱い。**指し先の中身を持ってこない**ことが要点で、
    種別で例外を作ると「ファイルなら辿ってよい」という抜け道になる。
  */
  it('ファイルを指すリンクも辿らない', async ({ skip }) => {
    try {
      await symlink(join(outside, 'secret.txt'), join(source, 'shortcut.txt'), 'file')
    } catch {
      skip()
    }

    expect(await copyDirectoryContents(source, destination)).toEqual({
      status: 'ok',
      skippedCount: 1
    })

    expect(await exists(join(destination, 'shortcut.txt'))).toBe(false)
  })
})
