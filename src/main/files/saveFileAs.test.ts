import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FILES_FILE_MAX_BYTES } from '@shared/files'
import { isWindows } from '../platform'
import {
  describeSaveAsLocation,
  prepareSaveAsBytes,
  resolveSaveAsDialogPath,
  writeFileAtPath
} from './saveFileAs'

/**
 * 別名で保存（Save As）の Main 側の検証（Session 4-2）。
 *
 * `mutateWorkspaceEntry.test.ts` と同じく、**実際のディスクを触る側の例外**にあたる。
 * 確かめたいのはパスの文字列処理ではなく、
 *
 *   - 選ばれた場所に**本当に書けたか**（新規・上書きの両方）
 *   - その場所が Workspace の**中か外か**を、symlink を跨いでも取り違えないか
 *   - 書けた中身が上書き保存とバイト単位で同じか（BOM・改行）
 *
 * であり、どれも写しのファイルシステムでは確かめられない。
 *
 * ダイアログ（Electron）はここに出てこない。出す側は `ipc/handlers/files.ts` で、
 * この層は「選ばれた後」しか知らない ── その分担そのものが、ここを
 * テストできる形にしている（saveFileAs.ts の冒頭）。
 *
 * 使うのは毎回作り直す一時フォルダで、**開発リポジトリには一切触れない。**
 */

let workspace: string
/** Workspace の外側（同じ一時フォルダの兄弟）。 */
let outside: string
let sandbox: string

beforeEach(async () => {
  // realpath を通しておく。macOS / Windows の /tmp は symlink であることがある。
  sandbox = await realpath(await mkdtemp(join(tmpdir(), 'fx-save-as-')))
  workspace = join(sandbox, 'workspace')
  outside = join(sandbox, 'outside')

  await mkdir(workspace, { recursive: true })
  await mkdir(outside, { recursive: true })
})

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true })
})

/** 実際に書き出して、その結果と場所の判定までを1回で行う（ハンドラと同じ順序）。 */
async function saveAs(
  absolutePath: string,
  content: unknown,
  encoding: unknown = 'utf8'
): Promise<{
  readonly write: Awaited<ReturnType<typeof writeFileAtPath>>
  readonly relativePath: string | null
}> {
  const prepared = prepareSaveAsBytes(content, encoding)

  if (prepared.status !== 'ok') {
    throw new Error('the content was refused before the dialog.')
  }

  const write = await writeFileAtPath(absolutePath, prepared.bytes)

  if (write.status !== 'ok') {
    return { write, relativePath: null }
  }

  const location = await describeSaveAsLocation(workspace, write.realPath)

  return { write, relativePath: location.relativePath }
}

describe('prepareSaveAsBytes', () => {
  it('文字列でない中身を、ダイアログを出す前に断る', () => {
    expect(prepareSaveAsBytes(null, 'utf8').status).toBe('invalid-content')
    expect(prepareSaveAsBytes(42, 'utf8').status).toBe('invalid-content')
    expect(prepareSaveAsBytes({ content: 'x' }, 'utf8').status).toBe('invalid-content')
    expect(prepareSaveAsBytes(undefined, 'utf8').status).toBe('invalid-content')
  })

  it('上限を超える中身を断る（数えるのは実際に書くバイト列）', () => {
    const justUnder = 'a'.repeat(FILES_FILE_MAX_BYTES)
    const justOver = 'a'.repeat(FILES_FILE_MAX_BYTES + 1)

    expect(prepareSaveAsBytes(justUnder, 'utf8').status).toBe('ok')
    expect(prepareSaveAsBytes(justOver, 'utf8').status).toBe('invalid-content')
  })

  it('BOM のぶんで上限を超える場合も断る（文字列の長さでは数えない）', () => {
    const exact = 'a'.repeat(FILES_FILE_MAX_BYTES)

    // BOM 無しなら通るが、BOM を足すと 3 バイト超える。
    expect(prepareSaveAsBytes(exact, 'utf8').status).toBe('ok')
    expect(prepareSaveAsBytes(exact, 'utf8-bom').status).toBe('invalid-content')
  })

  it('分からない文字コードは utf8（BOM 無し）へ倒す', () => {
    const outcome = prepareSaveAsBytes('abc', 'shift_jis')

    expect(outcome.status).toBe('ok')

    if (outcome.status === 'ok') {
      expect(outcome.encoding).toBe('utf8')
      expect([...outcome.bytes]).toEqual([0x61, 0x62, 0x63])
    }
  })
})

