import { describe, expect, it } from 'vitest'
import {
  describeGitHubRepositoryNameProblem,
  describeGitHubStatus,
  GITHUB_CLI_INSTALL_COMMAND,
  GITHUB_VISIBILITY_CHOICES,
  toGitHubPublishReadiness,
  toGitHubRepositoryNameSuggestion,
  toGitHubStatusState,
  type GitHubStatusState
} from './githubPublish'
import { createTranslator } from '../i18n/messages'

/**
 * 公開の面の中身（githubPublish.ts）。
 *
 * ここで固定しているのは3つになる。
 *
 *   1. **どの状態にも次の一手が書かれている**こと
 *   2. 押せない理由が、押せないボタン以外の形でも出ること
 *   3. 既定が `private` であること（押し間違いの代償が釣り合わない）
 */

const statuses: readonly GitHubStatusState['status'][] = [
  'loading',
  'ready',
  'cli-missing',
  'signed-out',
  'failed'
]

describe('describeGitHubStatus', () => {
  it('使える状態では案内を出さない', () => {
    expect(describeGitHubStatus({ status: 'ready' })).toBeNull()
  })

  it('どの状態にも次の一手を添える', () => {
    for (const status of statuses.filter((value) => value !== 'ready')) {
      const notice = describeGitHubStatus({ status })

      expect(notice, status).not.toBeNull()
      expect(notice?.title.length, status).toBeGreaterThan(0)
      expect(notice?.description.length, status).toBeGreaterThan(0)
    }
  })

  /*
    アプリからは入れない（設計判断）── 出すのは「利用者が自分で打てる
    文字列」1つだけになる。
  */
  it('gh が無い場合は winget の1行を添える', () => {
    const notice = describeGitHubStatus({ status: 'cli-missing' })

    expect(notice?.command).toBe(GITHUB_CLI_INSTALL_COMMAND)
    expect(GITHUB_CLI_INSTALL_COMMAND).toContain('winget')
  })

  it('ログインしていない場合は gh auth login を添える', () => {
    expect(describeGitHubStatus({ status: 'signed-out' })?.command).toBe('gh auth login')
  })

  it('状態ごとに違う文言になる', () => {
    const titles = statuses
      .filter((value) => value !== 'ready')
      .map((status) => describeGitHubStatus({ status })?.title)

    expect(new Set(titles).size).toBe(titles.length)
  })
})

describe('toGitHubStatusState', () => {
  it('shared の状態をそのまま写す', () => {
    expect(toGitHubStatusState({ status: 'cli-missing' })).toEqual({ status: 'cli-missing' })
    expect(toGitHubStatusState({ status: 'ready' })).toEqual({ status: 'ready' })
  })
})

describe('toGitHubRepositoryNameSuggestion', () => {
  it('そのまま使えるフォルダ名はそのまま出す', () => {
    expect(toGitHubRepositoryNameSuggestion('fluvix-nexus')).toBe('fluvix-nexus')
  })

  it('使えない字のかたまりを - にまとめる', () => {
    expect(toGitHubRepositoryNameSuggestion('My Project')).toBe('My-Project')
    expect(toGitHubRepositoryNameSuggestion('app (v2)')).toBe('app-v2')
  })

  it('先頭と末尾の - / . は落とす', () => {
    expect(toGitHubRepositoryNameSuggestion('.config')).toBe('config')
    expect(toGitHubRepositoryNameSuggestion('project ')).toBe('project')
  })

  /*
    直せない名前で `--` のような意味の無い文字列を初期値にしない
    （空欄から打ち始める方が早い）。
  */
  it('置き換えても通らない名前は空にする', () => {
    expect(toGitHubRepositoryNameSuggestion('日本語')).toBe('')
    expect(toGitHubRepositoryNameSuggestion('   ')).toBe('')
    expect(toGitHubRepositoryNameSuggestion('')).toBe('')
  })
})

describe('toGitHubPublishReadiness', () => {
  const ready: GitHubStatusState = { status: 'ready' }

  it('名前が通れば押せる', () => {
    const readiness = toGitHubPublishReadiness('nexus', ready, false)

    expect(readiness.enabled).toBe(true)
    expect(readiness.note).toContain('nexus')
  })

  /*
    打つ前から「入力してください」と赤く出るのは、まだ何も間違えていない人に
    間違いを知らせる形になる。
  */
  it('空欄では押せないが、間違いとしては言わない', () => {
    const readiness = toGitHubPublishReadiness('', ready, false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).not.toContain('使えません')
  })

  it('通らない名前では理由を出す', () => {
    const readiness = toGitHubPublishReadiness('my repo', ready, false)

    expect(readiness.enabled).toBe(false)
    expect(readiness.note).toBe(describeGitHubRepositoryNameProblem('invalid-characters'))
  })

  /*
    押せない理由が2つ（名前と gh）に分かれていると、片方を直した人が
    もう片方に気づけない。
  */
  it('gh が使えない間は、名前が通っても押せない', () => {
    for (const status of ['loading', 'cli-missing', 'signed-out', 'failed'] as const) {
      const readiness = toGitHubPublishReadiness('nexus', { status }, false)

      expect(readiness.enabled, status).toBe(false)
      expect(readiness.note.length, status).toBeGreaterThan(0)
    }
  })

  it('他の Git 操作が動いている間は押せない', () => {
    expect(toGitHubPublishReadiness('nexus', ready, true).enabled).toBe(false)
  })
})

describe('describeGitHubRepositoryNameProblem', () => {
  it('分類ごとに違う文言になる', () => {
    const messages = (['empty', 'too-long', 'invalid-characters', 'invalid-shape'] as const).map(
      describeGitHubRepositoryNameProblem
    )

    expect(new Set(messages).size).toBe(messages.length)
  })

  it('何が使えるかを具体的に書く', () => {
    expect(describeGitHubRepositoryNameProblem('invalid-characters')).toContain('英数字')
  })
})

describe('GITHUB_VISIBILITY_CHOICES', () => {
  /*
    押し間違いが「世界中から見える」になる側を、既定にも1つめにもしない
    （shared/github/publish.ts）。
  */
  it('private が先頭にある', () => {
    expect(GITHUB_VISIBILITY_CHOICES[0].value).toBe('private')
    expect(GITHUB_VISIBILITY_CHOICES.map((choice) => choice.value)).toEqual(['private', 'public'])
  })

  it('どちらにも、何が起きるかの一言が付く', () => {
    const t = createTranslator('ja')

    for (const choice of GITHUB_VISIBILITY_CHOICES) {
      expect(t(choice.noteKey).length, choice.value).toBeGreaterThan(0)
    }
  })
})
