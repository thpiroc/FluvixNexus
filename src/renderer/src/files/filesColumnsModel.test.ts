import { describe, expect, it } from 'vitest'
import type { FileEntry } from '@shared/files'
import {
  activeDirectoryFor,
  buildFileColumns,
  clampActiveDirectory,
  columnDirectories
} from './filesColumnsModel'
import type { DirectoryState, FileTreeDirectories } from './fileTreeModel'

/**
 * カラム表示の列の並び（Session 3-6-7）。
 *
 * ツリー側（fileTreeModel.test.ts）が「1つのフォルダの状態が行としてどう出るか」を
 * 押さえているので、ここで確かめるのは**カラム表示にしか無いこと**に絞る。
 *
 *   - 列の並びが activeDirectory から導かれること（右側を捨てる処理を持たない）
 *   - 1つのカラムの中身が**ツリーと同じ関数**を通っていること（読み込み中・空・失敗）
 *   - 消えたフォルダから右を捨てて、開ける場所まで戻ること
 */

function file(relativePath: string): FileEntry {
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)

  return { id: `f:${relativePath}`, name, relativePath, type: 'file', extension: null }
}

function directory(relativePath: string): FileEntry {
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)

  return { id: `d:${relativePath}`, name, relativePath, type: 'directory', extension: null }
}

function ready(...entries: readonly FileEntry[]): {
  status: 'ready'
  entries: readonly FileEntry[]
  truncated: boolean
} {
  return { status: 'ready', entries, truncated: false }
}

/** `src/renderer` まで開いた状態の読み込み済みの表。 */
function loadedDirectories(): FileTreeDirectories {
  return new Map<string, DirectoryState>([
    ['', ready(directory('src'), file('package.json'))],
    ['src', ready(directory('src/renderer'), file('src/index.ts'))],
    ['src/renderer', ready(file('src/renderer/App.tsx'))]
  ])
}

describe('columnDirectories', () => {
  it('root だけのときは1列', () => {
    expect(columnDirectories('')).toEqual([''])
  })

  it('root から目的のフォルダまでを左から順に並べる', () => {
    expect(columnDirectories('src')).toEqual(['', 'src'])
    expect(columnDirectories('src/renderer/files')).toEqual([
      '',
      'src',
      'src/renderer',
      'src/renderer/files'
    ])
  })

  /*
    「別のフォルダを選んだら、それより右の古いカラムは捨てる」が**導出になっている**
    ことの確認。切り詰める処理を持たないので、切り詰め忘れが起きない。
  */
  it('浅いフォルダを選び直すと、右側の列は自然に消える', () => {
    expect(columnDirectories('docs')).toEqual(['', 'docs'])
  })
})

