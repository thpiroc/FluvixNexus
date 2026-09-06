import { describe, expect, it } from 'vitest'
import type { PlatformId } from '@shared/api'
import {
  isLanguageServerId,
  LANGUAGE_SERVER_IDS,
  resolveLanguageServerCommand
} from './languageServerCatalog'

/**
 * どの Language Server をどこから起動するか（languageServerCatalog.ts）。
 *
 * ここで確かめたいのは、**開いたフォルダの中身が起動されないこと**に尽きる。
 * Language Server は利用者が明示的に起動するものですらない（コードを開いた
 * だけで立つ）ため、Terminal より強くこの線が効く必要がある。
 */

const WORKSPACE = 'D:\\work\\cloned-repo'

/** その場所にあることにする（`fs` の代わり）。 */
function existsIn(...present: readonly string[]): (path: string) => boolean {
  const set = new Set(present.map((path) => path.toLowerCase()))

  return (path) => set.has(path.toLowerCase())
}

const WINDOWS_ENV = {
  PATH: 'C:\\Users\\dev\\AppData\\Roaming\\npm;C:\\Windows\\System32',
  SystemRoot: 'C:\\Windows',
  USERPROFILE: 'C:\\Users\\dev'
} as const

const NPM_DIRECTORY = 'C:\\Users\\dev\\AppData\\Roaming\\npm'
const CMD = 'C:\\Windows\\System32\\cmd.exe'

describe('isLanguageServerId', () => {
  it('表にある行だけを受け付ける', () => {
    for (const id of LANGUAGE_SERVER_IDS) {
      expect(isLanguageServerId(id)).toBe(true)
    }

    expect(isLanguageServerId('rust')).toBe(false)
    expect(isLanguageServerId('')).toBe(false)
    expect(isLanguageServerId(undefined)).toBe(false)
    expect(isLanguageServerId({ id: 'typescript' })).toBe(false)
  })
})

