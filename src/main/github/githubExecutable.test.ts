import { describe, expect, it } from 'vitest'
import { resolveGitHubCliExecutable } from './githubExecutable'

/**
 * GitHub CLI の解決（githubExecutable.ts）。
 *
 * 確かめたいのは gitExecutable.test.ts とまったく同じ2つになる。
 *   - **開いたフォルダの中身が、起動される gh に影響しない**こと
 *   - winget / MSI で入れた直後（PATH がまだ届いていない）でも見つかること
 */

function existsIn(paths: readonly string[]): (candidate: string) => boolean {
  const known = new Set(paths.map((path) => path.toLowerCase()))

  return (candidate) => known.has(candidate.toLowerCase())
}

describe('resolveGitHubCliExecutable', () => {
  it('PATH から絶対パスで解決する', () => {
    const found = resolveGitHubCliExecutable(
      'win32',
      { PATH: 'C:\\Program Files\\GitHub CLI' },
      existsIn(['C:\\Program Files\\GitHub CLI\\gh.exe'])
    )

    expect(found).toBe('C:\\Program Files\\GitHub CLI\\gh.exe')
  })

  /*
    この関数が守っている性質そのもの。名前だけを execFile へ渡すと、
    Windows では作業ディレクトリ（＝利用者が開いた Workspace）が先に見られる。
  */
  it('名前だけに落とさない', () => {
    const found = resolveGitHubCliExecutable(
      'win32',
      { PATH: 'C:\\Program Files\\GitHub CLI' },
      existsIn(['C:\\Program Files\\GitHub CLI\\gh.exe'])
    )

    expect(found).not.toBe('gh.exe')
    expect(found?.includes('\\')).toBe(true)
  })

  it('PATH の相対の項目にある gh は使わない', () => {
    const found = resolveGitHubCliExecutable(
      'win32',
      { PATH: '.;bin' },
      existsIn(['.\\gh.exe', 'bin\\gh.exe'])
    )

    expect(found).toBeNull()
  })

  /*
    winget で入れた直後、既に開いているプロセスの PATH には反映されない。
    そこで諦めると「入れたのに使えない」がアプリを開き直すまで続く。
  */
  it('PATH に無くても既定のインストール先から見つける', () => {
    const found = resolveGitHubCliExecutable(
      'win32',
      { PATH: 'C:\\Windows\\System32', ProgramFiles: 'C:\\Program Files' },
      existsIn(['C:\\Program Files\\GitHub CLI\\gh.exe'])
    )

    expect(found).toBe('C:\\Program Files\\GitHub CLI\\gh.exe')
  })

  it('ユーザー単位のインストールも当たる', () => {
    const found = resolveGitHubCliExecutable(
      'win32',
      { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' },
      existsIn(['C:\\Users\\u\\AppData\\Local\\Programs\\GitHub CLI\\gh.exe'])
    )

    expect(found).toBe('C:\\Users\\u\\AppData\\Local\\Programs\\GitHub CLI\\gh.exe')
  })

  it('見つからなければ null（落ちる理由にしない）', () => {
    const found = resolveGitHubCliExecutable('win32', { PATH: 'C:\\Windows' }, existsIn([]))

    expect(found).toBeNull()
  })

  it('Windows 以外では PATH だけを見る', () => {
    expect(
      resolveGitHubCliExecutable('linux', { PATH: '/usr/bin' }, existsIn(['/usr/bin/gh']))
    ).toBe('/usr/bin/gh')

    expect(
      resolveGitHubCliExecutable(
        'linux',
        { ProgramFiles: '/opt' },
        existsIn(['/opt/GitHub CLI/gh'])
      )
    ).toBeNull()
  })
})
