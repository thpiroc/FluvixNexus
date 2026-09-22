import {
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile
} from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isWindows } from '../../platform'
import {
  confirmOpenedWorkspaceFile,
  isVerifiedWorkspaceTarget,
  recheckWorkspaceTarget,
  resolveWorkspaceTarget,
  type VerifiedWorkspaceTarget,
  type WorkspaceBoundaryResult
} from './workspaceBoundary'

/**
 * Workspace Boundary の実体側の検査（Security Core v1 の STEP2）。
 *
 * 実際に一時フォルダへ木を作って確かめる。ディレクトリのリンクは Windows では
 * ジャンクション（権限なしで作れる）、それ以外では symlink を使う。ファイルの symlink は
 * Windows では開発者モードか管理者権限が要るため、作れなければ skip する
 * （作れる環境では必ず走る）。
 *
 * ```
 * base/
 *   workspace/            ← root
 *     a.txt
 *     src/nested/deep.ts
 *   workspace-evil/       ← 名前が前方一致する別のフォルダ
 *     secret.txt
 *   outside/              ← Workspace の外
 *     secret.txt
 * ```
 */

let base: string
let root: string
let outside: string
let lookalike: string

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'fx-boundary-')))
  root = join(base, 'workspace')
  outside = join(base, 'outside')
  lookalike = join(base, 'workspace-evil')

  await mkdir(join(root, 'src', 'nested'), { recursive: true })
  await mkdir(outside)
  await mkdir(lookalike)
  await writeFile(join(root, 'a.txt'), 'inside')
  await writeFile(join(root, 'src', 'nested', 'deep.ts'), 'export {}')
  await writeFile(join(outside, 'secret.txt'), 'outside secret')
  await writeFile(join(lookalike, 'secret.txt'), 'lookalike secret')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

async function linkDirectory(target: string, path: string): Promise<void> {
  await symlink(target, path, isWindows ? 'junction' : 'dir')
}

/** ファイルの symlink。作れない環境では false（呼び出し側が skip する）。 */
async function tryLinkFile(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path, 'file')
    return true
  } catch {
    return false
  }
}

