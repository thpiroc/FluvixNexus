import { describe, expect, it } from 'vitest'
import { classifyGitHubCreateFailure } from './githubFailure'

/**
 * gh の失敗の分類（Session 3-8-10）。
 *
 * 文言は**実際に gh が出すもの**を写してある。ここが当てにできるのは
 * `LC_ALL=C` を渡しているためで（githubEnvironment.ts）、その2つは対になっている。
 *
 * main/git/gitFailure.test.ts と同じ基準で、確かめているのは
 * 「次の一手が変わる分類に落ちるか」だけになる。
 */

describe('classifyGitHubCreateFailure', () => {
  it('同じ名前が既にあるときは github-repository-exists', () => {
    const stderr = 'GraphQL: Name already exists on this account (createRepository)\n'

    expect(classifyGitHubCreateFailure(stderr)).toBe('github-repository-exists')
  })

  it('ログインしていないときは github-signed-out', () => {
    for (const stderr of [
      'To get started with GitHub CLI, please run:  gh auth login\n',
      'error: not logged in to any hosts\n',
      'HTTP 401: Bad credentials (https://api.github.com/graphql)\n',
      'GraphQL: Resource not accessible by integration. requires authentication\n'
    ]) {
      expect(classifyGitHubCreateFailure(stderr), stderr).toBe('github-signed-out')
    }
  })

  it('相手へ届かないときは network-unavailable', () => {
    for (const stderr of [
      'Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host\n',
      'Post "https://api.github.com/graphql": net/http: TLS handshake timeout\n',
      'Get "https://api.github.com": proxyconnect tcp: connection refused\n',
      'x509: certificate signed by unknown authority\n'
    ]) {
      expect(classifyGitHubCreateFailure(stderr), stderr).toBe('network-unavailable')
    }
  })

  /*
    知らない文章を近そうな分類へ寄せない（当てにいって外すより、
    分からないままの方がよい。main/git/gitFailure.ts）。
  */
  it('知らない文章は unknown', () => {
    expect(classifyGitHubCreateFailure('')).toBe('unknown')
    expect(classifyGitHubCreateFailure('something went wrong\n')).toBe('unknown')
    expect(classifyGitHubCreateFailure('HTTP 403: Forbidden\n')).toBe('unknown')
  })

  /*
    「既にある」を先に見る ── 認証の説明の中に `already exists` が現れることは
    無いのに対し、逆は起こりうる（どちらの語も含む文章では、確かな方を採る）。
  */
  it('複数の言い回しが混ざったら、確かな方を先に採る', () => {
    const stderr = 'Name already exists on this account. Try `gh auth login` for another account.\n'

    expect(classifyGitHubCreateFailure(stderr)).toBe('github-repository-exists')
  })
})
