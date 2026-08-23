import { describe, expect, it } from 'vitest'
import { createGitEnvironment } from './gitEnvironment'

/**
 * git へ渡す環境変数（gitEnvironment.ts）。
 *
 * 確かめたいのは「**アプリから呼ぶ git が、見えない場所で待ち続けない**」ことと、
 * 「利用者自身の設定を消していない」こと。
 */
describe('createGitEnvironment', () => {
  it('端末からの入力待ちを起こさない', () => {
    const env = createGitEnvironment({})

    // 端末が付いていないため、尋ねようとされると待ち続けることになる。
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
  })

  it('読み取りのためにロックを取らない', () => {
    // 利用者が Terminal で叩いている git を、アプリの問い合わせが邪魔しないため。
    expect(createGitEnvironment({}).GIT_OPTIONAL_LOCKS).toBe('0')
  })

  it('失敗の文章の言語を固定する', () => {
    // gitFailure.ts が英文を当てにできるのは、この設定と対になっているため。
    expect(createGitEnvironment({}).LC_ALL).toBe('C')
  })

  it('Electron 由来の変数を引き継がない', () => {
    const env = createGitEnvironment({
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--max-old-space-size=4096'
    })

    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.NODE_OPTIONS).toBeUndefined()
  })

  it('綴り違いでも落とす', () => {
    const env = createGitEnvironment({ electron_run_as_node: '1', node_options: '--trace' })

    expect(env.electron_run_as_node).toBeUndefined()
    expect(env.node_options).toBeUndefined()
  })

  it('利用者自身の設定は残す', () => {
    const env = createGitEnvironment({
      PATH: 'C:\\Windows',
      // 利用者が意図して変えた振る舞いを、アプリの中でだけ変えない。
      GIT_SSH_COMMAND: 'ssh -i C:\\keys\\id_ed25519',
      HOME: 'C:\\Users\\me'
    })

    expect(env.PATH).toBe('C:\\Windows')
    expect(env.GIT_SSH_COMMAND).toBe('ssh -i C:\\keys\\id_ed25519')
    expect(env.HOME).toBe('C:\\Users\\me')
  })

  it('渡された環境をその場で書き換えない', () => {
    const parent = { ELECTRON_RUN_AS_NODE: '1' }

    createGitEnvironment(parent)

    // process.env をそのまま渡すため、書き換えるとアプリ自身の環境が変わる。
    expect(parent.ELECTRON_RUN_AS_NODE).toBe('1')
  })
})
