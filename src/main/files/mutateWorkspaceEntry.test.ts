import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile
} from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isWindows } from '../platform'
import {
  copyWorkspaceEntry,
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  moveWorkspaceEntry,
  renameWorkspaceEntry
} from './mutateWorkspaceEntry'

/**
 * 作成 / 改名 / 削除の検証。
 *
 * ## ここだけ実際のディスクを触る
 *
 * vitest.config.ts の方針（Electron に依存しない純粋なロジックだけを対象にする）に対する
 * 例外にあたる。それでもここに置いているのは、**確かめたいことがパスの文字列処理ではなく
 * 「実際にそこに在るものを操作できるか」**だからで、モックしたファイルシステムでは
 * 何も確かめられない ── 判定と実体がずれることこそが、ここで直した不具合の中身だった。
 *
 * `aux.ts` や末尾に空白を持つ名前が Windows でどう扱われるかは、
 * 実装ではなく OS が決める。写しを相手にすると、その答えを自分で書くことになる。
 *
 * Electron に触れるのは `shell.trashItem` の1つだけなので、そこだけ差し替える
 * （ごみ箱に入れる代わりに、リンクなら外し、それ以外は消す）。薄いモックで済むのは、
 * この層が Electron をほとんど使っていないため。
 */

const { trashed, trashBehavior } = vi.hoisted(() => ({
  trashed: [] as string[],
  /**
   * ごみ箱へ送れなかった場面を作るための差し込み口。
   *
   * 実物のディスクでは作れない状態があるため（他プロセスの排他ロックなど）、
   * **失敗そのものは注文して作る。** そのうえで「失敗した後に何が起きるか」
   * ── 理由をファイルシステムに訊き直す部分 ── は実物で確かめる。
   */
  trashBehavior: {
    mode: 'trash' as 'trash' | 'fail' | 'vanish-then-fail',
    /** `shell.trashItem` が実際に投げてくる文言（deleteObstacle.ts の観測表より）。 */
    message: 'Failed to perform delete operation'
  }
}))

vi.mock('electron', () => ({
  shell: {
    trashItem: async (path: string): Promise<void> => {
      const { lstat: statLink, rm: remove, unlink, rmdir } = await import('fs/promises')

      trashed.push(path)

      if (trashBehavior.mode !== 'trash') {
        // 消えるのと失敗するのが同時に起きる場合（削除と行き違った）。
        if (trashBehavior.mode === 'vanish-then-fail') {
          await remove(path, { recursive: true, force: true })
        }

        // 実物と同じく、code も errno も持たない素の Error。
        throw new Error(trashBehavior.message)
      }

      const stats = await statLink(path)

      /*
        ごみ箱へ送るのと同じように、**リンクそのもの**を外す。
        recursive な削除に任せると、ジャンクションの指し先まで消しに行く。
      */
      if (stats.isSymbolicLink()) {
        await unlink(path).catch(() => rmdir(path))
        return
      }

      await remove(path, { recursive: true, force: true })
    }
  }
}))

/** Workspace root。realpath 済み（macOS の /var → /private/var のような差を先に吸収する）。 */
let root: string
/** Workspace の外。境界を越えていないことを、実体が残っていることで確かめる。 */
let outside: string

beforeEach(async () => {
  trashed.length = 0
  trashBehavior.mode = 'trash'
  trashBehavior.message = 'Failed to perform delete operation'

  const base = await realpath(await mkdtemp(join(tmpdir(), 'fx-mutate-')))

  root = join(base, 'workspace')
  outside = join(base, 'outside')

  await mkdir(root)
  await mkdir(outside)
  await writeFile(join(outside, 'secret.txt'), 'secret')
})

afterEach(async () => {
  await rm(resolve(root, '..'), { recursive: true, force: true }).catch(() => undefined)
})

/** そのファイル / フォルダが今そこに在るか。 */
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

/**
 * 書き込みのために開けるか。
 *
 * 読み取り専用属性が効いているかを確かめるために使う。管理者 / root で走っている場合は
 * 属性を付けても開けてしまい、そのときは permission-denied を作れない。
 */
async function canOpenForWrite(path: string): Promise<boolean> {
  try {
    const handle = await open(path, 'r+')

    await handle.close()

    return true
  } catch {
    return false
  }
}

/* -------------------------------------------------------------------------- */
/* 作成                                                                        */
/* -------------------------------------------------------------------------- */

