import { describe, expect, it } from 'vitest'
import type { FileEntry } from '@shared/files'
import {
  ancestorRelativePaths,
  countLoadedEntries,
  findEntryById,
  flattenFileTree,
  resolveCreateTarget,
  toggleExpanded,
  type DirectoryState,
  type FileTreeDirectories,
  type FileTreeRow
} from './fileTreeModel'

/**
 * 「今どこまで読んだか」と「どこを開いているか」から、画面に並ぶ行が決まること。
 *
 * Lazy Load の要は**読んでいないフォルダがある状態が普通である**ことなので、
 * 未取得・読み込み中・失敗が行として表れるところを厚く確かめる。
 */

function directory(name: string, parent = ''): FileEntry {
  const relativePath = parent === '' ? name : `${parent}/${name}`

  return { id: `d:${relativePath}`, name, relativePath, type: 'directory', extension: null }
}

function file(name: string, parent = ''): FileEntry {
  const relativePath = parent === '' ? name : `${parent}/${name}`

  return { id: `f:${relativePath}`, name, relativePath, type: 'file', extension: null }
}

function ready(entries: readonly FileEntry[], truncated = false): DirectoryState {
  return { status: 'ready', entries, truncated }
}

function directories(pairs: readonly [string, DirectoryState][]): FileTreeDirectories {
  return new Map(pairs)
}

function describeRows(rows: readonly FileTreeRow[]): string[] {
  return rows.map((row) => {
    const indent = '  '.repeat(row.depth)

    if (row.kind === 'entry') {
      return `${indent}${row.entry.name}${row.expanded ? '/' : ''}`
    }

    return row.kind === 'note' ? `${indent}<${row.variant}>` : `${indent}[${row.entryType}]`
  })
}