describe('resolveLanguageServerCommand', () => {
  it('入っていなければ null（その言語だけが使えない）', () => {
    for (const id of LANGUAGE_SERVER_IDS) {
      expect(resolveLanguageServerCommand(id, 'win32', WINDOWS_ENV, existsIn())).toBeNull()
    }
  })

  /* ------------------------------------------------------- 開いたフォルダを見ない */

  /*
    Windows の CreateProcess は作業ディレクトリを先に見る。clone してきた
    リポジトリの中に同じ名前の実行ファイルが置かれていても、起動されるものは
    変わらないことを直接確かめる。
  */
  it('Workspace の中に同名の実行ファイルがあっても、それは起動されない', () => {
    const command = resolveLanguageServerCommand(
      'csharp',
      'win32',
      WINDOWS_ENV,
      existsIn(`${WORKSPACE}\\csharp-ls.exe`)
    )

    expect(command).toBeNull()
  })

  it('PATH の相対の項目は当てにしない', () => {
    const command = resolveLanguageServerCommand(
      'csharp',
      'win32',
      { ...WINDOWS_ENV, PATH: '.;bin' },
      existsIn('.\\csharp-ls.exe', 'bin\\csharp-ls.exe')
    )

    expect(command).toBeNull()
  })

  it('解決できたものは必ず絶対パスで返る', () => {
    const command = resolveLanguageServerCommand(
      'csharp',
      'win32',
      WINDOWS_ENV,
      existsIn('C:\\Windows\\System32\\csharp-ls.exe')
    )

    expect(command?.file).toBe('C:\\Windows\\System32\\csharp-ls.exe')
  })

  /* ------------------------------------------------------------- npm のサーバ */

  it('typescript は --stdio を付けて起動する', () => {
    const command = resolveLanguageServerCommand(
      'typescript',
      'linux',
      { PATH: '/usr/local/bin' },
      existsIn('/usr/local/bin/typescript-language-server')
    )

    expect(command).toEqual({
      name: 'TypeScript Language Server',
      file: '/usr/local/bin/typescript-language-server',
      args: ['--stdio']
    })
  })

  it('python は pyright-langserver を --stdio で起動する', () => {
    const command = resolveLanguageServerCommand(
      'python',
      'linux',
      { PATH: '/usr/local/bin' },
      existsIn('/usr/local/bin/pyright-langserver')
    )

    expect(command).toEqual({
      name: 'Pyright',
      file: '/usr/local/bin/pyright-langserver',
      args: ['--stdio']
    })
  })

  /*
    npm が Windows に置くのはバッチで、CreateProcess は直接実行できない。
    包む cmd.exe も %SystemRoot% から組み立てる（PATH に任せない）。
  */
  it('Windows の .cmd は %SystemRoot% の cmd.exe で包む', () => {
    const command = resolveLanguageServerCommand(
      'typescript',
      'win32',
      WINDOWS_ENV,
      existsIn(`${NPM_DIRECTORY}\\typescript-language-server.cmd`, CMD)
    )

    expect(command).toEqual({
      name: 'TypeScript Language Server',
      file: CMD,
      args: ['/c', `${NPM_DIRECTORY}\\typescript-language-server.cmd`, '--stdio']
    })
  })

  it('ネイティブの実行ファイルがあれば、包まずに直接起動する', () => {
    const command = resolveLanguageServerCommand(
      'typescript',
      'win32',
      WINDOWS_ENV,
      existsIn(
        `${NPM_DIRECTORY}\\typescript-language-server.exe`,
        `${NPM_DIRECTORY}\\typescript-language-server.cmd`,
        CMD
      )
    )

    expect(command?.file).toBe(`${NPM_DIRECTORY}\\typescript-language-server.exe`)
    expect(command?.args).toEqual(['--stdio'])
  })

  /*
    落として名前だけで起動すると、その cmd.exe は PATH と cwd から解決される
    ── 表が守っている性質そのものが崩れるので、使えないままにする。
  */
  it('%SystemRoot% が読めなければ、.cmd は起動しない', () => {
    const command = resolveLanguageServerCommand(
      'typescript',
      'win32',
      { PATH: NPM_DIRECTORY },
      existsIn(`${NPM_DIRECTORY}\\typescript-language-server.cmd`, CMD)
    )

    expect(command).toBeNull()
  })

  /* ----------------------------------------------------------- dotnet のツール */

  it('csharp は PATH に無ければ dotnet のツール置き場を当たる', () => {
    const command = resolveLanguageServerCommand(
      'csharp',
      'win32',
      WINDOWS_ENV,
      existsIn('C:\\Users\\dev\\.dotnet\\tools\\csharp-ls.exe')
    )

    expect(command).toEqual({
      name: 'csharp-ls',
      file: 'C:\\Users\\dev\\.dotnet\\tools\\csharp-ls.exe',
      args: []
    })
  })

  it('csharp は PATH にあればそちらを使う', () => {
    const command = resolveLanguageServerCommand(
      'csharp',
      'win32',
      WINDOWS_ENV,
      existsIn(`${NPM_DIRECTORY}\\csharp-ls.exe`, 'C:\\Users\\dev\\.dotnet\\tools\\csharp-ls.exe')
    )

    expect(command?.file).toBe(`${NPM_DIRECTORY}\\csharp-ls.exe`)
  })

  it('ホームが読めなければ、ツール置き場は当たらない', () => {
    const command = resolveLanguageServerCommand(
      'csharp',
      'win32',
      { PATH: NPM_DIRECTORY, SystemRoot: 'C:\\Windows' },
      existsIn('C:\\Users\\dev\\.dotnet\\tools\\csharp-ls.exe')
    )

    expect(command).toBeNull()
  })

  /* -------------------------------------------------------------------- 全行 */

  it('どの行も、解決できたなら絶対パスと文字列の引数だけを返す', () => {
    // 行を足したときに、片方の OS だけ形が崩れているのを拾うための見張り。
    const platforms: readonly PlatformId[] = ['win32', 'linux']

    for (const platform of platforms) {
      for (const id of LANGUAGE_SERVER_IDS) {
        const command = resolveLanguageServerCommand(id, platform, WINDOWS_ENV, () => true)

        if (command === null) {
          continue
        }

        expect(command.file.length).toBeGreaterThan(0)
        expect(command.args.every((arg) => typeof arg === 'string')).toBe(true)
      }
    }
  })
})
