import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isWindows } from '../platform'
import {
  searchWorkspaceFileContents,
  type SearchWorkspaceFileContentsOutcome
} from './searchWorkspaceFileContents'

/**
 * 全文検索の走査（Session 3-6-5）の検証。
 *
 * searchWorkspaceFiles.test.ts と同じく**実際のディスクを触る。**
 * 確かめたいこと（バイナリを読み飛ばすか・大きすぎるものを避けるか・
 * リンクの先の中身が混ざらないか）は、写しの fs では何も確かめられない。
 *
 * とくに**リンクの先を読まない**ことは、ここでしか確かめられない性質にあたる ──
 * Workspace の外に置いたファイルの中身が結果に現れないことを、
 * 実際に外へリンクを張って確かめる。
 */

let root: string
/** Workspace の外。リンクの先を読んでいないことを、中身が来ないことで確かめる。 */
let outside: string

beforeEach(async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'fx-content-search-')))

  root = join(base, 'workspace')
  outside = join(base, 'outside')

  await mkdir(root)
  await mkdir(outside)
  await writeFile(join(outside, 'secret.txt'), 'needle in the outside file')
})

afterEach(async () => {
  await rm(join(root, '..'), { recursive: true, force: true }).catch(() => undefined)
})

/** 見つかったファイルの相対位置（並びも含めて確かめられる形）。 */
function pathsOf(outcome: SearchWorkspaceFileContentsOutcome): readonly string[] {
  return outcome.status === 'ok' ? outcome.files.map((file) => file.relativePath) : []
}

/** Windows のジャンクションは管理者権限なしで作れる。作れない環境では飛ばす。 */
async function tryLink(target: string, path: string, type: 'dir' | 'file'): Promise<boolean> {
  try {
    await symlink(target, path, isWindows && type === 'dir' ? 'junction' : type)
    return true
  } catch {
    return false
  }
}

describe('通常の全文検索', () => {
  it('中身の一致をファイル単位で返す', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'App.tsx'), 'const example = 1\nconst other = 2\n')
    await writeFile(join(root, 'README.md'), 'no match here\n')

    const outcome = await searchWorkspaceFileContents(root, 'example')

    expect(outcome).toMatchObject({
      status: 'ok',
      completion: 'completed',
      matchCount: 1,
      truncated: false,
      limit: null
    })
    expect(pathsOf(outcome)).toEqual(['src/App.tsx'])

    if (outcome.status !== 'ok') {
      throw new Error('検索が成立していない')
    }

    expect(outcome.files[0]?.matches[0]).toMatchObject({
      line: 1,
      column: 7,
      preview: 'const example = 1'
    })
    expect(outcome.files[0]?.name).toBe('App.tsx')
  })

  it('大文字 / 小文字を区別しない', async () => {
    await writeFile(join(root, 'a.txt'), 'Needle\n')

    expect(pathsOf(await searchWorkspaceFileContents(root, 'needle'))).toEqual(['a.txt'])
    expect(pathsOf(await searchWorkspaceFileContents(root, 'NEEDLE'))).toEqual(['a.txt'])
  })

  it('日本語を検索できる', async () => {
    await writeFile(join(root, 'notes.md'), '# 見出し\n本文に検索語が入っている\n', 'utf8')

    const outcome = await searchWorkspaceFileContents(root, '検索語')

    expect(pathsOf(outcome)).toEqual(['notes.md'])

    if (outcome.status !== 'ok') {
      throw new Error('検索が成立していない')
    }

    expect(outcome.files[0]?.matches[0]).toMatchObject({ line: 2, column: 4 })
  })

  it('1ファイルの複数の一致をすべて返す', async () => {
    await writeFile(join(root, 'a.txt'), 'hit\nmiss\nhit hit\n')

    const outcome = await searchWorkspaceFileContents(root, 'hit')

    if (outcome.status !== 'ok') {
      throw new Error('検索が成立していない')
    }

    expect(outcome.matchCount).toBe(3)
    expect(outcome.files[0]?.matches.map((match) => [match.line, match.column])).toEqual([
      [1, 1],
      [3, 1],
      [3, 5]
    ])
  })

  it('BOM 付きのファイルでも1行目の桁がずれない', async () => {
    await writeFile(join(root, 'bom.txt'), '﻿hit at start\n', 'utf8')

    const outcome = await searchWorkspaceFileContents(root, 'hit')

    if (outcome.status !== 'ok') {
      throw new Error('検索が成立していない')
    }

    expect(outcome.files[0]?.matches[0]).toMatchObject({ line: 1, column: 1 })
  })

  it('空の検索語・改行を含む検索語は受け付けない', async () => {
    await writeFile(join(root, 'a.txt'), 'hit\n')

    expect(await searchWorkspaceFileContents(root, '')).toEqual({ status: 'invalid-query' })
    expect(await searchWorkspaceFileContents(root, 'a\nb')).toEqual({ status: 'invalid-query' })
    expect(await searchWorkspaceFileContents(root, 42)).toEqual({ status: 'invalid-query' })
  })

  it('Workspace が無ければ not-found', async () => {
    expect(await searchWorkspaceFileContents(join(root, 'missing'), 'hit')).toEqual({
      status: 'not-found'
    })
  })
})

