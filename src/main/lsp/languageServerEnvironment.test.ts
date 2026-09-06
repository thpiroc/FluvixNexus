import { describe, expect, it } from 'vitest'
import { createLanguageServerEnvironment } from './languageServerEnvironment'

/**
 * Language Server へ渡す環境変数（languageServerEnvironment.ts）。
 *
 * Electron が自分のために立てた変数を子へ持ち出さないこと、
 * そして**それ以外は1つも触らないこと**を確かめる。
 */
describe('createLanguageServerEnvironment', () => {
  it('Electron 由来の変数を落とす', () => {
    const env = createLanguageServerEnvironment({
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--max-old-space-size=4096'
    })

    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.NODE_OPTIONS).toBeUndefined()
  })

  it('綴り違いで届いたものも落とす', () => {
    const env = createLanguageServerEnvironment({
      electron_run_as_node: '1',
      node_options: '--trace-warnings'
    })

    expect(env.electron_run_as_node).toBeUndefined()
    expect(env.node_options).toBeUndefined()
  })

  it('利用者が設定したものはそのまま渡す', () => {
    const env = createLanguageServerEnvironment({
      PATH: 'C:\\Windows\\System32',
      PYTHONPATH: 'D:\\lib',
      DOTNET_ROOT: 'C:\\Program Files\\dotnet'
    })

    expect(env).toEqual({
      PATH: 'C:\\Windows\\System32',
      PYTHONPATH: 'D:\\lib',
      DOTNET_ROOT: 'C:\\Program Files\\dotnet'
    })
  })

  /*
    Terminal と違い、端末は付いていない。TERM を申告すると、サーバによっては
    色の付いたログを stderr へ流し始める（読むのはこちらのログだけ）。
  */
  it('端末であることを申告しない', () => {
    const env = createLanguageServerEnvironment({ PATH: '/usr/bin' })

    expect(env.TERM).toBeUndefined()
  })

  it('元のオブジェクトを書き換えない', () => {
    const parent = { ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin' }

    createLanguageServerEnvironment(parent)

    expect(parent.ELECTRON_RUN_AS_NODE).toBe('1')
  })
})