describe('resolveSaveAsDialogPath', () => {
  it('Workspace 相対の助言を、その場所の絶対パスにする', () => {
    expect(resolveSaveAsDialogPath(workspace, 'sub/notes.txt')).toBe(
      join(workspace, 'sub', 'notes.txt')
    )
  })

  it('Workspace の外を指す助言を断る', () => {
    expect(resolveSaveAsDialogPath(workspace, '../outside/notes.txt')).toBeNull()
    expect(resolveSaveAsDialogPath(workspace, '..')).toBeNull()
    expect(resolveSaveAsDialogPath(workspace, 'a/../../b.txt')).toBeNull()
  })

  it('絶対パスの助言を断る（ここから場所は指せない）', () => {
    expect(resolveSaveAsDialogPath(workspace, join(outside, 'notes.txt'))).toBeNull()
    expect(resolveSaveAsDialogPath(workspace, '/etc/passwd')).toBeNull()
    expect(resolveSaveAsDialogPath(workspace, 'C:\\Windows\\System32\\x.txt')).toBeNull()
  })

  it('root 自身・空・文字列でないものを断る', () => {
    expect(resolveSaveAsDialogPath(workspace, '')).toBeNull()
    expect(resolveSaveAsDialogPath(workspace, '.')).toBeNull()
    expect(resolveSaveAsDialogPath(workspace, null)).toBeNull()
    expect(resolveSaveAsDialogPath(workspace, 123)).toBeNull()
  })
})