describe('読まないもの', () => {
  it('バイナリは読み飛ばす', async () => {
    await writeFile(join(root, 'binary.bin'), Buffer.from([0x68, 0x69, 0x74, 0x00, 0x68, 0x69]))
    await writeFile(join(root, 'text.txt'), 'hi\n')

    const outcome = await searchWorkspaceFileContents(root, 'hi')

    expect(pathsOf(outcome)).toEqual(['text.txt'])

    if (outcome.status !== 'ok') {
      throw new Error('検索が成立していない')
    }

    // 読んだのはテキストの1件だけ（バイナリは数にも入らない）。
    expect(outcome.searchedFileCount).toBe(1)
  })

  it('大きすぎるファイルは読み飛ばす', async () => {
    await writeFile(join(root, 'big.txt'), `${'x'.repeat(4096)}\nhit\n`)
    await writeFile(join(root, 'small.txt'), 'hit\n')

    const outcome = await searchWorkspaceFileContents(root, 'hit', { maxFileBytes: 512 })

    expect(pathsOf(outcome)).toEqual(['small.txt'])
  })

  it('.git / node_modules の中は見ない', async () => {
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'node_modules'))
    await mkdir(join(root, 'src'))
    await writeFile(join(root, '.git', 'config'), 'hit\n')
    await writeFile(join(root, 'node_modules', 'index.js'), 'hit\n')
    await writeFile(join(root, 'src', 'index.ts'), 'hit\n')

    expect(pathsOf(await searchWorkspaceFileContents(root, 'hit'))).toEqual(['src/index.ts'])
  })

  it('Workspace の外を指すリンクの中身は返さない', async () => {
    const linked = await tryLink(join(outside, 'secret.txt'), join(root, 'link.txt'), 'file')

    if (!linked) {
      return
    }

    await writeFile(join(root, 'inside.txt'), 'needle inside\n')

    const outcome = await searchWorkspaceFileContents(root, 'needle')

    // リンクは読まない ── 外の実体の中身が preview に載ることは無い。
    expect(pathsOf(outcome)).toEqual(['inside.txt'])
  })

  it('Workspace の外を指すフォルダのリンクへは潜らない', async () => {
    const linked = await tryLink(outside, join(root, 'outside-link'), 'dir')

    if (!linked) {
      return
    }

    expect(pathsOf(await searchWorkspaceFileContents(root, 'needle'))).toEqual([])
  })
})

describe('上限', () => {
  it('読むファイル数で打ち切る', async () => {
    for (let index = 0; index < 5; index += 1) {
      await writeFile(join(root, `file-${index}.txt`), 'hit\n')
    }

    const outcome = await searchWorkspaceFileContents(root, 'hit', { maxFiles: 2 })

    expect(outcome).toMatchObject({ status: 'ok', truncated: true, limit: 'files' })
    expect(pathsOf(outcome)).toHaveLength(2)
  })

  it('一致の総数で打ち切る', async () => {
    await writeFile(join(root, 'a.txt'), 'hit\nhit\nhit\nhit\n')

    const outcome = await searchWorkspaceFileContents(root, 'hit', { maxMatches: 2 })

    expect(outcome).toMatchObject({
      status: 'ok',
      matchCount: 2,
      truncated: true,
      limit: 'matches'
    })
  })

  it('1ファイル内の上限は、そのファイルの truncated として伝える', async () => {
    await writeFile(join(root, 'a.txt'), 'hit\nhit\nhit\n')

    const outcome = await searchWorkspaceFileContents(root, 'hit', { maxMatchesPerFile: 2 })

    expect(outcome).toMatchObject({ status: 'ok', truncated: true, limit: 'file-matches' })

    if (outcome.status !== 'ok') {
      throw new Error('検索が成立していない')
    }

    expect(outcome.files[0]).toMatchObject({ truncated: true })
    expect(outcome.files[0]?.matches).toHaveLength(2)
  })

  it('深さで潜るのをやめる', async () => {
    await mkdir(join(root, 'a', 'b'), { recursive: true })
    await writeFile(join(root, 'a', 'shallow.txt'), 'hit\n')
    await writeFile(join(root, 'a', 'b', 'deep.txt'), 'hit\n')

    const outcome = await searchWorkspaceFileContents(root, 'hit', { maxDepth: 1 })

    expect(pathsOf(outcome)).toEqual(['a/shallow.txt'])
    expect(outcome).toMatchObject({ truncated: true, limit: 'depth' })
  })

  it('走査数で打ち切る', async () => {
    for (let index = 0; index < 5; index += 1) {
      await writeFile(join(root, `file-${index}.txt`), 'hit\n')
    }

    const outcome = await searchWorkspaceFileContents(root, 'hit', { maxScannedEntries: 2 })

    expect(outcome).toMatchObject({ status: 'ok', truncated: true, limit: 'scanned' })
  })

  it('時間で打ち切る', async () => {
    await writeFile(join(root, 'a.txt'), 'hit\n')

    /*
      2度目に見た時点で上限を超えている時計を渡す（実時間に依存させない）。
      1度目は「始めた時刻」として使われる。
    */
    let reads = 0

    const outcome = await searchWorkspaceFileContents(root, 'hit', {
      timeBudgetMs: 1,
      now: () => {
        reads += 1
        return reads === 1 ? 0 : 10_000
      }
    })

    expect(outcome).toMatchObject({ status: 'ok', truncated: true, limit: 'time' })
    expect(pathsOf(outcome)).toEqual([])
  })
})

describe('取り消し', () => {
  it('取り消されたら completion が cancelled になる（失敗ではない）', async () => {
    await writeFile(join(root, 'a.txt'), 'hit\n')

    const outcome = await searchWorkspaceFileContents(root, 'hit', {
      cancellation: { cancelled: true }
    })

    expect(outcome).toMatchObject({ status: 'ok', completion: 'cancelled' })
    expect(pathsOf(outcome)).toEqual([])
  })
})
