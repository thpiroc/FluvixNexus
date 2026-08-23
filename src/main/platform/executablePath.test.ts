import { describe, expect, it } from 'vitest'
import {
  findExecutableOnPath,
  findInDirectory,
  isAbsoluteExecutablePath,
  trimTrailingSeparator
} from './executablePath'

/**
 * PATH の辿り方（executablePath.ts）。
 *
 * ここで確かめたいのは、**作業ディレクトリの中身が起動されるものに影響しない**
 * という一点にある。Terminal（Node / Claude Code）と Git（`git` 本体）が
 * 同じ規則を共有しているため、ここが崩れると両方が同時に崩れる。
 */

/** その並びに在るものだけが実在する、という前提を作る。 */
function existsIn(paths: readonly string[]): (candidate: string) => boolean {
  const known = new Set(paths.map((path) => path.toLowerCase()))

  return (candidate) => known.has(candidate.toLowerCase())
}

describe('findExecutableOnPath', () => {
  it('PATH の項目から絶対パスを組み立てて返す', () => {
    const found = findExecutableOnPath(
      ['git.exe'],
      'win32',
      { PATH: 'C:\\Program Files\\Git\\cmd' },
      existsIn(['C:\\Program Files\\Git\\cmd\\git.exe'])
    )

    expect(found).toBe('C:\\Program Files\\Git\\cmd\\git.exe')
  })

  /*
    この規則が守っている性質そのもの。`.` を拾うと、開いたフォルダの中に
    置かれた git.exe が起動されうる。
  */
  it('相対的に解決される項目は使わない', () => {
    const found = findExecutableOnPath(
      ['git.exe'],
      'win32',
      { PATH: '.;bin;..\\tools;C:git' },
      // 「相対の項目を拾えば見つかってしまう」場所に実体を置く。
      existsIn(['.\\git.exe', 'bin\\git.exe', '..\\tools\\git.exe', 'C:git\\git.exe'])
    )

    expect(found).toBeNull()
  })

  it('PATH の前にある項目が勝つ', () => {
    const found = findExecutableOnPath(
      ['git.exe'],
      'win32',
      { PATH: 'C:\\first;C:\\second' },
      existsIn(['C:\\first\\git.exe', 'C:\\second\\git.exe'])
    )

    expect(found).toBe('C:\\first\\git.exe')
  })

  it('名前の候補は渡された順に試す', () => {
    const found = findExecutableOnPath(
      ['claude.exe', 'claude.cmd'],
      'win32',
      { PATH: 'C:\\tools' },
      existsIn(['C:\\tools\\claude.exe', 'C:\\tools\\claude.cmd'])
    )

    expect(found).toBe('C:\\tools\\claude.exe')
  })

  it('引用符付きの項目も扱える', () => {
    const found = findExecutableOnPath(
      ['git.exe'],
      'win32',
      { PATH: '"C:\\Program Files\\Git\\cmd"' },
      existsIn(['C:\\Program Files\\Git\\cmd\\git.exe'])
    )

    expect(found).toBe('C:\\Program Files\\Git\\cmd\\git.exe')
  })

  it('末尾の区切りが重ならない', () => {
    const found = findExecutableOnPath(
      ['git.exe'],
      'win32',
      { PATH: 'C:\\tools\\' },
      existsIn(['C:\\tools\\git.exe'])
    )

    expect(found).toBe('C:\\tools\\git.exe')
  })

  it('ドライブ直下でも組み立てられる', () => {
    const found = findExecutableOnPath(
      ['git.exe'],
      'win32',
      { PATH: 'C:\\' },
      existsIn(['C:\\git.exe'])
    )

    expect(found).toBe('C:\\git.exe')
  })

  it('UNC の項目も絶対として扱う', () => {
    const found = findExecutableOnPath(
      ['git.exe'],
      'win32',
      { PATH: '\\\\server\\share\\tools' },
      existsIn(['\\\\server\\share\\tools\\git.exe'])
    )

    expect(found).toBe('\\\\server\\share\\tools\\git.exe')
  })

  it('綴りが Path / path でも読める', () => {
    const exists = existsIn(['C:\\tools\\git.exe'])

    expect(findExecutableOnPath(['git.exe'], 'win32', { Path: 'C:\\tools' }, exists)).toBe(
      'C:\\tools\\git.exe'
    )
    expect(findExecutableOnPath(['git.exe'], 'win32', { path: 'C:\\tools' }, exists)).toBe(
      'C:\\tools\\git.exe'
    )
  })

  it('PATH が無い / 空なら null', () => {
    const exists = existsIn(['C:\\tools\\git.exe'])

    expect(findExecutableOnPath(['git.exe'], 'win32', {}, exists)).toBeNull()
    expect(findExecutableOnPath(['git.exe'], 'win32', { PATH: '' }, exists)).toBeNull()
  })

  it('Windows 以外では区切りと組み立てが変わる', () => {
    const found = findExecutableOnPath(
      ['git'],
      'darwin',
      { PATH: '/usr/bin:/usr/local/bin' },
      existsIn(['/usr/local/bin/git'])
    )

    expect(found).toBe('/usr/local/bin/git')
  })
})

