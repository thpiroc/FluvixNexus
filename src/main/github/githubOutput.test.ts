import { describe, expect, it } from 'vitest'
import { readCreatedRepositoryUrl } from './githubOutput'

/**
 * `gh repo create` の出力の読み取り（githubOutput.ts）。
 *
 * ここで読んだ文字列は、そのまま `git remote add origin <url>` の引数になる
 * （main/git/gitCommands.ts）── したがって確かめたいのは2つになる。
 *
 *   - gh の**どの版の出力からも**読めること
 *   - **https の URL 以外は返さない**こと（引数の位置へ通すもの）
 */

describe('readCreatedRepositoryUrl', () => {
  /*
    出力先が端末でないとき（アプリから呼ぶときはこちら）の形。
  */
  it('URL だけの1行を読む', () => {
    expect(readCreatedRepositoryUrl('https://github.com/octocat/nexus\n')).toBe(
      'https://github.com/octocat/nexus'
    )
  })

  /*
    版によっては要約の行が付き、URL は字下げされて2行目に来る。
  */
  it('要約の行が付いていても読む', () => {
    const stdout =
      '✓ Created repository octocat/nexus on GitHub\n  https://github.com/octocat/nexus\n'

    expect(readCreatedRepositoryUrl(stdout)).toBe('https://github.com/octocat/nexus')
  })

  it('先に現れた URL を採る', () => {
    const stdout = 'https://github.com/octocat/a\nhttps://github.com/octocat/b\n'

    expect(readCreatedRepositoryUrl(stdout)).toBe('https://github.com/octocat/a')
  })

  it('日本語や記号を含む名前でも、URL の形なら読む', () => {
    expect(readCreatedRepositoryUrl('https://github.com/octocat/my-repo_1.0\n')).toBe(
      'https://github.com/octocat/my-repo_1.0'
    )
  })

  /*
    ここが「引数の位置へ通してよい形」を決めているところにあたる。
  */
  it('https 以外は返さない', () => {
    expect(readCreatedRepositoryUrl('git@github.com:octocat/nexus.git\n')).toBeNull()
    expect(readCreatedRepositoryUrl('http://github.com/octocat/nexus\n')).toBeNull()
    expect(readCreatedRepositoryUrl('ssh://git@github.com/octocat/nexus\n')).toBeNull()
    expect(readCreatedRepositoryUrl('--upload-pack=x\n')).toBeNull()
    expect(readCreatedRepositoryUrl('')).toBeNull()
  })

  it('URL に見えない文字が混ざったものは採らない', () => {
    expect(readCreatedRepositoryUrl('https://github.com/oct"cat/nexus\n')).toBeNull()
  })
})