describe('flattenFileTree', () => {
  it('root を畳んでいる間は root の行だけを出す', () => {
    const rows = flattenFileTree({
      rootName: 'project',
      directories: directories([['', ready([file('a.ts')])]]),
      expanded: new Set()
    })

    expect(describeRows(rows)).toEqual(['project'])
  })

  it('root を開くと Workspace 直下が並ぶ', () => {
    const rows = flattenFileTree({
      rootName: 'project',
      directories: directories([['', ready([directory('src'), file('README.md')])]]),
      expanded: new Set([''])
    })

    expect(describeRows(rows)).toEqual(['project/', '  src', '  README.md'])
  })

  it('まだ読んでいないフォルダを開いた直後は読み込み中として出す', () => {
    const rows = flattenFileTree({
      rootName: 'project',
      directories: directories([['', ready([directory('src')])]]),
      expanded: new Set(['', 'src'])
    })

    expect(describeRows(rows)).toEqual(['project/', '  src/', '    <loading>'])
  })

  it('開いたフォルダの中身だけを深く辿る（畳んだフォルダの中は辿らない）', () => {
    const rows = flattenFileTree({
      rootName: 'project',
      directories: directories([
        ['', ready([directory('src'), directory('docs')])],
        ['src', ready([directory('main', 'src'), file('index.ts', 'src')])],
        ['src/main', ready([file('app.ts', 'src/main')])],
        // 読み込み済みでも、開いていなければ現れない。
        ['docs', ready([file('guide.md', 'docs')])]
      ]),
      expanded: new Set(['', 'src', 'src/main'])
    })

    expect(describeRows(rows)).toEqual([
      'project/',
      '  src/',
      '    main/',
      '      app.ts',
      '    index.ts',
      '  docs'
    ])
  })

  it('空のフォルダは開いたことが分かるように出す', () => {
    const rows = flattenFileTree({
      rootName: 'project',
      directories: directories([
        ['', ready([directory('empty')])],
        ['empty', ready([])]
      ]),
      expanded: new Set(['', 'empty'])
    })

    expect(describeRows(rows)).toEqual(['project/', '  empty/', '    <empty>'])
  })

  it('読めなかったフォルダは、その位置に失敗として出す（他の枝は残る）', () => {
    const rows = flattenFileTree({
      rootName: 'project',
      directories: directories([
        ['', ready([directory('locked'), file('a.ts')])],
        ['locked', { status: 'error', reason: 'permission-denied' }]
      ]),
      expanded: new Set(['', 'locked'])
    })

    expect(describeRows(rows)).toEqual(['project/', '  locked/', '    <error>', '  a.ts'])

    const note = rows.find((row) => row.kind === 'note')

    expect(note).toMatchObject({
      variant: 'error',
      reason: 'permission-denied',
      relativePath: 'locked'
    })
  })

  it('打ち切られたフォルダは中身の後にその旨を出す', () => {
    const rows = flattenFileTree({
      rootName: 'project',
      directories: directories([['', ready([file('a.ts')], true)]]),
      expanded: new Set([''])
    })

    expect(describeRows(rows)).toEqual(['project/', '  a.ts', '  <truncated>'])
  })

  it('root 自体が読めなくても行は出る（Workspace ごと消えた場合）', () => {
    const rows = flattenFileTree({
      rootName: 'project',
      directories: directories([['', { status: 'error', reason: 'not-found' }]]),
      expanded: new Set([''])
    })

    expect(describeRows(rows)).toEqual(['project/', '  <error>'])
  })

  it('行の key が重複しない（React の key と選択の識別子を兼ねるため）', () => {
    const rows = flattenFileTree({
      rootName: 'project',
      directories: directories([
        ['', ready([directory('src'), file('src.ts')])],
        ['src', ready([file('index.ts', 'src')], true)]
      ]),
      expanded: new Set(['', 'src'])
    })

    const keys = rows.map((row) => row.key)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('同じ名前のファイルとフォルダは別の行として扱える', () => {
    const rows = flattenFileTree({
      rootName: 'project',
      directories: directories([['', ready([directory('build'), file('build')])]]),
      expanded: new Set([''])
    })

    expect(rows.map((row) => row.key)).toEqual(['d:', 'd:build', 'f:build'])
  })
})

describe('flattenFileTree（名前を入力している最中）', () => {
  it('作成中の行は、作成先フォルダの中身より先に出る', () => {
    const rows = flattenFileTree({
      rootName: 'project',
      directories: directories([
        ['', ready([directory('src')])],
        ['src', ready([file('index.ts', 'src')])]
      ]),
      expanded: new Set(['', 'src']),
      draft: { kind: 'create', parentRelativePath: 'src', entryType: 'file' }
    })

    expect(describeRows(rows)).toEqual(['project/', '  src/', '    [file]', '    index.ts'])
  })

  it('まだ読めていないフォルダでも作成中の行は出る（読めないことは作れない理由ではない）', () => {
    const rows = flattenFileTree({
      rootName: 'project',
      directories: directories([['', ready([directory('src')])]]),
      expanded: new Set(['', 'src']),
      draft: { kind: 'create', parentRelativePath: 'src', entryType: 'directory' }
    })

    expect(describeRows(rows)).toEqual(['project/', '  src/', '    [directory]', '    <loading>'])
  })

  it('空のフォルダに作成中のときは「空のフォルダ」を出さない', () => {
    const rows = flattenFileTree({
      rootName: 'project',
      directories: directories([
        ['', ready([directory('empty')])],
        ['empty', ready([])]
      ]),
      expanded: new Set(['', 'empty']),
      draft: { kind: 'create', parentRelativePath: 'empty', entryType: 'file' }
    })

    expect(describeRows(rows)).toEqual(['project/', '  empty/', '    [file]'])
  })

  it('リネーム中は行を増やさない（既存の行が入力欄に差し替わるだけ）', () => {
    const input = {
      rootName: 'project',
      directories: directories([['', ready([file('a.ts')])]]),
      expanded: new Set([''])
    }

    const plain = flattenFileTree(input)
    const renaming = flattenFileTree({
      ...input,
      draft: { kind: 'rename', relativePath: 'a.ts', initialName: 'a.ts' }
    })

    expect(describeRows(renaming)).toEqual(describeRows(plain))
  })

  it('root 直下に作成中でも key が重複しない', () => {
    const rows = flattenFileTree({
      rootName: 'project',
      directories: directories([['', ready([file('a.ts')])]]),
      expanded: new Set(['']),
      draft: { kind: 'create', parentRelativePath: '', entryType: 'file' }
    })

    const keys = rows.map((row) => row.key)

    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('resolveCreateTarget', () => {
  it('何も選んでいなければ Workspace root', () => {
    expect(resolveCreateTarget(null)).toBe('')
  })

  it('フォルダを選んでいればそのフォルダ', () => {
    expect(resolveCreateTarget(directory('main', 'src'))).toBe('src/main')
  })

  it('ファイルを選んでいればそれを含むフォルダ', () => {
    expect(resolveCreateTarget(file('index.ts', 'src'))).toBe('src')
  })

  it('root 直下のファイルなら Workspace root', () => {
    expect(resolveCreateTarget(file('README.md'))).toBe('')
  })
})

describe('findEntryById', () => {
  const rows = flattenFileTree({
    rootName: 'project',
    directories: directories([['', ready([directory('src'), file('a.ts')])]]),
    expanded: new Set([''])
  })

  it('並んでいる行から探せる', () => {
    expect(findEntryById(rows, 'f:a.ts')?.name).toBe('a.ts')
  })

  it('選択が無い / 並んでいない id なら null', () => {
    expect(findEntryById(rows, null)).toBeNull()
    expect(findEntryById(rows, 'f:gone.ts')).toBeNull()
  })
})

describe('countLoadedEntries', () => {
  const loaded = directories([
    ['src', ready([file('index.ts', 'src')])],
    ['empty', ready([])],
    ['pending', { status: 'loading' }]
  ])

  it('読み込み済みなら件数が分かる', () => {
    expect(countLoadedEntries(loaded, 'src')).toBe(1)
    expect(countLoadedEntries(loaded, 'empty')).toBe(0)
  })

  it('読んでいなければ null（確認のために読みに行かない）', () => {
    expect(countLoadedEntries(loaded, 'pending')).toBeNull()
    expect(countLoadedEntries(loaded, 'docs')).toBeNull()
  })
})

describe('toggleExpanded', () => {
  it('開いていなければ開き、開いていれば閉じる', () => {
    const opened = toggleExpanded(new Set(), 'src')

    expect([...opened]).toEqual(['src'])
    expect([...toggleExpanded(opened, 'src')]).toEqual([])
  })

  it('畳んでも子の展開状態は残す（開き直すと元の形に戻る）', () => {
    const expanded: ReadonlySet<string> = new Set(['', 'src', 'src/main'])
    const collapsed = toggleExpanded(expanded, 'src')

    expect(collapsed.has('src/main')).toBe(true)
    expect([...toggleExpanded(collapsed, 'src')].sort()).toEqual(['', 'src', 'src/main'])
  })

  it('元の集合を書き換えない', () => {
    const expanded: ReadonlySet<string> = new Set([''])

    toggleExpanded(expanded, 'src')

    expect([...expanded]).toEqual([''])
  })
})

describe('ancestorRelativePaths', () => {
  /* 検索結果の場所をツリーの中で見せるために、開いておくフォルダ（Session 3-6-4）。 */
  it('root から順に、対象を含むフォルダを返す', () => {
    // 対象を直接含むフォルダ（src/main/files）まで。ここを開かないと行が現れない。
    expect(ancestorRelativePaths('src/main/files/index.ts')).toEqual([
      '',
      'src',
      'src/main',
      'src/main/files'
    ])
  })

  it('Workspace 直下のものは root だけ', () => {
    expect(ancestorRelativePaths('README.md')).toEqual([''])
  })

  /* 対象そのものは含めない（フォルダを選んでも中までは開かない）。 */
  it('フォルダを渡してもそれ自身は含めない', () => {
    expect(ancestorRelativePaths('src/main')).toEqual(['', 'src'])
  })

  it('root 自身は root だけ', () => {
    expect(ancestorRelativePaths('')).toEqual([''])
  })
})
