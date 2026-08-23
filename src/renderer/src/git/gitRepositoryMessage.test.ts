import { describe, expect, it } from 'vitest'
import type { GitFailureReason, GitRepositoryState } from '@shared/git'
import { describeGitHead, describeGitRepositoryNotice } from './gitRepositoryMessage'

/**
 * Git パネルの文言（gitRepositoryMessage.ts）。
 *
 * 確かめたいのは言い回しではなく、**どの状態でも「次に何をすればよいか」が
 * 書かれている**ことにある。Git パネルが出す案内はほとんどが利用者に直せる
 * 状態を指しており、理由だけを出して終わると「壊れている」と区別が付かない。
 */

const FAILURE_REASONS: readonly GitFailureReason[] = [
  'no-work-tree',
  'dubious-ownership',
  'permission-denied',
  'timeout',
  'unreadable-output',
  'unknown'
]

describe('describeGitRepositoryNotice', () => {
  it('使える状態では案内を出さない', () => {
    const state: GitRepositoryState = {
      status: 'ready',
      head: { kind: 'branch', name: 'main' },
      changes: { staged: [], unstaged: [], untracked: [], conflicted: [] },
      upstream: null
    }

    expect(describeGitRepositoryNotice(state)).toBeNull()
  })

  it('Workspace 未選択では調べ直しても変わらないため再取得を出さない', () => {
    const notice = describeGitRepositoryNotice({ status: 'no-workspace' })

    expect(notice?.retryable).toBe(false)
  })

  it('Git が無い場合は入れ直せば変わるため再取得を出す', () => {
    const notice = describeGitRepositoryNotice({ status: 'git-unavailable' })

    expect(notice?.retryable).toBe(true)
    expect(notice?.description).not.toBeNull()
  })

  /*
    Session 3-8-1 では `git init` を実行しない（設計判断 1）。
    ボタンを出さない代わりに、どうすれば始められるかを書く。
  */
  it('未初期化では初期化の方法を案内する', () => {
    const notice = describeGitRepositoryNotice({ status: 'not-a-repository' })

    expect(notice?.description).toContain('git init')
  })

  it('サブフォルダを開いている場合はリポジトリ名を出す', () => {
    const notice = describeGitRepositoryNotice({
      status: 'nested',
      repositoryName: 'Fluvix Nexus'
    })

    expect(notice?.title).toContain('Fluvix Nexus')
    // 開き直せば使えるようになる、という次の一手が要る。
    expect(notice?.description).toContain('開き直')
  })

  it('どの失敗にも次の一手が書かれている', () => {
    for (const reason of FAILURE_REASONS) {
      const notice = describeGitRepositoryNotice({ status: 'failed', reason })

      expect(notice, reason).not.toBeNull()
      expect(notice?.title.length, reason).toBeGreaterThan(0)
      expect(notice?.description, reason).not.toBeNull()
      expect(notice?.retryable, reason).toBe(true)
    }
  })

  it('所有者の問題は直し方まで案内する', () => {
    const notice = describeGitRepositoryNotice({ status: 'failed', reason: 'dubious-ownership' })

    expect(notice?.description).toContain('safe.directory')
  })

  /*
    Main の生の stderr は届かない（設計判断 3）。届いていないことを
    文言の側からも確かめておく ── 分類に無い情報は出しようがない。
  */
  it('分からない失敗でも英語の詳細を出さない', () => {
    const notice = describeGitRepositoryNotice({ status: 'failed', reason: 'unknown' })

    expect(notice?.description).toContain('ログ')
    expect(notice?.description).not.toContain('fatal')
  })
})

describe('describeGitHead', () => {
  it('ブランチ名をそのまま出す', () => {
    expect(describeGitHead({ kind: 'branch', name: 'feature/git' })).toBe('feature/git')
  })

  /*
    detached を「ブランチ名の欄に commit を出す」形にしない。
    利用者が次に取る行動が違うため（shared/git/repository.ts）。
  */
  it('detached HEAD はブランチ名として出さない', () => {
    const label = describeGitHead({ kind: 'detached', commit: 'a1b2c3d' })

    expect(label).toContain('detached')
    expect(label).toContain('a1b2c3d')
  })

  it('読めなかった場合も空欄にしない', () => {
    expect(describeGitHead({ kind: 'unknown' }).length).toBeGreaterThan(0)
  })
})