describe('createWorkspaceEntry', () => {
  it('ファイルとフォルダを作る', async () => {
    const file = await createWorkspaceEntry(root, '', 'index.ts', 'file')
    const directory = await createWorkspaceEntry(root, '', 'src', 'directory')

    expect(file).toMatchObject({ status: 'ok', entry: { name: 'index.ts', type: 'file' } })
    expect(directory).toMatchObject({ status: 'ok', entry: { name: 'src', type: 'directory' } })

    expect(await exists(join(root, 'index.ts'))).toBe(true)
    expect(await exists(join(root, 'src'))).toBe(true)
  })

  it('フォルダの中に作れる', async () => {
    await mkdir(join(root, 'src'))

    const outcome = await createWorkspaceEntry(root, 'src', 'main.ts', 'file')

    expect(outcome).toMatchObject({ status: 'ok', entry: { relativePath: 'src/main.ts' } })
  })

  it('同名のものが既にあれば作らない', async () => {
    await writeFile(join(root, 'index.ts'), 'original')

    expect(await createWorkspaceEntry(root, '', 'index.ts', 'file')).toEqual({
      status: 'already-exists'
    })

    // 上書きしていないこと（EEXIST で失敗するのであって、空にするのではない）。
    expect(await exists(join(root, 'index.ts'))).toBe(true)
  })

  /*
    「これから付ける名前」の規則は緩めていない。削除の側を分離した結果として
    作成が通るようになっていないことを、ここで固定する。
  */
  it.each([
    ['aux.ts', 'reserved'],
    ['CON', 'reserved'],
    ['notes.', 'trailing-character'],
    ['sub/notes.txt', 'invalid-characters'],
    ['..', 'dot-name'],
    ['', 'empty']
  ])('新規作成では %s を受け付けない', async (name, problem) => {
    expect(await createWorkspaceEntry(root, '', name, 'file')).toEqual({
      status: 'invalid-name',
      problem
    })
  })

  /*
    **名前は入力欄から来るので、前後の空白は落とす**（shared/files/fileName.ts の
    normalizeFileName）。相対位置を trim しないことにしたのとは話が別 ── こちらは
    「利用者が今そこに打った文字列」で、打ち間違いの空白で弾く理由が無い。

    結果として、このアプリからは末尾に空白を持つ名前が作られることはない。
    それでもディスク上には在りうる（他の OS で作られたもの）ので、
    **既にあるものを指せるか**は別に確かめる（削除の節）。
  */
  it('新しい名前の前後の空白は落として作る', async () => {
    const outcome = await createWorkspaceEntry(root, '', '  notes.txt  ', 'file')

    expect(outcome).toMatchObject({ status: 'ok', entry: { name: 'notes.txt' } })
    expect(await readdir(root)).toEqual(['notes.txt'])
  })

  it.each(['..', '../outside', 'sub/../..', resolve('/etc')])(
    'Workspace の外へ作らせない: %s',
    async (parentRelativePath) => {
      const outcome = await createWorkspaceEntry(root, parentRelativePath, 'planted.txt', 'file')

      expect(outcome.status).toBe('invalid-path')
      expect(await exists(join(outside, 'planted.txt'))).toBe(false)
    }
  )
})

/* -------------------------------------------------------------------------- */
/* 改名                                                                        */
/* -------------------------------------------------------------------------- */

describe('renameWorkspaceEntry', () => {
  it('名前を変える', async () => {
    await writeFile(join(root, 'old.ts'), 'x')

    const outcome = await renameWorkspaceEntry(root, 'old.ts', 'new.ts')

    expect(outcome).toMatchObject({
      status: 'ok',
      fromRelativePath: 'old.ts',
      entry: { name: 'new.ts', relativePath: 'new.ts', type: 'file' }
    })

    expect(await exists(join(root, 'old.ts'))).toBe(false)
    expect(await exists(join(root, 'new.ts'))).toBe(true)
  })

  it('フォルダも改名できる', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'main.ts'), 'x')

    const outcome = await renameWorkspaceEntry(root, 'src', 'app')

    expect(outcome).toMatchObject({ status: 'ok', entry: { type: 'directory' } })
    // 中身ごと動く（改名であって作り直しではない）。
    expect(await exists(join(root, 'app', 'main.ts'))).toBe(true)
  })

  it('行き先に既にあるものを上書きしない', async () => {
    await writeFile(join(root, 'a.ts'), 'a')
    await writeFile(join(root, 'b.ts'), 'b')

    expect(await renameWorkspaceEntry(root, 'a.ts', 'b.ts')).toEqual({ status: 'already-exists' })

    expect(await exists(join(root, 'a.ts'))).toBe(true)
    expect(await readdir(root)).toEqual(expect.arrayContaining(['a.ts', 'b.ts']))
  })

  it('新しい名前には作成と同じ規則が掛かる', async () => {
    await writeFile(join(root, 'old.ts'), 'x')

    expect(await renameWorkspaceEntry(root, 'old.ts', 'aux.ts')).toEqual({
      status: 'invalid-name',
      problem: 'reserved'
    })

    expect(await renameWorkspaceEntry(root, 'old.ts', 'sub/new.ts')).toEqual({
      status: 'invalid-name',
      problem: 'invalid-characters'
    })
  })

  /* 元の側には掛からない ── 既にそこに在るものを指しているだけのため。 */
  it('新規作成では受け付けない名前でも、既にあるものは改名できる', async () => {
    await writeFile(join(root, 'aux.ts'), 'x')

    const outcome = await renameWorkspaceEntry(root, 'aux.ts', 'helper.ts')

    expect(outcome).toMatchObject({ status: 'ok', entry: { name: 'helper.ts' } })
    expect(await exists(join(root, 'aux.ts'))).toBe(false)
    expect(await exists(join(root, 'helper.ts'))).toBe(true)
  })

  it('無いものは改名できない', async () => {
    expect(await renameWorkspaceEntry(root, 'missing.ts', 'new.ts')).toEqual({
      status: 'not-found'
    })
  })

  it.each(['', '..', '../outside/secret.txt', 'a:b'])(
    'Workspace の外は改名できない: %s',
    async (relativePath) => {
      expect(await renameWorkspaceEntry(root, relativePath, 'taken.txt')).toEqual({
        status: 'invalid-path'
      })

      expect(await exists(join(outside, 'secret.txt'))).toBe(true)
    }
  )
})

/* -------------------------------------------------------------------------- */
/* 移動                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Session 3-6-1。
 *
 * 改名と同じ `fs.rename` を使うが、**確かめる相手が2つある**（元の親と移動先の親）のが
 * 移動の中身。ここで固定したいのは次の3つ。
 *
 *   - どちらの側からも Workspace の外へ出られないこと
 *   - 行き先にあるものを黙って上書きしないこと
 *   - 自分自身の中へ動かそうとした要求を、理由の分かる形で断ること
 */