describe('findInDirectory', () => {
  it('決まったフォルダの中から探す', () => {
    const found = findInDirectory(
      'C:\\Program Files\\Git\\cmd',
      ['git.exe'],
      'win32',
      existsIn(['C:\\Program Files\\Git\\cmd\\git.exe'])
    )

    expect(found).toBe('C:\\Program Files\\Git\\cmd\\git.exe')
  })

  /*
    環境変数の中身は利用者が書き換えられる。相対のフォルダを受け付けると、
    そこから cwd 起点の解決が復活する。
  */
  it('相対のフォルダは受け付けない', () => {
    const found = findInDirectory(
      'tools\\Git\\cmd',
      ['git.exe'],
      'win32',
      existsIn(['tools\\Git\\cmd\\git.exe'])
    )

    expect(found).toBeNull()
  })

  it('無ければ null', () => {
    expect(findInDirectory('C:\\nowhere', ['git.exe'], 'win32', existsIn([]))).toBeNull()
  })
})

describe('isAbsoluteExecutablePath', () => {
  it('ドライブ付きと UNC だけを絶対と見なす', () => {
    expect(isAbsoluteExecutablePath('C:\\tools', 'win32')).toBe(true)
    expect(isAbsoluteExecutablePath('C:/tools', 'win32')).toBe(true)
    expect(isAbsoluteExecutablePath('\\\\server\\share', 'win32')).toBe(true)
  })

  it('ドライブ相対は絶対ではない', () => {
    // `C:tools` は cwd の影響を受ける（ドライブごとのカレントディレクトリ起点）。
    expect(isAbsoluteExecutablePath('C:tools', 'win32')).toBe(false)
    expect(isAbsoluteExecutablePath('.', 'win32')).toBe(false)
    expect(isAbsoluteExecutablePath('bin', 'win32')).toBe(false)
    expect(isAbsoluteExecutablePath('', 'win32')).toBe(false)
  })

  it('Windows 以外では / 始まりだけ', () => {
    expect(isAbsoluteExecutablePath('/usr/bin', 'darwin')).toBe(true)
    expect(isAbsoluteExecutablePath('usr/bin', 'darwin')).toBe(false)
    expect(isAbsoluteExecutablePath('C:\\tools', 'darwin')).toBe(false)
  })
})

describe('trimTrailingSeparator', () => {
  it('末尾の区切りだけを落とす', () => {
    expect(trimTrailingSeparator('C:\\tools\\')).toBe('C:\\tools')
    expect(trimTrailingSeparator('C:\\tools//')).toBe('C:\\tools')
    expect(trimTrailingSeparator('C:\\tools')).toBe('C:\\tools')
    expect(trimTrailingSeparator('/usr/bin/')).toBe('/usr/bin')
  })
})
