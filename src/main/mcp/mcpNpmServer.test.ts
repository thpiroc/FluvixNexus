import { describe, expect, it } from 'vitest'
import { resolveNpmGlobalServerCommand, type NpmGlobalServerSpec } from './mcpNpmServer'

/**
 * npm でグローバルに入る MCP サーバーの探し方（mcpNpmServer.ts・MCP 共通）。
 *
 * 架空のパッケージ（`@example/mcp-server`）で確かめる。確かめたいのは3つ。
 *
 *   - 利用者がグローバルに入れたものだけを起動する（npx で取ってこない・Workspace の中身を起動しない）
 *   - Windows でも `cmd.exe` を挟まず、node で入口を直接起動する
 *   - 起動のしかたに要る環境変数は無い（`environment` は空）
 */

function existsIn(...present: readonly string[]): (path: string) => boolean {
  const set = new Set(present.map((path) => path.toLowerCase()))

  return (path) => set.has(path.toLowerCase())
}

const SPEC: NpmGlobalServerSpec = {
  name: 'Example MCP',
  binName: 'example-mcp-server',
  entryDirectory: 'node_modules\\@example\\mcp-server\\bin',
  entryFile: 'cli.mjs',
  args: ['--stdio']
}

const NPM = 'C:\\Users\\dev\\AppData\\Roaming\\npm'
const NODE_DIR = 'C:\\Program Files\\nodejs'
const NODE = `${NODE_DIR}\\node.exe`
const SHIM = `${NPM}\\example-mcp-server.cmd`
const ENTRY = `${NPM}\\node_modules\\@example\\mcp-server\\bin\\cli.mjs`

const WINDOWS_ENV = {
  PATH: `${NODE_DIR};${NPM};C:\\Windows\\System32`,
  APPDATA: 'C:\\Users\\dev\\AppData\\Roaming'
} as const

describe('resolveNpmGlobalServerCommand（Windows）', () => {
  it('PATH の .cmd の隣から入口を辿り、node.exe で直接起動する', () => {
    expect(
      resolveNpmGlobalServerCommand(SPEC, 'win32', WINDOWS_ENV, existsIn(NODE, SHIM, ENTRY))
    ).toEqual({
      ok: true,
      command: { name: 'Example MCP', file: NODE, args: [ENTRY, '--stdio'], environment: {} }
    })
  })

  it('cmd.exe で包まない（kill が中の node に届かなくなる）', () => {
    const resolved = resolveNpmGlobalServerCommand(
      SPEC,
      'win32',
      WINDOWS_ENV,
      existsIn(NODE, SHIM, ENTRY, 'C:\\Windows\\System32\\cmd.exe')
    )

    expect(resolved.ok && resolved.command.file.toLowerCase()).not.toContain('cmd.exe')
  })

  it('PATH に npm が無くても、%APPDATA%\\npm に入っていれば見つける', () => {
    const resolved = resolveNpmGlobalServerCommand(
      SPEC,
      'win32',
      { PATH: NODE_DIR, APPDATA: WINDOWS_ENV.APPDATA },
      existsIn(NODE, SHIM, ENTRY)
    )

    expect(resolved.ok && resolved.command.args[0]).toBe(ENTRY)
  })

  it('.cmd があっても入口が無ければ入っていない扱い', () => {
    expect(resolveNpmGlobalServerCommand(SPEC, 'win32', WINDOWS_ENV, existsIn(NODE, SHIM))).toEqual(
      { ok: false, problem: 'server-not-installed' }
    )
  })

  it('node が PATH に無ければ node-not-found', () => {
    expect(
      resolveNpmGlobalServerCommand(
        SPEC,
        'win32',
        { PATH: NPM, APPDATA: WINDOWS_ENV.APPDATA },
        existsIn(SHIM, ENTRY)
      )
    ).toEqual({ ok: false, problem: 'node-not-found' })
  })

  it('PATH の相対の項目（作業ディレクトリ）からは探さない', () => {
    expect(
      resolveNpmGlobalServerCommand(
        SPEC,
        'win32',
        { PATH: `.;${NODE_DIR}` },
        existsIn(
          NODE,
          '.\\example-mcp-server.cmd',
          '.\\node_modules\\@example\\mcp-server\\bin\\cli.mjs'
        )
      )
    ).toEqual({ ok: false, problem: 'server-not-installed' })
  })

  it('%APPDATA% が相対のパスなら当てにしない', () => {
    expect(
      resolveNpmGlobalServerCommand(
        SPEC,
        'win32',
        { PATH: NODE_DIR, APPDATA: 'Roaming' },
        existsIn(NODE, 'Roaming\\npm\\example-mcp-server.cmd')
      )
    ).toEqual({ ok: false, problem: 'server-not-installed' })
  })
})

describe('resolveNpmGlobalServerCommand（Unix 系）', () => {
  it('PATH の bin を直接起動する', () => {
    expect(
      resolveNpmGlobalServerCommand(
        SPEC,
        'linux',
        { PATH: '/usr/local/bin:/usr/bin' },
        existsIn('/usr/local/bin/example-mcp-server')
      )
    ).toEqual({
      ok: true,
      command: {
        name: 'Example MCP',
        file: '/usr/local/bin/example-mcp-server',
        args: ['--stdio'],
        environment: {}
      }
    })
  })

  it('入っていなければ server-not-installed', () => {
    expect(resolveNpmGlobalServerCommand(SPEC, 'darwin', { PATH: '/usr/bin' }, existsIn())).toEqual(
      { ok: false, problem: 'server-not-installed' }
    )
  })
})