describe('moveWorkspaceEntry', () => {
  it('ファイルを別のフォルダへ動かす（名前は変わらない）', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'main.ts'), 'x')

    const outcome = await moveWorkspaceEntry(root, 'main.ts', 'src')

    expect(outcome).toMatchObject({
      status: 'ok',
      fromRelativePath: 'main.ts',
      entry: { name: 'main.ts', relativePath: 'src/main.ts', type: 'file' }
    })

    expect(await exists(join(root, 'main.ts'))).toBe(false)
    expect(await exists(join(root, 'src', 'main.ts'))).toBe(true)
  })

  it('フォルダは中身ごと動く', async () => {
    await mkdir(join(root, 'src'))
    await mkdir(join(root, 'src', 'lib'))
    await writeFile(join(root, 'src', 'lib', 'util.ts'), 'x')
    await mkdir(join(root, 'app'))

    const outcome = await moveWorkspaceEntry(root, 'src/lib', 'app')

    expect(outcome).toMatchObject({
      status: 'ok',
      fromRelativePath: 'src/lib',
      entry: { relativePath: 'app/lib', type: 'directory' }
    })

    expect(await exists(join(root, 'src', 'lib'))).toBe(false)
    expect(await exists(join(root, 'app', 'lib', 'util.ts'))).toBe(true)
  })

  it('Workspace root へ動かせる（行き先は空文字）', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'main.ts'), 'x')

    expect(await moveWorkspaceEntry(root, 'src/main.ts', '')).toMatchObject({
      status: 'ok',
      entry: { relativePath: 'main.ts' }
    })

    expect(await exists(join(root, 'main.ts'))).toBe(true)
  })

  /*
    既にそこに居る場合。**already-exists にしない** ── 行き先で見つかるのは
    自分自身であって、同名の別のものではない。動かないという結果は同じでも、
    理由が嘘になると利用者は別の名前を探し始める。
  */
  it('同じフォルダへの移動は何もせずに成功する', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'main.ts'), 'keep me')

    expect(await moveWorkspaceEntry(root, 'src/main.ts', 'src')).toMatchObject({
      status: 'ok',
      fromRelativePath: 'src/main.ts',
      entry: { relativePath: 'src/main.ts' }
    })

    // 触っていないこと（消えて作り直されていない）。
    expect(await readFile(join(root, 'src', 'main.ts'), 'utf8')).toBe('keep me')
  })

  /*
    パスの形も名前も正しいが、成立しない要求。fs に任せると OS の EINVAL になり、
    「引数が変」以上のことを利用者に伝えられない。
  */
  it.each([
    ['自分自身', 'src'],
    ['自分の中', 'src/lib'],
    ['自分の深い中', 'src/lib/deep']
  ])('フォルダを %s へは動かせない', async (_label, destination) => {
    await mkdir(join(root, 'src'))
    await mkdir(join(root, 'src', 'lib'))
    await mkdir(join(root, 'src', 'lib', 'deep'))

    expect(await moveWorkspaceEntry(root, 'src', destination)).toEqual({
      status: 'invalid-destination'
    })

    expect(await exists(join(root, 'src', 'lib', 'deep'))).toBe(true)
  })

  it('行き先に既にあるものを上書きしない', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'main.ts'), 'moving')
    await writeFile(join(root, 'src', 'main.ts'), 'existing')

    expect(await moveWorkspaceEntry(root, 'main.ts', 'src')).toEqual({ status: 'already-exists' })

    expect(await readFile(join(root, 'src', 'main.ts'), 'utf8')).toBe('existing')
    expect(await readFile(join(root, 'main.ts'), 'utf8')).toBe('moving')
  })

  it('無いものは動かせない', async () => {
    await mkdir(join(root, 'src'))

    expect(await moveWorkspaceEntry(root, 'missing.ts', 'src')).toEqual({ status: 'not-found' })
  })

  it('無いフォルダへは動かせない', async () => {
    await writeFile(join(root, 'main.ts'), 'x')

    expect(await moveWorkspaceEntry(root, 'main.ts', 'missing')).toEqual({ status: 'not-found' })

    expect(await exists(join(root, 'main.ts'))).toBe(true)
  })

  it('ファイルの中へは動かせない', async () => {
    await writeFile(join(root, 'main.ts'), 'x')
    await writeFile(join(root, 'notes.txt'), 'y')

    expect(await moveWorkspaceEntry(root, 'main.ts', 'notes.txt')).toEqual({
      status: 'invalid-path'
    })

    expect(await exists(join(root, 'main.ts'))).toBe(true)
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('y')
  })

  /*
    元の側には作成向けの名前の規則を当てない（削除・改名と同じ）。当てると、
    他の OS で作られた `aux.ts` が「並んでいるのに動かせない」ものとして残る。
    名前は動かす前のものをそのまま使うので、行き先でも検査し直さない。
  */
  it('新規作成では受け付けない名前でも動かせる', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'aux.ts'), 'x')

    expect(await moveWorkspaceEntry(root, 'aux.ts', 'src')).toMatchObject({
      status: 'ok',
      entry: { name: 'aux.ts', relativePath: 'src/aux.ts' }
    })

    expect(await exists(join(root, 'src', 'aux.ts'))).toBe(true)
  })

  /*
    末尾に空白を持つ名前も字義どおり動く（fs 側を通るため。削除だけがシェル API の
    正規化に当たる ── mutateWorkspaceEntry.ts の isUnreachableByShell）。
    隣の `notes.txt` を巻き込んでいないことまで確かめる。
  */
  it('末尾に空白を持つ名前を、隣のものと取り違えずに動かす', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'notes.txt'), 'the neighbour')
    await writeFile(join(root, 'notes.txt '), 'the real target')

    expect(await moveWorkspaceEntry(root, 'notes.txt ', 'src')).toMatchObject({
      status: 'ok',
      entry: { relativePath: 'src/notes.txt ' }
    })

    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('the neighbour')
    expect(await readFile(join(root, 'src', 'notes.txt '), 'utf8')).toBe('the real target')
  })

  /* ------------------------------------------------ 境界（2つの相対位置） */

  it.each(['', '..', '../outside/secret.txt', 'a:b', 'C:\\Windows\\system.ini'])(
    '動かす側が Workspace の外なら断る: %s',
    async (relativePath) => {
      await mkdir(join(root, 'src'))

      expect(await moveWorkspaceEntry(root, relativePath, 'src')).toMatchObject({
        status: 'invalid-path'
      })

      expect(await exists(join(outside, 'secret.txt'))).toBe(true)
    }
  )

  it.each(['..', '../outside', 'docs/../../outside', 'a:b', 'C:\\Windows'])(
    '行き先が Workspace の外なら断る: %s',
    async (destination) => {
      await writeFile(join(root, 'main.ts'), 'x')

      expect(await moveWorkspaceEntry(root, 'main.ts', destination)).toMatchObject({
        status: 'invalid-path'
      })

      // 出ていないこと。
      expect(await exists(join(root, 'main.ts'))).toBe(true)
      expect(await exists(join(outside, 'main.ts'))).toBe(false)
    }
  )
})

