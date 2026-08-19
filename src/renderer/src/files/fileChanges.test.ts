import { describe, expect, it } from 'vitest'
import type { FileEntry, WorkspaceFileChange } from '@shared/files'
import {
  applyChangesToDirectories,
  applyChangesToExpanded,
  directoriesToReload,
  removedPaths
} from './fileChanges'
import type { DirectoryState, FileTreeDirectories } from './fileTreeModel'

/**
 * ディスク側の変化を、ファイルツリーの状態へ落とす。
 *
 * 要は **Lazy Load を崩さないこと**。1件の変化で読み直すのは親フォルダ1つだけで、
 * 読み込み済みの他のフォルダはそのまま残る（node_modules を展開した状態で
 * ファイルを1つ作っただけで数千件を読み直さない）。
 */

function file(name: string, parent = ''): FileEntry {
  const relativePath = parent === '' ? name : `${parent}/${name}`

  return { id: `f:${relativePath}`, name, relativePath, type: 'file', extension: null }
}

function ready(entries: readonly FileEntry[] = []): DirectoryState {
  return { status: 'ready', entries, truncated: false }
}

function directories(paths: readonly string[]): FileTreeDirectories {
  return new Map(paths.map((path) => [path, ready([file('placeholder', path)])]))
}

const created = (relativePath: string): WorkspaceFileChange => ({
  kind: 'created',
  relativePath,
  entryType: 'file'
})

const deleted = (
  relativePath: string,
  entryType: 'file' | 'directory' = 'file'
): WorkspaceFileChange => ({
  kind: 'deleted',
  relativePath,
  entryType
})

const renamed = (
  from: string,
  to: string,
  entryType: 'file' | 'directory' = 'file'
): WorkspaceFileChange => ({
  kind: 'renamed',
  fromRelativePath: from,
  toRelativePath: to,
  entryType
})

/** アプリの外での中身の変更（Session 3-5 のファイル監視）。 */
const modified = (relativePath: string): WorkspaceFileChange => ({
  kind: 'modified',
  relativePath,
  entryType: 'file',
  revision: { mtimeMs: 1, size: 1 }
})

describe('directoriesToReload', () => {
  it('読み直すのは変化した位置ではなく、その親', () => {
    expect(directoriesToReload([created('src/main/new.ts')])).toEqual(['src/main'])
  })

  it('root 直下の変化は root を読み直す', () => {
    expect(directoriesToReload([created('README.md')])).toEqual([''])
  })

  it('改名は同じフォルダの中で完結するので1つに畳まれる', () => {
    expect(directoriesToReload([renamed('src/a.ts', 'src/b.ts')])).toEqual(['src'])
  })

  /*
    Session 3-6-1。移動も同じ `renamed` として届くが、元と先が別のフォルダになる。
    **受け手はその区別を持たない** ── 「位置が変わった」から読み直す相手を導くと、
    改名では1つに、移動では2つに、同じ規則のまま落ちる。
  */
  it('移動は元と先の2つのフォルダを読み直す', () => {
    expect(directoriesToReload([renamed('src/a.ts', 'docs/a.ts')])).toEqual(['src', 'docs'])
  })

  it('root へ動かした場合も、元と root の2つ', () => {
    expect(directoriesToReload([renamed('src/a.ts', 'a.ts')])).toEqual(['src', ''])
  })

  it('同じフォルダの変化が複数あっても1回だけ読み直す', () => {
    expect(directoriesToReload([created('src/a.ts'), deleted('src/b.ts')])).toEqual(['src'])
  })

  /*
    Session 3-5。ファイル監視が加わり、外部のビルドツールがファイルを書き換えるたびに
    `modified` が届くようになった。ツリーの形は変わらない（並びも位置も同じ）ので、
    ここで読み直すと Lazy Load の意味が薄れる。中身を持っているのは Editor だけ。
  */
  it('中身の変更（modified）では読み直さない', () => {
    expect(directoriesToReload([modified('src/main/index.ts')])).toEqual([])
  })

  it('同じ束に他の変化があれば、そちらの親だけを読み直す', () => {
    expect(directoriesToReload([modified('src/a.ts'), created('docs/b.md')])).toEqual(['docs'])
  })
})

