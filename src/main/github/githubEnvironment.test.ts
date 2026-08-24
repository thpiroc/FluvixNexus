import { describe, expect, it } from 'vitest'
import { createGitHubCliEnvironment } from './githubEnvironment'

/**
 * gh へ渡す環境変数（githubEnvironment.ts）。
 *
 * 確かめたいのは2つになる。
 *   - **git 用の表がそのまま効いている**こと（土台にしてあるので、
 *     片方だけ直された日に穴が開かない）
 *   - gh が**見えない場所で待たない・出力を汚さない**こと
 */
describe('createGitHubCliEnvironment', () => {
  it('git 用の設定をそのまま引き継ぐ', () => {
    const env = createGitHubCliEnvironment({})

    // gh は自分で git を起動する。そちらも端末を持たない。
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    // 失敗の文章を分類するのは gh でも同じ（githubFailure.ts）。
    expect(env.LC_ALL).toBe('C')
  })

  it('Electron 由来の変数を引き継がない', () => {
    const env = createGitHubCliEnvironment({
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--max-old-space-size=4096'
    })

    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.NODE_OPTIONS).toBeUndefined()
  })

  it('対話と pager を止める', () => {
    const env = createGitHubCliEnvironment({})

    expect(env.GH_PROMPT_DISABLED).toBe('1')
    // pager を挟まれると、出力を読み終えられない。
    expect(env.GH_PAGER).toBe('')
    expect(env.GH_NO_UPDATE_NOTIFIER).toBe('1')
    expect(env.NO_COLOR).toBe('1')
  })

  /*
    相手のホストを環境変数で固定しない ── Enterprise を使っている人の
    設定を、アプリの中でだけ変えることになる（相手は引数で明示してある。
    githubCommands.ts）。
  */
  it('GH_HOST を上書きしない', () => {
    expect(createGitHubCliEnvironment({}).GH_HOST).toBeUndefined()
    expect(createGitHubCliEnvironment({ GH_HOST: 'ghe.example.com' }).GH_HOST).toBe(
      'ghe.example.com'
    )
  })

  /*
    利用者が意図して置いた資格情報を、アプリの中でだけ無視しない
    （アプリ自身は token を持たない。設計判断 7）。
  */
  it('利用者自身の設定は残す', () => {
    const env = createGitHubCliEnvironment({ GH_TOKEN: 'x', PATH: 'C:\\Windows' })

    expect(env.GH_TOKEN).toBe('x')
    expect(env.PATH).toBe('C:\\Windows')
  })

  it('渡された環境をその場で書き換えない', () => {
    const parent = { ELECTRON_RUN_AS_NODE: '1' }

    createGitHubCliEnvironment(parent)

    expect(parent.ELECTRON_RUN_AS_NODE).toBe('1')
  })
})