/* -------------------------------------------------------------------------- */
/* コピー                                                                      */
/* -------------------------------------------------------------------------- */

describe('copyWorkspaceEntry', () => {
  it('ファイルを別のフォルダへ複製する（元は残る）', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'main.ts'), 'hello')

    expect(await copyWorkspaceEntry(root, 'main.ts', 'src')).toMatchObject({
      status: 'ok',
      skippedCount: 0,
      entry: { name: 'main.ts', relativePath: 'src/main.ts', type: 'file' }
    })

    expect(await readFile(join(root, 'src', 'main.ts'), 'utf8')).toBe('hello')
    // 移動との一番の違い。元は動かない。
    expect(await readFile(join(root, 'main.ts'), 'utf8')).toBe('hello')
  })

  it('フォルダは中身ごと複製される', async () => {
    await mkdir(join(root, 'src', 'lib'), { recursive: true })
    await writeFile(join(root, 'src', 'lib', 'util.ts'), 'util')
    await mkdir(join(root, 'src', 'empty'))
    await mkdir(join(root, 'app'))

    expect(await copyWorkspaceEntry(root, 'src', 'app')).toMatchObject({
      status: 'ok',
      entry: { relativePath: 'app/src', type: 'directory' }
    })

    expect(await readFile(join(root, 'app', 'src', 'lib', 'util.ts'), 'utf8')).toBe('util')
    expect(await exists(join(root, 'app', 'src', 'empty'))).toBe(true)
    expect(await exists(join(root, 'src', 'lib', 'util.ts'))).toBe(true)
  })

  it('深い階層もそのまま複製される', async () => {
    await mkdir(join(root, 'a', 'b', 'c', 'd', 'e'), { recursive: true })
    await writeFile(join(root, 'a', 'b', 'c', 'd', 'e', 'deep.txt'), 'deep')
    await mkdir(join(root, 'dest'))

    expect(await copyWorkspaceEntry(root, 'a', 'dest')).toMatchObject({ status: 'ok' })

    expect(await readFile(join(root, 'dest', 'a', 'b', 'c', 'd', 'e', 'deep.txt'), 'utf8')).toBe(
      'deep'
    )
  })

  it('Workspace root へ複製できる（行き先は空文字）', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'main.ts'), 'x')

    expect(await copyWorkspaceEntry(root, 'src/main.ts', '')).toMatchObject({
      status: 'ok',
      entry: { relativePath: 'main.ts' }
    })

    expect(await exists(join(root, 'main.ts'))).toBe(true)
  })

  /* ------------------------------------------------------ 同名の衝突 */

  /*
    移動では「何もせず成功」になる指定が、コピーでは複製そのものになる
    ── 同じフォルダへ貼り付けると `example copy.txt` が1つ増える。
  */
  it('同じフォルダへの複製は copy 名で作られる', async () => {
    await writeFile(join(root, 'example.txt'), 'original')

    expect(await copyWorkspaceEntry(root, 'example.txt', '')).toMatchObject({
      status: 'ok',
      entry: { name: 'example copy.txt', relativePath: 'example copy.txt' }
    })

    expect(await readFile(join(root, 'example copy.txt'), 'utf8')).toBe('original')
    expect(await readFile(join(root, 'example.txt'), 'utf8')).toBe('original')
  })

  it('繰り返すと連番が付く', async () => {
    await writeFile(join(root, 'example.txt'), 'original')

    await copyWorkspaceEntry(root, 'example.txt', '')
    await copyWorkspaceEntry(root, 'example.txt', '')

    expect(await copyWorkspaceEntry(root, 'example.txt', '')).toMatchObject({
      entry: { name: 'example copy 3.txt' }
    })

    expect(await exists(join(root, 'example copy.txt'))).toBe(true)
    expect(await exists(join(root, 'example copy 2.txt'))).toBe(true)
    expect(await exists(join(root, 'example copy 3.txt'))).toBe(true)
  })

  it('フォルダも同じ規則で連番が付く', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'main.ts'), 'x')

    expect(await copyWorkspaceEntry(root, 'src', '')).toMatchObject({
      status: 'ok',
      entry: { name: 'src copy', type: 'directory' }
    })

    expect(await copyWorkspaceEntry(root, 'src', '')).toMatchObject({
      entry: { name: 'src copy 2' }
    })

    expect(await readFile(join(root, 'src copy', 'main.ts'), 'utf8')).toBe('x')
  })

  /*
    コピー先に同名のものがあっても**上書きしない。** 断りもしない
    （複製は名前そのものに意味が無い操作なので、名前を訊き直さずに済ませられる）。
  */
  it('コピー先の同名を上書きせず、名前を変えて作る', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'main.ts'), 'copying')
    await writeFile(join(root, 'src', 'main.ts'), 'existing')

    expect(await copyWorkspaceEntry(root, 'main.ts', 'src')).toMatchObject({
      status: 'ok',
      entry: { relativePath: 'src/main copy.ts' }
    })

    expect(await readFile(join(root, 'src', 'main.ts'), 'utf8')).toBe('existing')
    expect(await readFile(join(root, 'src', 'main copy.ts'), 'utf8')).toBe('copying')
  })

  it('同名がフォルダでも上書きしない', async () => {
    await mkdir(join(root, 'dest'))
    await mkdir(join(root, 'dest', 'src'))
    await writeFile(join(root, 'dest', 'src', 'keep.txt'), 'keep')
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'new.txt'), 'new')

    expect(await copyWorkspaceEntry(root, 'src', 'dest')).toMatchObject({
      status: 'ok',
      entry: { relativePath: 'dest/src copy' }
    })

    expect(await readFile(join(root, 'dest', 'src', 'keep.txt'), 'utf8')).toBe('keep')
    expect(await readFile(join(root, 'dest', 'src copy', 'new.txt'), 'utf8')).toBe('new')
  })

  /* ---------------------------------------------------------- 異常系 */

  /*
    コピーを控えてから貼り付けるまでの間に元が消えた場合。Renderer 側では
    先に確かめない（確かめてから貼り付けるまでの隙間が残るため）ので、
    ここが最初に気づく場所になる。
  */
  it('無いものは複製できない', async () => {
    await mkdir(join(root, 'src'))

    expect(await copyWorkspaceEntry(root, 'missing.ts', 'src')).toEqual({ status: 'not-found' })
  })

  it('無いフォルダへは複製できない', async () => {
    await writeFile(join(root, 'main.ts'), 'x')

    expect(await copyWorkspaceEntry(root, 'main.ts', 'missing')).toEqual({ status: 'not-found' })
  })

  it('ファイルの中へは複製できない', async () => {
    await writeFile(join(root, 'main.ts'), 'x')
    await writeFile(join(root, 'notes.txt'), 'y')

    expect(await copyWorkspaceEntry(root, 'main.ts', 'notes.txt')).toEqual({
      status: 'invalid-path'
    })

    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('y')
  })

  /*
    移動では「動かせない」だけだが、コピーでは**複製の中を複製し続ける**ことになる。
    fs に任せる形にすると、止まるまでディスクを埋める。
  */
  it.each([
    ['自分自身', 'src'],
    ['自分の中', 'src/lib'],
    ['自分の深い中', 'src/lib/deep']
  ])('フォルダを %s へは複製できない', async (_label, destination) => {
    await mkdir(join(root, 'src', 'lib', 'deep'), { recursive: true })

    expect(await copyWorkspaceEntry(root, 'src', destination)).toEqual({
      status: 'invalid-destination'
    })

    // 何も作られていない（複製が始まっていない）。
    expect(await readdir(join(root, 'src'))).toEqual(['lib'])
  })

  /*
    元の側には作成向けの名前の規則を当てない（削除・改名・移動と同じ）。
    当てると、他の OS で作られた `aux.ts` が「並んでいるのに複製できない」ものになる。
    できる名前の方は copy が付くため、予約デバイス名にはならない。
  */
  it('新規作成では受け付けない名前でも複製できる', async () => {
    await writeFile(join(root, 'aux.ts'), 'x')

    expect(await copyWorkspaceEntry(root, 'aux.ts', '')).toMatchObject({
      status: 'ok',
      entry: { name: 'aux copy.ts' }
    })

    expect(await exists(join(root, 'aux copy.ts'))).toBe(true)
  })

  it('末尾に空白を持つ名前を、隣のものと取り違えずに複製する', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'notes.txt'), 'the neighbour')
    await writeFile(join(root, 'notes.txt '), 'the real target')

    expect(await copyWorkspaceEntry(root, 'notes.txt ', 'src')).toMatchObject({
      status: 'ok',
      entry: { relativePath: 'src/notes.txt ' }
    })

    expect(await readFile(join(root, 'src', 'notes.txt '), 'utf8')).toBe('the real target')
    expect(await exists(join(root, 'src', 'notes.txt'))).toBe(false)
  })

  /* ------------------------------------------------ 境界（2つの相対位置） */

  it.each(['', '..', '../outside/secret.txt', 'a:b', 'C:\\Windows\\system.ini'])(
    '複製する側が Workspace の外なら断る: %s',
    async (relativePath) => {
      await mkdir(join(root, 'src'))

      expect(await copyWorkspaceEntry(root, relativePath, 'src')).toMatchObject({
        status: 'invalid-path'
      })

      expect(await readdir(join(root, 'src'))).toEqual([])
    }
  )

  it.each(['..', '../outside', 'docs/../../outside', 'a:b', 'C:\\Windows'])(
    'コピー先が Workspace の外なら断る: %s',
    async (destination) => {
      await writeFile(join(root, 'main.ts'), 'x')

      expect(await copyWorkspaceEntry(root, 'main.ts', destination)).toMatchObject({
        status: 'invalid-path'
      })

      expect(await exists(join(outside, 'main.ts'))).toBe(false)
    }
  )
})