describe('removedPaths', () => {
  it('削除と改名の元の位置を集める', () => {
    expect(removedPaths([deleted('src/a.ts'), renamed('docs', 'guide', 'directory')])).toEqual([
      'src/a.ts',
      'docs'
    ])
  })

  it('作成では何も消えない', () => {
    expect(removedPaths([created('a.ts')])).toEqual([])
  })
})

describe('applyChangesToDirectories', () => {
  it('変わったフォルダの欄だけを捨てる（他は読み込み済みのまま残す）', () => {
    const loaded = directories(['', 'src', 'node_modules', 'node_modules/react'])
    const next = applyChangesToDirectories(loaded, [created('src/new.ts')])

    expect([...next.keys()].sort()).toEqual(['', 'node_modules', 'node_modules/react'])
  })

  it('フォルダを消したら、その配下の読み込み済みもまとめて捨てる', () => {
    const loaded = directories(['', 'src', 'src/main', 'src/main/deep', 'docs'])
    const next = applyChangesToDirectories(loaded, [deleted('src', 'directory')])

    expect([...next.keys()].sort()).toEqual(['docs'])
  })

  it('フォルダを改名したら、元の位置の配下を捨てる', () => {
    const loaded = directories(['', 'src', 'src/main'])
    const next = applyChangesToDirectories(loaded, [renamed('src', 'source', 'directory')])

    // root は読み直しの対象、src とその配下は消えた位置。
    expect([...next.keys()]).toEqual([])
  })

  it('名前の前方一致だけのフォルダは巻き込まない', () => {
    const loaded = directories(['', 'src', 'src2'])
    const next = applyChangesToDirectories(loaded, [deleted('src', 'directory')])

    expect([...next.keys()]).toEqual(['src2'])
  })

  it('今の表に関係が無ければ、元のオブジェクトをそのまま返す', () => {
    const loaded = directories(['src'])

    expect(applyChangesToDirectories(loaded, [created('docs/a.md')])).toBe(loaded)
  })
})

describe('applyChangesToExpanded', () => {
  it('消えたフォルダとその配下を展開状態から外す', () => {
    const expanded: ReadonlySet<string> = new Set(['', 'src', 'src/main', 'docs'])
    const next = applyChangesToExpanded(expanded, [deleted('src', 'directory')])

    expect([...next].sort()).toEqual(['', 'docs'])
  })

  /*
    残しておくと、同じ名前のフォルダが後から作られたときに勝手に開いた状態で現れる。
  */
  it('改名の元の位置も外す', () => {
    const expanded: ReadonlySet<string> = new Set(['', 'src', 'src/main'])
    const next = applyChangesToExpanded(expanded, [renamed('src', 'source', 'directory')])

    expect([...next]).toEqual([''])
  })

  it('改名の行き先は展開しない（読み込み済みも消えているため）', () => {
    const expanded: ReadonlySet<string> = new Set(['', 'src'])
    const next = applyChangesToExpanded(expanded, [renamed('src', 'source', 'directory')])

    expect(next.has('source')).toBe(false)
  })

  it('作成では展開状態が変わらない', () => {
    const expanded: ReadonlySet<string> = new Set(['', 'src'])

    expect(applyChangesToExpanded(expanded, [created('src/a.ts')])).toBe(expanded)
  })

  it('関係が無ければ元の集合をそのまま返す', () => {
    const expanded: ReadonlySet<string> = new Set(['', 'src'])

    expect(applyChangesToExpanded(expanded, [deleted('docs/a.md')])).toBe(expanded)
  })
})