function expectTarget(result: WorkspaceBoundaryResult): VerifiedWorkspaceTarget {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.denial}`)
  }

  expect(isVerifiedWorkspaceTarget(result.target)).toBe(true)

  return result.target
}

function denialOf(result: WorkspaceBoundaryResult): string {
  return result.ok ? 'ok' : result.denial
}

describe('Workspace の中', () => {
  it('Workspace 直下のファイルを読む', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'read'))

    expect(target.realPath).toBe(join(root, 'a.txt'))
    expect(target.canonicalRelativePath).toBe('a.txt')
    expect(target.requestedRelativePath).toBe('a.txt')
    expect(target.aliased).toBe(false)
    expect(target.state.kind).toBe('file')
    expect(Object.isFrozen(target)).toBe(true)
  })

  it('入れ子のファイル（区切りが \\ でも同じ）', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'src\\nested\\deep.ts', 'read'))

    expect(target.realPath).toBe(join(root, 'src', 'nested', 'deep.ts'))
    expect(target.canonicalRelativePath).toBe('src/nested/deep.ts')
  })

  it('既存のファイルへの書き込み（リンク数 1）', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'write'))

    expect(target.state).toMatchObject({ kind: 'file', linkCount: 1n })
  })

  it('Workspace root 自身は読める（ディレクトリ）が、書き込み先にはならない', async () => {
    const read = expectTarget(await resolveWorkspaceTarget(root, '', 'read'))

    expect(read.realPath).toBe(root)
    expect(read.canonicalRelativePath).toBe('')
    expect(read.state.kind).toBe('directory')

    expect(denialOf(await resolveWorkspaceTarget(root, '', 'write'))).toBe('not-a-file')
    expect(denialOf(await resolveWorkspaceTarget(root, 'src', 'write'))).toBe('not-a-file')
  })
})

describe('文字列の段階で拒否する', () => {
  it.each(['../outside/secret.txt', '..\\outside\\secret.txt', 'src/../../outside/secret.txt'])(
    'Traversal: %s',
    async (raw) => {
      expect(denialOf(await resolveWorkspaceTarget(root, raw, 'read'))).toBe('invalid-path')
    }
  )

  it('絶対パスは、Workspace の中を指していても受け付けない', async () => {
    expect(denialOf(await resolveWorkspaceTarget(root, join(root, 'a.txt'), 'read'))).toBe(
      'invalid-path'
    )
    expect(denialOf(await resolveWorkspaceTarget(root, join(outside, 'secret.txt'), 'read'))).toBe(
      'invalid-path'
    )
  })

  it.each(['C:foo', '\\\\server\\share\\a.txt', '\\\\?\\C:\\a.txt', 'a.txt:stream', 'NUL'])(
    'Windows 固有の形: %s',
    async (raw) => {
      expect(denialOf(await resolveWorkspaceTarget(root, raw, 'write'))).toBe('invalid-path')
    }
  )

  it('access が read / write でなければ拒否する', async () => {
    for (const access of ['delete', '', undefined, null, 1, { access: 'read' }]) {
      expect(denialOf(await resolveWorkspaceTarget(root, 'a.txt', access))).toBe('invalid-request')
    }
  })
})

describe('名前が前方一致する別のフォルダ', () => {
  it('workspace-evil は workspace の中ではない（リンクで指しても外）', async () => {
    await linkDirectory(lookalike, join(root, 'evil'))

    expect(denialOf(await resolveWorkspaceTarget(root, 'evil/secret.txt', 'read'))).toBe(
      'outside-workspace'
    )
    expect(denialOf(await resolveWorkspaceTarget(root, 'evil/new.txt', 'write'))).toBe(
      'outside-workspace'
    )
  })
})

describe('symlink / ジャンクション', () => {
  it('中を指すリンクは、実体が中なので通す（実体の綴りを返す）', async () => {
    await linkDirectory(join(root, 'src'), join(root, 'shortcut'))

    const target = expectTarget(
      await resolveWorkspaceTarget(root, 'shortcut/nested/deep.ts', 'read')
    )

    expect(target.realPath).toBe(join(root, 'src', 'nested', 'deep.ts'))
    expect(target.canonicalRelativePath).toBe('src/nested/deep.ts')
    expect(target.requestedRelativePath).toBe('shortcut/nested/deep.ts')
    expect(target.aliased).toBe(true)
  })

  it('外を指すディレクトリのリンク（ジャンクション相当）は読み書きとも拒否する', async () => {
    await linkDirectory(outside, join(root, 'escape'))

    expect(denialOf(await resolveWorkspaceTarget(root, 'escape/secret.txt', 'read'))).toBe(
      'outside-workspace'
    )
    expect(denialOf(await resolveWorkspaceTarget(root, 'escape/secret.txt', 'write'))).toBe(
      'outside-workspace'
    )
    expect(denialOf(await resolveWorkspaceTarget(root, 'escape', 'read'))).toBe('outside-workspace')
  })

  it('外を指すリンクの下の、まだ無いファイルへの書き込みも拒否する', async () => {
    await linkDirectory(outside, join(root, 'escape'))

    expect(denialOf(await resolveWorkspaceTarget(root, 'escape/new.txt', 'write'))).toBe(
      'outside-workspace'
    )
    expect(denialOf(await resolveWorkspaceTarget(root, 'escape/a/b/new.txt', 'write'))).toBe(
      'outside-workspace'
    )
  })

  it('入れ子の途中にある外へのリンクも拒否する', async () => {
    await linkDirectory(outside, join(root, 'src', 'nested', 'escape'))

    expect(
      denialOf(await resolveWorkspaceTarget(root, 'src/nested/escape/secret.txt', 'read'))
    ).toBe('outside-workspace')
  })

  it('外のファイルを指す file symlink は読み書きとも拒否する', async ({ skip }) => {
    if (!(await tryLinkFile(join(outside, 'secret.txt'), join(root, 'looks-inside.txt')))) {
      skip()
    }

    expect(denialOf(await resolveWorkspaceTarget(root, 'looks-inside.txt', 'read'))).toBe(
      'outside-workspace'
    )
    expect(denialOf(await resolveWorkspaceTarget(root, 'looks-inside.txt', 'write'))).toBe(
      'outside-workspace'
    )
  })

  it('中のファイルを指す file symlink は通す', async ({ skip }) => {
    if (!(await tryLinkFile(join(root, 'a.txt'), join(root, 'alias.txt')))) {
      skip()
    }

    const target = expectTarget(await resolveWorkspaceTarget(root, 'alias.txt', 'write'))

    expect(target.canonicalRelativePath).toBe('a.txt')
    expect(target.aliased).toBe(true)
  })

  /*
    指し先の無いリンクは realpath が ENOENT を返す。「まだ無いファイル」と同じに扱うと、
    書いた瞬間にリンクを辿って外にファイルができる。
  */
  it('指し先の無いリンクを「まだ無いファイル」と取り違えない', async () => {
    await linkDirectory(join(outside, 'not-yet'), join(root, 'dangling'))

    expect(denialOf(await resolveWorkspaceTarget(root, 'dangling', 'write'))).toBe('dangling-link')
    expect(denialOf(await resolveWorkspaceTarget(root, 'dangling/new.txt', 'write'))).toBe(
      'dangling-link'
    )
    expect(denialOf(await resolveWorkspaceTarget(root, 'dangling', 'read'))).toBe('not-found')
  })

  it('指し先の無い file symlink も同じ', async ({ skip }) => {
    if (!(await tryLinkFile(join(outside, 'not-yet.txt'), join(root, 'dangling.txt')))) {
      skip()
    }

    expect(denialOf(await resolveWorkspaceTarget(root, 'dangling.txt', 'write'))).toBe(
      'dangling-link'
    )
  })
})

describe('まだ無いファイル', () => {
  it('既存のフォルダの下の新しいファイル', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'src/new.ts', 'write'))

    expect(target.realPath).toBe(join(root, 'src', 'new.ts'))
    expect(target.canonicalRelativePath).toBe('src/new.ts')
    expect(target.state).toMatchObject({
      kind: 'missing',
      anchorRealPath: join(root, 'src'),
      missingSegments: ['new.ts']
    })
  })

  it('途中のフォルダも無い場合は、いちばん近い既存の祖先を anchor にする', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'src/x/y/new.ts', 'write'))

    expect(target.realPath).toBe(join(root, 'src', 'x', 'y', 'new.ts'))
    expect(target.state).toMatchObject({
      kind: 'missing',
      anchorRealPath: join(root, 'src'),
      missingSegments: ['x', 'y', 'new.ts']
    })
  })

  it('Workspace 直下の新しいファイルは root が anchor', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'new.txt', 'write'))

    expect(target.state).toMatchObject({ kind: 'missing', anchorRealPath: root })
  })

  it('中を指すリンクの下の新しいファイルは、実体の側で返す', async () => {
    await linkDirectory(join(root, 'src'), join(root, 'shortcut'))

    const target = expectTarget(await resolveWorkspaceTarget(root, 'shortcut/new.ts', 'write'))

    expect(target.realPath).toBe(join(root, 'src', 'new.ts'))
    expect(target.canonicalRelativePath).toBe('src/new.ts')
    expect(target.aliased).toBe(true)
  })

  it('読み取りでは not-found', async () => {
    expect(denialOf(await resolveWorkspaceTarget(root, 'src/new.ts', 'read'))).toBe('not-found')
    expect(denialOf(await resolveWorkspaceTarget(root, 'src/x/y/new.ts', 'read'))).toBe('not-found')
  })

  it('既存のファイルの下は指せない', async () => {
    expect(denialOf(await resolveWorkspaceTarget(root, 'a.txt/new.txt', 'write'))).toBe(
      'parent-not-directory'
    )
    expect(denialOf(await resolveWorkspaceTarget(root, 'a.txt/x/new.txt', 'write'))).toBe(
      'parent-not-directory'
    )
  })
})

describe('hard link', () => {
  it('リンク数が 2 以上なら、そのまま数を返す（拒否は Security Decision が行う）', async () => {
    await link(join(root, 'a.txt'), join(root, 'twin.txt'))

    const write = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'write'))

    expect(write.state).toMatchObject({ kind: 'file', linkCount: 2n })
  })

  it('外のファイルと hard link でつながったファイルも数に表れる', async () => {
    await link(join(outside, 'secret.txt'), join(root, 'linked.txt'))

    const write = expectTarget(await resolveWorkspaceTarget(root, 'linked.txt', 'write'))
    const read = expectTarget(await resolveWorkspaceTarget(root, 'linked.txt', 'read'))

    expect(write.state).toMatchObject({ kind: 'file', linkCount: 2n })
    // 読み取りは hard link であることだけでは拒否しない。
    expect(read.state.kind).toBe('file')
  })
})

describe('Workspace root', () => {
  it('root がリンクなら、実体で境界を引く', async () => {
    const rootLink = join(base, 'root-link')
    await linkDirectory(root, rootLink)

    const target = expectTarget(
      await resolveWorkspaceTarget(rootLink, 'src/nested/deep.ts', 'read')
    )

    expect(target.realRootPath).toBe(root)
    expect(target.realPath).toBe(join(root, 'src', 'nested', 'deep.ts'))
    expect(target.rootPath).toBe(rootLink)
  })

  it('root がリンクでも、その実体の外へ出るリンクは拒否する', async () => {
    const rootLink = join(base, 'root-link')
    await linkDirectory(root, rootLink)
    await linkDirectory(outside, join(root, 'escape'))

    expect(denialOf(await resolveWorkspaceTarget(rootLink, 'escape/secret.txt', 'read'))).toBe(
      'outside-workspace'
    )
  })

  it.each([
    ['無い', () => join(base, 'missing-root')],
    ['ファイル', () => join(root, 'a.txt')],
    ['相対パス', () => 'workspace'],
    ['空文字', () => ''],
    ['NUL を含む', () => `${root}\0`]
  ])('root が%sなら no-workspace', async (_label, rootOf) => {
    expect(denialOf(await resolveWorkspaceTarget(rootOf(), 'a.txt', 'read'))).toBe('no-workspace')
  })

  it('root が文字列でなければ no-workspace', async () => {
    for (const value of [undefined, null, 1, { rootPath: root }]) {
      expect(denialOf(await resolveWorkspaceTarget(value, 'a.txt', 'read'))).toBe('no-workspace')
    }
  })

  it('root が指し先の無いリンクなら no-workspace', async () => {
    const rootLink = join(base, 'dangling-root')
    await linkDirectory(join(base, 'gone'), rootLink)

    expect(denialOf(await resolveWorkspaceTarget(rootLink, 'a.txt', 'read'))).toBe('no-workspace')
  })
})

describe('TOCTOU：確かめた後の差し替え', () => {
  it('何も変わっていなければ、recheck は同じ対象を返す', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'write'))
    const again = expectTarget(await recheckWorkspaceTarget(target))

    expect(again.realPath).toBe(target.realPath)
  })

  it('ファイルが別のファイルに置き換えられたら target-changed', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'write'))

    await writeFile(join(root, 'replacement.txt'), 'replaced')
    await rename(join(root, 'replacement.txt'), join(root, 'a.txt'))

    expect(denialOf(await recheckWorkspaceTarget(target))).toBe('target-changed')
  })

  it('確かめた後で hard link が張られたら、書き込みは target-changed', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'write'))

    await link(join(root, 'a.txt'), join(root, 'twin.txt'))

    expect(denialOf(await recheckWorkspaceTarget(target))).toBe('target-changed')
  })

  it('途中のフォルダが外へのリンクに差し替えられたら拒否する（既存のファイル）', async () => {
    await mkdir(join(outside, 'nested'))
    await writeFile(join(outside, 'nested', 'deep.ts'), 'outside')

    const target = expectTarget(await resolveWorkspaceTarget(root, 'src/nested/deep.ts', 'write'))

    await rename(join(root, 'src'), join(root, 'src-old'))
    await linkDirectory(outside, join(root, 'src'))

    expect(denialOf(await recheckWorkspaceTarget(target))).toBe('outside-workspace')
  })

  it('途中のフォルダが外へのリンクに差し替えられたら拒否する（まだ無いファイル）', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'src/new.ts', 'write'))

    await rename(join(root, 'src'), join(root, 'src-old'))
    await linkDirectory(outside, join(root, 'src'))

    expect(denialOf(await recheckWorkspaceTarget(target))).toBe('outside-workspace')
  })

  it('途中のフォルダが中へのリンクに差し替えられても、実体が変われば target-changed', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'src/new.ts', 'write'))

    await mkdir(join(root, 'other'))
    await rename(join(root, 'src'), join(root, 'src-old'))
    await linkDirectory(join(root, 'other'), join(root, 'src'))

    expect(denialOf(await recheckWorkspaceTarget(target))).toBe('target-changed')
  })

  it('確かめた後で、まだ無いはずの位置に外へのリンクが置かれたら拒否する', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'src/sub/new.ts', 'write'))

    await linkDirectory(outside, join(root, 'src', 'sub'))

    expect(denialOf(await recheckWorkspaceTarget(target))).toBe('outside-workspace')
  })

  it('root のリンクが別のフォルダへ向け直されたら target-changed', async () => {
    const other = join(base, 'other-workspace')
    await mkdir(other)
    await writeFile(join(other, 'a.txt'), 'other')

    const rootLink = join(base, 'root-link')
    await linkDirectory(root, rootLink)

    const target = expectTarget(await resolveWorkspaceTarget(rootLink, 'a.txt', 'write'))

    await unlink(rootLink).catch(() => rmdir(rootLink))
    await linkDirectory(other, rootLink)

    expect(denialOf(await recheckWorkspaceTarget(target))).toBe('target-changed')
  })

  it('Boundary が作っていない対象は recheck できない', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'write'))

    expect(denialOf(await recheckWorkspaceTarget({ ...target }))).toBe('invalid-request')
    expect(denialOf(await recheckWorkspaceTarget(null))).toBe('invalid-request')
  })
})

describe('TOCTOU：開いたハンドルの確認', () => {
  it('確かめた対象を開いたハンドルなら true', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'write'))
    const handle = await open(target.realPath, 'r+')

    try {
      expect(await confirmOpenedWorkspaceFile(target, handle)).toBe(true)
    } finally {
      await handle.close()
    }
  })

  it('確かめた後で置き換えられたファイルを開いたら false', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'write'))

    await writeFile(join(root, 'replacement.txt'), 'replaced')
    await rename(join(root, 'replacement.txt'), join(root, 'a.txt'))

    const handle = await open(target.realPath, 'r+')

    try {
      expect(await confirmOpenedWorkspaceFile(target, handle)).toBe(false)
    } finally {
      await handle.close()
    }
  })

  it('開いた後でパスが別のファイルに置き換えられたら false', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'read'))
    const handle = await open(target.realPath, 'r')

    try {
      await writeFile(join(root, 'replacement.txt'), 'replaced')
      await rm(join(root, 'a.txt'))
      await rename(join(root, 'replacement.txt'), join(root, 'a.txt'))

      expect(await confirmOpenedWorkspaceFile(target, handle)).toBe(false)
    } finally {
      await handle.close()
    }
  })

  it('開いた時点で hard link になっていたら、書き込みは false・読み取りは true', async () => {
    const write = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'write'))
    const read = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'read'))

    await link(join(root, 'a.txt'), join(root, 'twin.txt'))

    const handle = await open(join(root, 'a.txt'), 'r')

    try {
      expect(await confirmOpenedWorkspaceFile(write, handle)).toBe(false)
      expect(await confirmOpenedWorkspaceFile(read, handle)).toBe(true)
    } finally {
      await handle.close()
    }
  })

  it('新しく作ったファイルは、作った後のハンドルで確かめる', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'src/new.ts', 'write'))
    // O_EXCL：その位置に何か（リンクを含む）があれば作らずに失敗する。
    const handle = await open(target.realPath, 'wx')

    try {
      expect(await confirmOpenedWorkspaceFile(target, handle)).toBe(true)
    } finally {
      await handle.close()
    }
  })

  it('途中のフォルダが外へのリンクに差し替えられた後に作ったファイルは false', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'src/new.ts', 'write'))

    await rename(join(root, 'src'), join(root, 'src-old'))
    await linkDirectory(outside, join(root, 'src'))

    // 差し替えを見落として開いた、という想定。外にファイルができてしまう（これが残る穴）。
    const handle = await open(target.realPath, 'wx')

    try {
      expect(await confirmOpenedWorkspaceFile(target, handle)).toBe(false)
      expect(await readFile(join(outside, 'new.ts'), 'utf8')).toBe('')
    } finally {
      await handle.close()
    }
  })

  it('Boundary が作っていない対象・ディレクトリは false', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'a.txt', 'read'))
    const directory = expectTarget(await resolveWorkspaceTarget(root, 'src', 'read'))
    const handle = await open(target.realPath, 'r')

    try {
      expect(await confirmOpenedWorkspaceFile({ ...target }, handle)).toBe(false)
      expect(await confirmOpenedWorkspaceFile(directory, handle)).toBe(false)
    } finally {
      await handle.close()
    }
  })
})

/*
  v1 の File Write Gate（STEP7）が拒否に使う事実（2026-09-23 決定）。
  Boundary 自体は解決して事実を返し、拒否は Gate が行う。ここでは事実が落ちないことを固定する。
    - 書き込み + aliased                     → 拒否（symlink / ジャンクション経由の書き込みは v2 以降）
    - 書き込み + 欠けている要素が 2 つ以上   → 拒否（途中のディレクトリは作らない）
*/
describe('v1 の Write 制限に使う事実を保持する', () => {
  it('直接指した既存のファイル・新しいファイルは aliased ではない', async () => {
    const existing = expectTarget(await resolveWorkspaceTarget(root, 'src/nested/deep.ts', 'write'))
    const created = expectTarget(await resolveWorkspaceTarget(root, 'src/new.ts', 'write'))

    expect(existing.aliased).toBe(false)
    expect(created.aliased).toBe(false)
  })

  it('中を指すジャンクション経由の書き込みは aliased（既存・新規とも）', async () => {
    await linkDirectory(join(root, 'src'), join(root, 'shortcut'))

    const existing = expectTarget(
      await resolveWorkspaceTarget(root, 'shortcut/nested/deep.ts', 'write')
    )
    const created = expectTarget(await resolveWorkspaceTarget(root, 'shortcut/new.ts', 'write'))

    expect(existing.aliased).toBe(true)
    expect(created.aliased).toBe(true)
  })

  it('中を指す file symlink 経由の書き込みは aliased', async ({ skip }) => {
    if (!(await tryLinkFile(join(root, 'a.txt'), join(root, 'alias.txt')))) {
      skip()
    }

    expect(expectTarget(await resolveWorkspaceTarget(root, 'alias.txt', 'write')).aliased).toBe(
      true
    )
  })

  it.runIf(isWindows)(
    '大文字小文字だけの違いはリンクではないので aliased にしない（実体の綴りは canonical に出る）',
    async () => {
      const target = expectTarget(await resolveWorkspaceTarget(root, 'A.TXT', 'write'))

      expect(target.aliased).toBe(false)
      expect(target.canonicalRelativePath).toBe('a.txt')
    }
  )

  it('既存のディレクトリ内の新規ファイルは、欠けている要素が 1 つ', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'src/new.ts', 'write'))

    expect(target.state.kind === 'missing' && target.state.missingSegments).toEqual(['new.ts'])
  })

  it('途中のディレクトリが無ければ、欠けている要素が 2 つ以上として残る', async () => {
    const target = expectTarget(await resolveWorkspaceTarget(root, 'src/x/new.ts', 'write'))

    expect(target.state.kind === 'missing' && target.state.missingSegments).toEqual(['x', 'new.ts'])
  })
})