/* -------------------------------------------------------------------------- */
/* 削除                                                                        */
/* -------------------------------------------------------------------------- */

describe('deleteWorkspaceEntry', () => {
  it('ファイルとフォルダをごみ箱へ送る', async () => {
    await writeFile(join(root, 'index.ts'), 'x')
    await mkdir(join(root, 'src'))

    expect(await deleteWorkspaceEntry(root, 'index.ts')).toEqual({
      status: 'ok',
      relativePath: 'index.ts',
      entryType: 'file'
    })

    expect(await deleteWorkspaceEntry(root, 'src')).toEqual({
      status: 'ok',
      relativePath: 'src',
      entryType: 'directory'
    })

    expect(trashed).toEqual([join(root, 'index.ts'), join(root, 'src')])
    expect(await readdir(root)).toEqual([])
  })

  /*
    Session 3-5 で見つかった不具合そのもの。

    `aux.ts` は「これから作る名前」としては受け付けないが、他の OS で作られたものは
    実際に置かれている（Node は内部で拡張表記を使うため、Windows でも普通に読み書きできる）。
    そこへ作成向けの規則を当てていたため、**ツリーに並んでいるのに消せないファイル**が
    生まれていた。
  */
  it.each(['aux.ts', 'CON', 'nul.log', 'com1.txt', 'aux', 'lpt9.md'])(
    '新規作成では受け付けない名前でも、既にあるものは削除できる: %s',
    async (name) => {
      await writeFile(join(root, name), 'x')
      expect(await exists(join(root, name))).toBe(true)

      expect(await deleteWorkspaceEntry(root, name)).toEqual({
        status: 'ok',
        relativePath: name,
        entryType: 'file'
      })

      expect(await exists(join(root, name))).toBe(false)
    }
  )

  it('フォルダの中の、新規作成では受け付けない名前も削除できる', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'aux.ts'), 'x')

    expect(await deleteWorkspaceEntry(root, 'src/aux.ts')).toEqual({
      status: 'ok',
      relativePath: 'src/aux.ts',
      entryType: 'file'
    })

    expect(await readdir(join(root, 'src'))).toEqual([])
  })

  /*
    末尾に空白 / ドットを持つ名前は、シェルの削除 API に宛先を伝えられない
    （Windows が末尾を落とすため、隣の `notes.txt` の方がごみ箱へ入る）。
    **消せないことより、違うものが消える方が悪い**ので、渡さずに断る。

    相対位置を trim していた頃は、同じ取り違えが1つ手前（パスの正規化）で起きていた。
    どちらの層でも「指したものだけが消える」を守る。
  */
  it.each(['notes.txt ', 'notes.'])(
    'シェルに宛先を伝えられない名前は、渡さずに断る: %s',
    async (name) => {
      await writeFile(join(root, 'notes.txt'), 'keep me')
      await writeFile(join(root, 'notes'), 'keep me too')
      await writeFile(join(root, name), 'the real target')

      const outcome = await deleteWorkspaceEntry(root, name)

      if (isWindows) {
        expect(outcome.status).toBe('failed')
        // 何も渡していない ＝ 何も消えていない。
        expect(trashed).toEqual([])
        expect(await exists(join(root, name))).toBe(true)
      } else {
        expect(outcome).toMatchObject({ status: 'ok', relativePath: name })
      }

      // どちらの OS でも、隣のファイルは巻き込まれない。
      expect(await exists(join(root, 'notes.txt'))).toBe(true)
      expect(await exists(join(root, 'notes'))).toBe(true)
    }
  )

  /*
    断られたままにはならない ── 改名は fs 側（node）を通るので字義どおり動く。
    名前を直してから消せる、が逃げ道になっている。
  */
  it('改名してからなら削除できる', async () => {
    await writeFile(join(root, 'notes.txt'), 'keep me')
    await writeFile(join(root, 'stuck.txt '), 'the real target')

    expect(await renameWorkspaceEntry(root, 'stuck.txt ', 'stuck.txt')).toMatchObject({
      status: 'ok',
      entry: { name: 'stuck.txt' }
    })

    // 改名が隣を巻き込んでいないこと。
    expect(await exists(join(root, 'notes.txt'))).toBe(true)

    expect(await deleteWorkspaceEntry(root, 'stuck.txt')).toMatchObject({ status: 'ok' })
    expect(await exists(join(root, 'stuck.txt'))).toBe(false)
    expect(await exists(join(root, 'notes.txt'))).toBe(true)
  })

  it('無いものは削除できない', async () => {
    expect(await deleteWorkspaceEntry(root, 'missing.ts')).toEqual({ status: 'not-found' })
    expect(trashed).toEqual([])
  })

  /* ------------------------------------------ ごみ箱へ送れなかったとき */

  /*
    Session 3-5.2。

    `shell.trashItem` の Error には code も errno も無く、message も原因と
    1対1にならない（deleteObstacle.ts の観測表）。以前はここを一律
    permission-denied にしていたため、**使用中で消せないのか、権限が無いのか、
    もう無いのか**が Renderer から見て区別できなかった。
    分類は例外ではなく、失敗した後のファイルシステムに訊いて決める。
  */

  it('ごみ箱へ送るのと消えるのが行き違ったら not-found', async () => {
    await writeFile(join(root, 'raced.txt'), 'x')
    trashBehavior.mode = 'vanish-then-fail'

    expect(await deleteWorkspaceEntry(root, 'raced.txt')).toEqual({ status: 'not-found' })
  })

  it('理由が分からなければ failed（権限のせいにしない）', async () => {
    await writeFile(join(root, 'stubborn.txt'), 'x')
    trashBehavior.mode = 'fail'
    trashBehavior.message = 'Failed to parse path'

    const outcome = await deleteWorkspaceEntry(root, 'stubborn.txt')

    expect(outcome.status).toBe('failed')
    // 分類には使わないが、診断のために元の文言は残す。
    expect(outcome).toMatchObject({ detail: expect.stringContaining('Failed to parse path') })
    expect(await exists(join(root, 'stubborn.txt'))).toBe(true)
  })

  /*
    実物の errno を通す唯一の経路。chmod は Windows でも読み取り専用属性として効き、
    `open(path, 'r+')` が EPERM（POSIX では EACCES）で失敗する。
    ここが通ることで、判定の入口が本物の fs につながっていることが確かめられる。
  */
  it('書き込めないファイルなら permission-denied', async ({ skip }) => {
    const path = join(root, 'locked.txt')

    await writeFile(path, 'x')
    await chmod(path, 0o444)

    if (await canOpenForWrite(path)) {
      // 管理者 / root で走っている場合は権限が効かない。
      await chmod(path, 0o666)
      skip('この環境では読み取り専用属性が効かない')
      return
    }

    trashBehavior.mode = 'fail'

    try {
      expect(await deleteWorkspaceEntry(root, 'locked.txt')).toEqual({
        status: 'permission-denied'
      })
    } finally {
      await chmod(path, 0o666)
    }
  })

  it('フォルダを止めているのが中のファイルでも見つける', async ({ skip }) => {
    const inner = join(root, 'dist', 'app.dll')

    await mkdir(join(root, 'dist'))
    await writeFile(inner, 'x')
    await chmod(inner, 0o444)

    if (await canOpenForWrite(inner)) {
      await chmod(inner, 0o666)
      skip('この環境では読み取り専用属性が効かない')
      return
    }

    trashBehavior.mode = 'fail'

    try {
      expect(await deleteWorkspaceEntry(root, 'dist')).toEqual({ status: 'permission-denied' })
    } finally {
      await chmod(inner, 0o666)
    }
  })

  /* ここから下は、名前の規則を分けても緩んでいないこと。 */

  it('Workspace root 自身は削除できない', async () => {
    expect(await deleteWorkspaceEntry(root, '')).toEqual({ status: 'invalid-path' })
    expect(await deleteWorkspaceEntry(root, '   ')).toEqual({ status: 'invalid-path' })
    expect(await exists(root)).toBe(true)
  })

  it.each([
    '..',
    '../outside/secret.txt',
    '..\\outside\\secret.txt',
    'sub/../../outside/secret.txt',
    'a:b',
    'notes.txt:hidden'
  ])('Workspace の外・危険な指定は削除できない: %s', async (relativePath) => {
    expect(await deleteWorkspaceEntry(root, relativePath)).toEqual({ status: 'invalid-path' })

    expect(trashed).toEqual([])
    expect(await exists(join(outside, 'secret.txt'))).toBe(true)
  })

  it('絶対パスは削除できない', async () => {
    const outcome = await deleteWorkspaceEntry(root, join(outside, 'secret.txt'))

    expect(outcome.status).toBe('invalid-path')
    expect(await exists(join(outside, 'secret.txt'))).toBe(true)
  })

  it.each([undefined, null, 42, { relativePath: 'index.ts' }])(
    '文字列でない指定は削除できない: %s',
    async (relativePath) => {
      expect(await deleteWorkspaceEntry(root, relativePath)).toEqual({ status: 'invalid-path' })
      expect(trashed).toEqual([])
    }
  )

  it('NUL を含む指定は削除できない', async () => {
    expect(await deleteWorkspaceEntry(root, 'notes\0.txt')).toEqual({ status: 'invalid-path' })
  })
})

