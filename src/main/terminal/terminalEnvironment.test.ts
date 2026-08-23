import { describe, expect, it } from 'vitest'
import { createTerminalEnvironment } from './terminalEnvironment'

/**
 * シェルへ渡す環境変数（terminalEnvironment.ts）。
 *
 * 確かめたいのは「開いたターミナルが、素の PowerShell を開いたときと
 * 同じように振る舞うこと」で、そのために落とすものと足すものが決まっている。
 */
describe('createTerminalEnvironment', () => {
  /*
    このアプリで Electron アプリを開発する利用者が最初に踏むもの。
    引き継ぐと、ターミナルから起動した Electron アプリが素の Node として
    立ち上がり、**相手のアプリのバグに見える形で**落ちる。
  */
  it('ELECTRON_RUN_AS_NODE を引き継がない', () => {
    const env = createTerminalEnvironment({ ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin' })

    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(Object.hasOwn(env, 'ELECTRON_RUN_AS_NODE')).toBe(false)
  })

  it('NODE_OPTIONS を引き継がない', () => {
    const env = createTerminalEnvironment({ NODE_OPTIONS: '--max-old-space-size=8192' })

    expect(env.NODE_OPTIONS).toBeUndefined()
  })

  /*
    Windows の環境変数は大文字小文字を区別しないが、process.env を展開した
    ただのオブジェクトはそうではない。実際に届く綴りが定義と違うことがある。
  */
  it('綴りが小文字でも落とす', () => {
    const env = createTerminalEnvironment({ electron_run_as_node: '1' })

    expect(env.electron_run_as_node).toBeUndefined()
  })

  it('利用者自身の環境変数は残す', () => {
    const env = createTerminalEnvironment({
      PATH: 'C:\\bin',
      MY_TOKEN: 'secret',
      SystemRoot: 'C:\\WINDOWS'
    })

    expect(env.PATH).toBe('C:\\bin')
    expect(env.MY_TOKEN).toBe('secret')
    expect(env.SystemRoot).toBe('C:\\WINDOWS')
  })

  it('TERM を端末として申告する', () => {
    expect(createTerminalEnvironment({}).TERM).toBe('xterm-256color')
  })

  /*
    環境変数はそこから起動されるすべてに効く。増やすほど「素のシェルと違う場所」
    になるため、アプリ固有の値を混ぜていないことを確かめておく。
  */
  it('元の環境に無かった変数を TERM 以外に足さない', () => {
    const parent = { PATH: 'C:\\bin' }
    const env = createTerminalEnvironment(parent)

    const added = Object.keys(env).filter((name) => !Object.hasOwn(parent, name))

    expect(added).toEqual(['TERM'])
  })

  it('渡された環境をその場で書き換えない', () => {
    const parent = { ELECTRON_RUN_AS_NODE: '1' }

    createTerminalEnvironment(parent)

    expect(parent.ELECTRON_RUN_AS_NODE).toBe('1')
  })
})
