import { describe, expect, it } from 'vitest'
import { resolveGitExecutable } from './gitExecutable'

/**
 * `git` 本体の解決（gitExecutable.ts）。
 *
 * 確かめたいのは2つ。
 *   - **開いたフォルダの中身が、起動される git に影響しない**こと
 *   - PATH に入れずにインストールされた Git for Windows でも見つかること
 */

function existsIn(paths: readonly string[]): (candidate: string) => boolean {
  const known = new Set(paths.map((path) => path.toLowerCase()))

  return (candidate) => known.has(candidate.toLowerCase())
}

describe('resolveGitExecutable', () => {
  it('PATH から絶対パスで解決する', () => {
    const found = resolveGitExecutable(
      'win32',
      { PATH: 'C:\\Program Files\\Git\\cmd' },
      existsIn(['C:\\Program Files\\Git\\cmd\\git.exe'])
    )

    expect(found).toBe('C:\\Program Files\\Git\\cmd\\git.exe')
  })

  /*
    この関数が守っている性質そのもの。名前だけを execFile へ渡すと、
    Windows では作業ディレクトリ（＝利用者が開いた Workspace）が先に見られる。
  */
  it('名前だけに落とさない', () => {
    const found = resolveGitExecutable(
      'win32',
      { PATH: 'C:\\Program Files\\Git\\cmd' },
      existsIn(['C:\\Program Files\\Git\\cmd\\git.exe'])
    )

    expect(found).not.toBe('git.exe')
    expect(found?.includes('\\')).toBe(true)
  })

  it('PATH の相対の項目にある git は使わない', () => {
    const found = resolveGitExecutable(
      'win32',
      { PATH: '.;bin' },
      existsIn(['.\\git.exe', 'bin\\git.exe'])
    )

    expect(found).toBeNull()
  })

  /*
    Git for Windows のインストーラには「Git Bash からのみ使う」という選択肢があり、
    それを選ぶと PATH には入らない。
  */
  it('PATH に無くても既定のインストール先から見つける', () => {
    const found = resolveGitExecutable(
      'win32',
      { PATH: 'C:\\Windows\\System32', ProgramFiles: 'C:\\Program Files' },
      existsIn(['C:\\Program Files\\Git\\cmd\\git.exe'])
    )

    expect(found).toBe('C:\\Program Files\\Git\\cmd\\git.exe')
  })

  it('ユーザー単位のインストールも見る', () => {
    const found = resolveGitExecutable(
      'win32',
      { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      existsIn(['C:\\Users\\me\\AppData\\Local\\Programs\\Git\\cmd\\git.exe'])
    )

    expect(found).toBe('C:\\Users\\me\\AppData\\Local\\Programs\\Git\\cmd\\git.exe')
  })

  it('PATH にあれば既定のインストール先より優先する', () => {
    const found = resolveGitExecutable(
      'win32',
      { PATH: 'C:\\tools', ProgramFiles: 'C:\\Program Files' },
      existsIn(['C:\\tools\\git.exe', 'C:\\Program Files\\Git\\cmd\\git.exe'])
    )

    expect(found).toBe('C:\\tools\\git.exe')
  })

  it('環境変数の末尾に区切りがあっても組み立てられる', () => {
    const found = resolveGitExecutable(
      'win32',
      { ProgramFiles: 'C:\\Program Files\\' },
      existsIn(['C:\\Program Files\\Git\\cmd\\git.exe'])
    )

    expect(found).toBe('C:\\Program Files\\Git\\cmd\\git.exe')
  })

  /*
    環境変数の中身は利用者が書き換えられる。相対のフォルダを当てにすると、
    そこから cwd 起点の解決が復活する。
  */
  it('環境変数が相対のフォルダを指していても使わない', () => {
    const found = resolveGitExecutable(
      'win32',
      { ProgramFiles: 'tools' },
      existsIn(['tools\\Git\\cmd\\git.exe'])
    )

    expect(found).toBeNull()
  })

  it('見つからなければ null（落ちる理由にしない）', () => {
    expect(resolveGitExecutable('win32', { PATH: 'C:\\Windows' }, existsIn([]))).toBeNull()
    expect(resolveGitExecutable('win32', {}, existsIn([]))).toBeNull()
  })

  it('Windows 以外では PATH だけを見る', () => {
    const exists = existsIn(['/usr/bin/git'])

    expect(resolveGitExecutable('darwin', { PATH: '/usr/bin' }, exists)).toBe('/usr/bin/git')
    // 既定のインストール先という考え方が無い OS なので、当てにいく場所を持たない。
    expect(resolveGitExecutable('darwin', { ProgramFiles: 'C:\\Program Files' }, exists)).toBeNull()
  })
})