describe('writeFileAtPath / describeSaveAsLocation', () => {
  it('Workspace の中へ新しいファイルを作り、相対位置を返す', async () => {
    const target = join(workspace, 'rescued.txt')

    const { write, relativePath } = await saveAs(target, 'hello')

    expect(write.status).toBe('ok')
    expect(relativePath).toBe('rescued.txt')

    if (write.status === 'ok') {
      expect(write.created).toBe(true)
      expect(write.name).toBe('rescued.txt')
      expect(write.byteLength).toBe(5)
      expect(write.revision.size).toBe(5)
    }

    expect(await readFile(target, 'utf8')).toBe('hello')
  })

  it('入れ子のフォルダの中でも相対位置を `/` 区切りで返す', async () => {
    await mkdir(join(workspace, 'a', 'b'), { recursive: true })

    const { relativePath } = await saveAs(join(workspace, 'a', 'b', 'c.txt'), 'x')

    expect(relativePath).toBe('a/b/c.txt')
  })

  it('既にあるファイルを上書きし、created が false になる', async () => {
    const target = join(workspace, 'notes.txt')
    await writeFile(target, 'before', 'utf8')

    const { write, relativePath } = await saveAs(target, 'after')

    expect(write.status).toBe('ok')
    expect(relativePath).toBe('notes.txt')

    if (write.status === 'ok') {
      expect(write.created).toBe(false)
    }

    expect(await readFile(target, 'utf8')).toBe('after')
  })

  it('Workspace の外へ書けるが、相対位置は null になる', async () => {
    const target = join(outside, 'rescued.txt')

    const { write, relativePath } = await saveAs(target, 'saved outside')

    expect(write.status).toBe('ok')
    // 書けている（救済は成立する）。
    expect(await readFile(target, 'utf8')).toBe('saved outside')
    // それでも Editor が開ける範囲の外なので、位置は渡らない。
    expect(relativePath).toBeNull()

    if (write.status === 'ok') {
      // 名前だけは渡す（利用者へ「どこへ書いたか」を伝えるため）。
      expect(write.name).toBe('rescued.txt')
    }
  })

  it('親フォルダが無ければ not-found を返す（何も書かない）', async () => {
    const target = join(workspace, 'missing', 'notes.txt')

    const { write } = await saveAs(target, 'x')

    expect(write.status).toBe('not-found')
  })

  it('フォルダを選ばれたら not-a-file を返す（中身を流し込まない）', async () => {
    const target = join(workspace, 'folder')
    await mkdir(target)

    const { write } = await saveAs(target, 'x')

    expect(write.status).toBe('not-a-file')
    // フォルダはそのまま残っている。
    expect(await realpath(target)).toBe(target)
  })

  /* ------------------------------------------------------- 中身の一致 */

  it('BOM 付きで開いたものは BOM 付きで書く', async () => {
    const target = join(workspace, 'bom.txt')

    await saveAs(target, 'abc', 'utf8-bom')

    expect([...(await readFile(target))]).toEqual([0xef, 0xbb, 0xbf, 0x61, 0x62, 0x63])
  })

  it('BOM 無しで開いたものに BOM を足さない', async () => {
    const target = join(workspace, 'plain.txt')

    await saveAs(target, 'abc', 'utf8')

    expect([...(await readFile(target))]).toEqual([0x61, 0x62, 0x63])
  })

  it('CRLF をそのまま書く（Main 側で改行を変換しない）', async () => {
    const target = join(workspace, 'crlf.txt')

    await saveAs(target, 'a\r\nb\r\n')

    expect(await readFile(target, 'utf8')).toBe('a\r\nb\r\n')
  })

  it('LF をそのまま書く（CRLF へ揃えない）', async () => {
    const target = join(workspace, 'lf.txt')

    await saveAs(target, 'a\nb\n')

    expect(await readFile(target, 'utf8')).toBe('a\nb\n')
  })

  it('上限ちょうどの中身は書ける', async () => {
    const target = join(workspace, 'max.txt')

    const { write } = await saveAs(target, 'a'.repeat(FILES_FILE_MAX_BYTES))

    expect(write.status).toBe('ok')

    if (write.status === 'ok') {
      expect(write.byteLength).toBe(FILES_FILE_MAX_BYTES)
    }
  })

  /* ------------------------------------------------- 場所の判定（実体） */

  it('Workspace root 自身が symlink 越しでも、中を外と判定しない', async () => {
    const link = join(sandbox, 'linked-workspace')

    try {
      await symlink(workspace, link, 'dir')
    } catch {
      // Windows で権限が無い場合はこの観点を確かめられない。
      return
    }

    const target = join(link, 'inside.txt')

    const prepared = prepareSaveAsBytes('x', 'utf8')

    if (prepared.status !== 'ok') {
      throw new Error('unexpected')
    }

    const write = await writeFileAtPath(target, prepared.bytes)

    expect(write.status).toBe('ok')

    if (write.status !== 'ok') {
      return
    }

    // root として渡すのは symlink 側。実体で比べるので中と判定される。
    const location = await describeSaveAsLocation(link, write.realPath)

    expect(location.relativePath).toBe('inside.txt')
  })

  it('Workspace の中に見える symlink でも、実体が外なら外と判定する', async () => {
    const realTarget = join(outside, 'real.txt')
    await writeFile(realTarget, 'original', 'utf8')

    const link = join(workspace, 'looks-inside.txt')

    try {
      await symlink(realTarget, link, 'file')
    } catch {
      return
    }

    const { write, relativePath } = await saveAs(link, 'written through the link')

    expect(write.status).toBe('ok')
    // 書かれたのは外の実体。
    expect(await readFile(realTarget, 'utf8')).toBe('written through the link')
    // したがって「Workspace の中の位置」としては渡さない。
    expect(relativePath).toBeNull()
  })

  it('Workspace root そのものを選ばれても位置は返さない', async () => {
    const location = await describeSaveAsLocation(workspace, workspace)

    expect(location.relativePath).toBeNull()
  })

  it('Workspace root が読めなくなっていれば外として扱う', async () => {
    const target = join(outside, 'orphan.txt')
    await writeFile(target, 'x', 'utf8')

    const location = await describeSaveAsLocation(join(sandbox, 'gone'), target)

    expect(location.relativePath).toBeNull()
  })

  /* ------------------------------------------------------------ 権限 */

  it('書き込めない場所は permission-denied として返る', async () => {
    if (isWindows) {
      // Windows の読み取り専用属性はフォルダの中の作成を止めない。
      return
    }

    const locked = join(workspace, 'locked')
    await mkdir(locked)
    await chmod(locked, 0o500)

    try {
      const { write } = await saveAs(join(locked, 'x.txt'), 'x')

      expect(write.status).toBe('permission-denied')
    } finally {
      await chmod(locked, 0o700)
    }
  })
})