describe('buildFileColumns', () => {
  it('左端は Workspace の表示名、以降はフォルダ名を見出しにする', () => {
    const columns = buildFileColumns({
      rootName: 'Fluvix Nexus',
      directories: loadedDirectories(),
      activeDirectory: 'src/renderer'
    })

    expect(columns.map((column) => column.name)).toEqual(['Fluvix Nexus', 'src', 'renderer'])
    expect(columns.map((column) => column.relativePath)).toEqual(['', 'src', 'src/renderer'])
  })

  it('カラムには、そのフォルダの直下だけが並ぶ（中まで辿らない）', () => {
    const columns = buildFileColumns({
      rootName: 'root',
      directories: loadedDirectories(),
      activeDirectory: 'src'
    })

    expect(columns[0]?.rows.map((row) => row.key)).toEqual(['d:src', 'f:package.json'])
    expect(columns[1]?.rows.map((row) => row.key)).toEqual(['d:src/renderer', 'f:src/index.ts'])
  })

  /* 右のカラムとして開いているフォルダに印が付く（ツリーの「展開中」と同じ旗）。 */
  it('右のカラムを開いているフォルダは expanded になる', () => {
    const columns = buildFileColumns({
      rootName: 'root',
      directories: loadedDirectories(),
      activeDirectory: 'src/renderer'
    })

    const rootRows = columns[0]?.rows ?? []
    const srcRow = rootRows.find((row) => row.key === 'd:src')

    expect(srcRow?.kind === 'entry' && srcRow.expanded).toBe(true)
    expect(columns[0]?.openedChildRelativePath).toBe('src')
    // 一番右のカラムは何も開いていない。
    expect(columns[2]?.openedChildRelativePath).toBeNull()
  })

  /* 行の深さはカラムが示す（横に並べるので、行の側のインデントは要らない）。 */
  it('行の depth は 0 で揃う', () => {
    const columns = buildFileColumns({
      rootName: 'root',
      directories: loadedDirectories(),
      activeDirectory: 'src/renderer'
    })

    for (const column of columns) {
      for (const row of column.rows) {
        expect(row.depth).toBe(0)
      }
    }
  })

  /*
    1つのカラムの中身はツリーと同じ `directoryRows()` を通る。
    読んでいないフォルダが「読み込み中」として出るのもその結果になる。
  */
  it('まだ読んでいないフォルダのカラムは読み込み中として出る', () => {
    const columns = buildFileColumns({
      rootName: 'root',
      directories: new Map<string, DirectoryState>([['', ready(directory('src'))]]),
      activeDirectory: 'src'
    })

    expect(columns[1]?.rows).toEqual([
      {
        kind: 'note',
        key: 'note:loading:src',
        depth: 0,
        variant: 'loading',
        relativePath: 'src',
        reason: null
      }
    ])
  })

  it('読めなかったフォルダのカラムは理由付きで出る', () => {
    const columns = buildFileColumns({
      rootName: 'root',
      directories: new Map<string, DirectoryState>([
        ['', ready(directory('secret'))],
        ['secret', { status: 'error', reason: 'permission-denied' }]
      ]),
      activeDirectory: 'secret'
    })

    const note = columns[1]?.rows[0]

    expect(note?.kind).toBe('note')
    expect(note?.kind === 'note' && note.variant).toBe('error')
    expect(note?.kind === 'note' && note.reason).toBe('permission-denied')
  })

  /* 名前の入力（作成）もツリーとまったく同じ行として、そのフォルダのカラムに出る。 */
  it('作成中の行は、作成先のフォルダのカラムに出る', () => {
    const columns = buildFileColumns({
      rootName: 'root',
      directories: loadedDirectories(),
      activeDirectory: 'src/renderer',
      draft: { kind: 'create', parentRelativePath: 'src', entryType: 'file' }
    })

    expect(columns[1]?.rows[0]).toEqual({
      kind: 'draft',
      key: 'draft:file:src',
      depth: 0,
      parentRelativePath: 'src',
      entryType: 'file'
    })

    // 他のカラムには出ない（どのフォルダに対する入力かが画面から決まる）。
    expect(columns[0]?.rows.some((row) => row.kind === 'draft')).toBe(false)
    expect(columns[2]?.rows.some((row) => row.kind === 'draft')).toBe(false)
  })
})

describe('clampActiveDirectory', () => {
  it('全部辿れるならそのまま', () => {
    expect(clampActiveDirectory(loadedDirectories(), 'src/renderer')).toBe('src/renderer')
  })

  /* 消えたフォルダの手前まで戻す（そこから右は行き止まりになっている）。 */
  it('消えたフォルダから右は捨てる', () => {
    const directories: FileTreeDirectories = new Map<string, DirectoryState>([
      ['', ready()],
      ['src', { status: 'error', reason: 'not-found' }]
    ])

    expect(clampActiveDirectory(directories, 'src/renderer/files')).toBe('')
  })

  it('途中まで辿れるならそこまで残す', () => {
    const directories: FileTreeDirectories = new Map<string, DirectoryState>([
      ['', ready(directory('src'))],
      ['src', ready(directory('src/renderer'))],
      ['src/renderer', { status: 'error', reason: 'not-found' }]
    ])

    expect(clampActiveDirectory(directories, 'src/renderer/files')).toBe('src')
  })

  /*
    「まだ読んでいない」と「消えた」を混同しない。開いた直後のカラムは
    読み込み中なので、ここで畳むと開いた瞬間に閉じることになる。
  */
  it('読み込み中・未取得では畳まない', () => {
    const directories: FileTreeDirectories = new Map<string, DirectoryState>([
      ['', ready(directory('src'))],
      ['src', { status: 'loading' }]
    ])

    expect(clampActiveDirectory(directories, 'src/renderer')).toBe('src/renderer')
    expect(clampActiveDirectory(new Map(), 'src/renderer')).toBe('src/renderer')
  })

  /* 権限が無いフォルダは「そこに在る」。畳まずに理由を見せる。 */
  it('権限が無いだけなら畳まない', () => {
    const directories: FileTreeDirectories = new Map<string, DirectoryState>([
      ['', ready(directory('secret'))],
      ['secret', { status: 'error', reason: 'permission-denied' }]
    ])

    expect(clampActiveDirectory(directories, 'secret')).toBe('secret')
  })
})

describe('activeDirectoryFor', () => {
  it('フォルダを開くとそのフォルダが一番右になる', () => {
    expect(activeDirectoryFor('src/renderer', 'directory')).toBe('src/renderer')
  })

  /* ファイルを選んでも列は増えない（右に空のカラムを生やさない）。 */
  it('ファイルを選ぶと、それを含むフォルダが一番右になる', () => {
    expect(activeDirectoryFor('src/renderer/App.tsx', 'file')).toBe('src/renderer')
    expect(activeDirectoryFor('package.json', 'file')).toBe('')
  })
})