/* -------------------------------------------------------------------------- */
/* symlink / ジャンクション                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Workspace の中から外を指すリンク。
 *
 * Windows のジャンクションは管理者権限なしで作れる。作れない環境（権限・ファイルシステム）
 * ではこの塊ごと飛ばす ── 作れないことを失敗として報告しても直しようがないため。
 */
describe('Workspace の外を指すリンク', () => {
  let linked: boolean

  beforeEach(async () => {
    try {
      await symlink(outside, join(root, 'link'), isWindows ? 'junction' : 'dir')
      linked = true
    } catch {
      linked = false
    }
  })

  it('リンクの中には作らせない', async ({ skip }) => {
    if (!linked) {
      skip()
    }

    expect(await createWorkspaceEntry(root, 'link', 'planted.txt', 'file')).toEqual({
      status: 'outside-workspace'
    })

    expect(await exists(join(outside, 'planted.txt'))).toBe(false)
  })

  it('リンクの中のものは消せない', async ({ skip }) => {
    if (!linked) {
      skip()
    }

    expect(await deleteWorkspaceEntry(root, 'link/secret.txt')).toEqual({
      status: 'outside-workspace'
    })

    expect(await exists(join(outside, 'secret.txt'))).toBe(true)
  })

  /*
    リンクそのものは消せる ── 消えるのは Workspace の中にある入口であって、
    指し先ではない。ここが通らないと、ツリーに並んでいるのに片付けられないものが残る。
  */
  it('リンクそのものは消せる（指し先は残る）', async ({ skip }) => {
    if (!linked) {
      skip()
    }

    expect(await deleteWorkspaceEntry(root, 'link')).toMatchObject({
      status: 'ok',
      relativePath: 'link'
    })

    expect(await exists(join(root, 'link'))).toBe(false)
    expect(await exists(join(outside, 'secret.txt'))).toBe(true)
  })

  /*
    移動の行き先としても同じ。相対位置としては Workspace の中を指しているが、
    指し先は外にある ── 文字列の検査だけでは分からないので、realpath を取ってから
    境界に通している（mutateWorkspaceEntry.ts の resolveParent）。
  */
  it('リンクの中へは動かせない', async ({ skip }) => {
    if (!linked) {
      skip()
    }

    await writeFile(join(root, 'main.ts'), 'x')

    expect(await moveWorkspaceEntry(root, 'main.ts', 'link')).toEqual({
      status: 'outside-workspace'
    })

    expect(await exists(join(root, 'main.ts'))).toBe(true)
    expect(await exists(join(outside, 'main.ts'))).toBe(false)
  })

  it('リンクの中のものは動かせない', async ({ skip }) => {
    if (!linked) {
      skip()
    }

    await mkdir(join(root, 'src'))

    expect(await moveWorkspaceEntry(root, 'link/secret.txt', 'src')).toEqual({
      status: 'outside-workspace'
    })

    expect(await exists(join(outside, 'secret.txt'))).toBe(true)
  })

  /* 削除と同じで、動かせるのは Workspace の中にある入口の方。 */
  it('リンクそのものは動かせる（指し先は動かない）', async ({ skip }) => {
    if (!linked) {
      skip()
    }

    await mkdir(join(root, 'src'))

    expect(await moveWorkspaceEntry(root, 'link', 'src')).toMatchObject({
      status: 'ok',
      entry: { relativePath: 'src/link' }
    })

    expect(await exists(join(root, 'link'))).toBe(false)
    // リンクとして動いており、指し先を辿れば中身はそのまま。
    expect(await exists(join(root, 'src', 'link', 'secret.txt'))).toBe(true)
    expect(await exists(join(outside, 'secret.txt'))).toBe(true)
  })

  /* ------------------------------------------------------------ コピー */

  it('リンクの中へは複製できない', async ({ skip }) => {
    if (!linked) {
      skip()
    }

    await writeFile(join(root, 'main.ts'), 'x')

    expect(await copyWorkspaceEntry(root, 'main.ts', 'link')).toEqual({
      status: 'outside-workspace'
    })

    expect(await exists(join(outside, 'main.ts'))).toBe(false)
  })

  it('リンクの中のものは複製できない', async ({ skip }) => {
    if (!linked) {
      skip()
    }

    await mkdir(join(root, 'src'))

    expect(await copyWorkspaceEntry(root, 'link/secret.txt', 'src')).toEqual({
      status: 'outside-workspace'
    })

    expect(await exists(join(root, 'src', 'secret.txt'))).toBe(false)
  })

  /*
    **ここだけは削除 / 改名 / 移動と答えが違う。** あちらはリンクそのものを
    動かすだけなので通るが、コピーは中身を持ってくる操作なので、通すと
    Workspace の外にある実体を中へ持ち込むことになる（shared/files/copy.ts）。
  */
  it('リンクそのものは複製できない（指し先の中身を持ち込まない）', async ({ skip }) => {
    if (!linked) {
      skip()
    }

    await mkdir(join(root, 'src'))

    expect(await copyWorkspaceEntry(root, 'link', 'src')).toEqual({ status: 'link-source' })

    expect(await exists(join(root, 'src', 'link'))).toBe(false)
    // リンクそのものは無事（断っただけで、何も触っていない）。
    expect(await exists(join(root, 'link'))).toBe(true)
  })

  /*
    フォルダの中にあるリンクは、そこだけとばして残りを複製する。
    リンク1つで全体を断ると、node_modules のようなフォルダが複製できなくなる。
  */
  it('フォルダの中のリンクはとばして数える', async ({ skip }) => {
    if (!linked) {
      skip()
    }

    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'main.ts'), 'kept')
    await mkdir(join(root, 'dest'))

    // src の中にも外を指すリンクを1つ置く。
    try {
      await symlink(outside, join(root, 'src', 'inner'), isWindows ? 'junction' : 'dir')
    } catch {
      skip()
    }

    expect(await copyWorkspaceEntry(root, 'src', 'dest')).toMatchObject({
      status: 'ok',
      skippedCount: 1,
      entry: { relativePath: 'dest/src' }
    })

    expect(await readFile(join(root, 'dest', 'src', 'main.ts'), 'utf8')).toBe('kept')
    expect(await exists(join(root, 'dest', 'src', 'inner'))).toBe(false)
    expect(await exists(join(root, 'dest', 'src', 'secret.txt'))).toBe(false)
    expect(await exists(join(outside, 'secret.txt'))).toBe(true)
  })
})
