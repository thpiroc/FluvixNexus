import { describe, expect, it } from 'vitest'
import {
  GIT_REMOTE_URL_MAX_LENGTH,
  findGitRemoteUrlProblem,
  normalizeGitRemoteUrl,
  prepareGitRemoteUrl
} from './remoteUrl'

/**
 * remote の URL の規則（Session 3-8-16）。
 *
 * ## ここは、Git 機能でいちばん危ない値の入口になる
 *
 * `git remote add evil "ext::sh -c whoami"` は今の git（2.54 で確かめた）が
 * **そのまま受け取る** ── 追加した時点では何も起きず、以降の fetch / push で
 * その文字列がシェルとして走る。したがってこのファイルが固定したいのは
 * 「通る形が3つだけであること」で、**知らない形が通らないこと**が
 * 個々の危険な例を弾くことより効く（shared/git/remoteUrl.ts）。
 */
describe('findGitRemoteUrlProblem', () => {
  it('https の URL を通す', () => {
    expect(findGitRemoteUrlProblem('https://github.com/octocat/Hello-World.git')).toBeNull()
    expect(findGitRemoteUrlProblem('https://github.com/octocat/Hello-World')).toBeNull()
    expect(findGitRemoteUrlProblem('https://git.example.co.jp:8443/team/repo.git')).toBeNull()
    expect(findGitRemoteUrlProblem('https://localhost/repo.git')).toBeNull()
  })

  it('ssh の URL を通す（利用者名は認証情報ではない）', () => {
    expect(findGitRemoteUrlProblem('ssh://git@github.com/octocat/Hello-World.git')).toBeNull()
    expect(findGitRemoteUrlProblem('ssh://git@github.com:2222/octocat/repo.git')).toBeNull()
    expect(findGitRemoteUrlProblem('ssh://example.com/srv/git/repo.git')).toBeNull()
  })

  it('scp 形式（user@host:path）を通す', () => {
    expect(findGitRemoteUrlProblem('git@github.com:octocat/Hello-World.git')).toBeNull()
    expect(findGitRemoteUrlProblem('my-user@git.example.com:team/repo.git')).toBeNull()
  })

  it('大文字の scheme も通す（git 自身が受け取る形）', () => {
    expect(findGitRemoteUrlProblem('HTTPS://github.com/o/r.git')).toBeNull()
  })

  /*
    このテストがこのファイルの中心になる。`ext::` は実在する RCE の経路で、
    git はそれを受け取る（実物で確かめてある）。
  */
  it('ext:: を断る（時間差で任意のコマンドが走る形）', () => {
    expect(findGitRemoteUrlProblem('ext::sh -c whoami')).not.toBeNull()
    expect(findGitRemoteUrlProblem('ext::sh')).toBe('unsupported-scheme')
  })

  it('通す3つ以外の scheme を、個別に知らなくても断る', () => {
    expect(findGitRemoteUrlProblem('git://github.com/o/r.git')).toBe('unsupported-scheme')
    expect(findGitRemoteUrlProblem('http://github.com/o/r.git')).toBe('unsupported-scheme')
    expect(findGitRemoteUrlProblem('file:///srv/git/repo.git')).toBe('unsupported-scheme')
    expect(findGitRemoteUrlProblem('ftp://example.com/repo.git')).toBe('unsupported-scheme')
    expect(findGitRemoteUrlProblem('javascript://x/y')).toBe('unsupported-scheme')
  })

  it('ローカルのパスを断る（危なくはないが、通す形ではない）', () => {
    expect(findGitRemoteUrlProblem('../bare')).toBe('unsupported-scheme')
    expect(findGitRemoteUrlProblem('/srv/git/repo.git')).toBe('unsupported-scheme')
    expect(findGitRemoteUrlProblem('C:/repos/bare')).toBe('unsupported-scheme')
    expect(findGitRemoteUrlProblem('C:\\repos\\bare')).toBe('unsupported-scheme')
  })

  /*
    通すと、アプリが利用者の token を `.git/config` へ平文で書くことになる
    （設計判断 7）。`credentials` を別の分類にしてあるのは、次の一手が
    「打ち直す」ではなく「認証の部分を消す」だから。
  */
  it('URL に認証情報が入っていたら credentials として断る', () => {
    expect(findGitRemoteUrlProblem('https://token@github.com/o/r.git')).toBe('credentials')
    expect(findGitRemoteUrlProblem('https://user:pass@github.com/o/r.git')).toBe('credentials')
    expect(findGitRemoteUrlProblem('ssh://git:secret@github.com/o/r.git')).toBe('credentials')
  })

  it('ホストか path が足りない URL を断る', () => {
    expect(findGitRemoteUrlProblem('https://github.com')).toBe('invalid-shape')
    expect(findGitRemoteUrlProblem('https://github.com/')).toBe('invalid-shape')
    expect(findGitRemoteUrlProblem('https:///o/r.git')).toBe('invalid-shape')
    expect(findGitRemoteUrlProblem('git@github.com:')).toBe('invalid-shape')
    expect(findGitRemoteUrlProblem('https://git hub.com/o/r')).toBe('invalid-characters')
  })

  it('port の形が違う URL を断る', () => {
    expect(findGitRemoteUrlProblem('https://github.com:port/o/r.git')).toBe('invalid-shape')
    expect(findGitRemoteUrlProblem('ssh://git@github.com:22x/o/r.git')).toBe('invalid-shape')
  })

  it('空・長すぎ・空白や制御文字を断る', () => {
    expect(findGitRemoteUrlProblem('')).toBe('empty')
    expect(
      findGitRemoteUrlProblem(`https://x.example/${'a'.repeat(GIT_REMOTE_URL_MAX_LENGTH)}`)
    ).toBe('too-long')
    expect(findGitRemoteUrlProblem('https://github.com/o/ r.git')).toBe('invalid-characters')
    expect(findGitRemoteUrlProblem('https://github.com/o/r.git\u0000')).toBe('invalid-characters')
  })

  /*
    `--end-of-options` を置いてあっても、先頭の `-` は形の側でも弾く
    （pathspec に `--` と `--literal-pathspecs` を両方掛けているのと同じ構え）。
  */
  it('先頭が `-` の値を断る', () => {
    expect(findGitRemoteUrlProblem('--upload-pack=sh')).toBe('unsupported-scheme')
    expect(findGitRemoteUrlProblem('--config=x')).toBe('unsupported-scheme')
  })
})

