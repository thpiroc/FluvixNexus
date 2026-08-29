import { describe, expect, it } from 'vitest'
import { GIT_REMOTE_LABEL_MAX_LENGTH, describeGitRemoteUrl } from './gitRemoteLabel'

/**
 * remote の URL → 表示用のラベル（Session 3-8-16）。
 *
 * ## ここで固定したいのは「戻せないこと」
 *
 * Renderer が受け取るのはラベルだけで、そこから URL を組み立て直せない ──
 * それがこのセッションの設計の中心にあたる（shared/git/remote.ts）。
 * したがってテストが確かめるのは、**何が出るか**と同じだけ
 * **何が落ちているか**になる。
 *
 *   scheme       … 落ちる
 *   認証情報     … 落ちる（画面にもログにも出さない）
 *   port         … 落ちる
 *   末尾の `.git` … 落ちる
 *
 * ## 相手はアプリが追加したものだけではない
 *
 * `shared/git/remoteUrl.ts` が通す形は3つだけだが、リポジトリには
 * 端末から追加されたものが在りうる ── 読めない形でも**空欄にしない**
 * ことを、ここで固定する（空の行は「読み込みに失敗した行」と
 * 見分けが付かない）。
 */
describe('describeGitRemoteUrl', () => {
  it('https の URL から scheme と `.git` を落とす', () => {
    expect(describeGitRemoteUrl('https://github.com/octocat/Hello-World.git')).toBe(
      'github.com/octocat/Hello-World'
    )
    expect(describeGitRemoteUrl('https://github.com/octocat/Hello-World')).toBe(
      'github.com/octocat/Hello-World'
    )
  })

  it('scp 形式からも同じラベルを作る（同じ場所なら同じ見え方になる）', () => {
    expect(describeGitRemoteUrl('git@github.com:octocat/Hello-World.git')).toBe(
      'github.com/octocat/Hello-World'
    )
    expect(describeGitRemoteUrl('ssh://git@github.com/octocat/Hello-World.git')).toBe(
      'github.com/octocat/Hello-World'
    )
  })

  it('port を落とす', () => {
    expect(describeGitRemoteUrl('ssh://git@example.com:2222/team/repo.git')).toBe(
      'example.com/team/repo'
    )
    expect(describeGitRemoteUrl('https://git.example.co.jp:8443/team/repo.git')).toBe(
      'git.example.co.jp/team/repo'
    )
  })

  /*
    アプリからは追加できない形（`credentials`）だが、端末から追加された
    ものが一覧に並ぶことはある ── **画面にもログにも出さない。**
  */
  it('認証情報を落とす（端末から追加されたものが並びうる）', () => {
    expect(describeGitRemoteUrl('https://ghp_secrettoken@github.com/o/r.git')).toBe(
      'github.com/o/r'
    )
    expect(describeGitRemoteUrl('https://user:password@github.com/o/r.git')).toBe('github.com/o/r')
  })

  it('path が無ければホストだけを出す', () => {
    expect(describeGitRemoteUrl('https://github.com')).toBe('github.com')
    expect(describeGitRemoteUrl('https://github.com/')).toBe('github.com')
  })

  it('先頭の `/` と `~/` が二重にならない', () => {
    expect(describeGitRemoteUrl('ssh://git@example.com//srv/git/repo.git')).toBe(
      'example.com/srv/git/repo'
    )
    expect(describeGitRemoteUrl('git@example.com:~user/repo.git')).toBe('example.com/~user/repo')
  })

  /*
    §9.2 の線そのもの ── 場所は Renderer へ渡さない。
  */
  it('ローカルのパスは、場所を出さずに「ローカルのパス」と言う', () => {
    expect(describeGitRemoteUrl('../bare')).toBe('ローカルのパス')
    expect(describeGitRemoteUrl('C:/repos/bare')).toBe('ローカルのパス')
    expect(describeGitRemoteUrl('C:\\repos\\bare')).toBe('ローカルのパス')
    expect(describeGitRemoteUrl('/srv/git/repo.git')).toBe('ローカルのパス')
  })

  /*
    `ext::sh -c whoami` は path ではなく**コマンド行**にあたる ──
    「ローカルのパス」と出すと嘘になる。
  */
  it('読めない形は「不明な形式」と言う（ext:: を path として扱わない）', () => {
    expect(describeGitRemoteUrl('ext::sh -c whoami')).toBe('不明な形式')
    expect(describeGitRemoteUrl('ext::sh')).toBe('不明な形式')
    expect(describeGitRemoteUrl('')).toBe('不明な形式')
    expect(describeGitRemoteUrl('   ')).toBe('不明な形式')
  })

  it('`.git` だけの path を空にしない', () => {
    expect(describeGitRemoteUrl('https://example.com/.git')).toBe('example.com/.git')
  })

  it('scheme が何であってもホストと path を出す（一覧から消さない）', () => {
    expect(describeGitRemoteUrl('git://github.com/o/r.git')).toBe('github.com/o/r')
    expect(describeGitRemoteUrl('http://example.com/o/r.git')).toBe('example.com/o/r')
  })

  it('長すぎるラベルは末尾を省く（先頭のホストは残る）', () => {
    const label = describeGitRemoteUrl(`https://example.com/${'a'.repeat(500)}`)

    expect(label.length).toBe(GIT_REMOTE_LABEL_MAX_LENGTH)
    expect(label.startsWith('example.com/')).toBe(true)
    expect(label.endsWith('…')).toBe(true)
  })

  it('ラベルから URL は組み立て直せない（scheme が1つも残らない）', () => {
    const urls = [
      'https://github.com/o/r.git',
      'ssh://git@github.com:2222/o/r.git',
      'git@github.com:o/r.git',
      'https://token@github.com/o/r.git'
    ]

    for (const url of urls) {
      const label = describeGitRemoteUrl(url)

      expect(label).not.toContain('://')
      expect(label).not.toContain('@')
      expect(label).not.toContain('token')
    }
  })
})