describe('prepareGitRemoteUrl', () => {
  it('前後の空白だけを落とす（貼り付けた末尾の改行が普通に付いてくる）', () => {
    expect(prepareGitRemoteUrl('  https://github.com/o/r.git\n')).toBe('https://github.com/o/r.git')
  })

  it('中身は1文字も変えない（`.git` を足さない・http を直さない）', () => {
    expect(prepareGitRemoteUrl('http://github.com/o/r')).toBe('http://github.com/o/r')
  })
})

describe('normalizeGitRemoteUrl', () => {
  it('通る URL は整えた形で返す', () => {
    expect(normalizeGitRemoteUrl(' https://github.com/o/r.git ')).toBe('https://github.com/o/r.git')
  })

  it('通らない URL は null', () => {
    expect(normalizeGitRemoteUrl('ext::sh -c whoami')).toBeNull()
    expect(normalizeGitRemoteUrl('git://github.com/o/r.git')).toBeNull()
    expect(normalizeGitRemoteUrl('https://token@github.com/o/r.git')).toBeNull()
  })

  it('文字列でない値は null', () => {
    expect(normalizeGitRemoteUrl(undefined)).toBeNull()
    expect(normalizeGitRemoteUrl(null)).toBeNull()
    expect(normalizeGitRemoteUrl(42)).toBeNull()
    expect(normalizeGitRemoteUrl({ url: 'https://github.com/o/r.git' })).toBeNull()
  })
})
