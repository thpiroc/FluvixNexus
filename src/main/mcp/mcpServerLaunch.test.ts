import { describe, expect, it } from 'vitest'
import {
  buildWindowsBatchCommandLine,
  resolveMcpServerLaunch,
  type McpLaunchContext,
  type UserCommandLaunch
} from './mcpServerLaunch'

/**
 * MCP サーバーの起動のしかた（mcpServerLaunch.ts・MCP 共通）。架空のサーバーで確かめる。
 */

function context(present: readonly string[], overrides: Partial<McpLaunchContext> = {}) {
  const set = new Set(present.map((path) => path.toLowerCase()))

  return {
    platform: 'win32',
    env: { PATH: 'C:\\tools;C:\\Windows\\System32' },
    exists: (path: string) => set.has(path.toLowerCase()),
    ...overrides
  } satisfies McpLaunchContext
}

describe('executable-on-path', () => {
  const LAUNCH = {
    kind: 'executable-on-path',
    name: 'Example Binary MCP',
    executableNames: { win32: ['example-mcp.exe'], other: ['example-mcp'] },
    args: ['stdio']
  } as const

  it('PATH を辿って見つけた実行ファイルを、起動用の変数なしで起動する', () => {
    expect(resolveMcpServerLaunch(LAUNCH, context(['C:\\tools\\example-mcp.exe']))).toEqual({
      ok: true,
      command: {
        name: 'Example Binary MCP',
        file: 'C:\\tools\\example-mcp.exe',
        args: ['stdio'],
        environment: {}
      }
    })
  })

  it('PATH の相対の項目からは探さない', () => {
    expect(
      resolveMcpServerLaunch(
        LAUNCH,
        context(['.\\example-mcp.exe'], { env: { PATH: '.;C:\\Windows\\System32' } })
      )
    ).toEqual({ ok: false, problem: 'server-not-installed' })
  })

  it('OS ごとの名前で探す', () => {
    const resolved = resolveMcpServerLaunch(
      LAUNCH,
      context(['/usr/local/bin/example-mcp'], {
        platform: 'darwin',
        env: { PATH: '/usr/local/bin:/usr/bin' }
      })
    )

    expect(resolved.ok && resolved.command.file).toBe('/usr/local/bin/example-mcp')
  })
})

describe('npm-global', () => {
  it('mcpNpmServer.ts の探し方をそのまま使う', () => {
    const resolved = resolveMcpServerLaunch(
      {
        kind: 'npm-global',
        spec: {
          name: 'Example npm MCP',
          binName: 'example-mcp-server',
          entryDirectory: 'node_modules\\example-mcp-server\\bin',
          entryFile: 'cli.js',
          args: []
        }
      },
      context([], { env: { PATH: 'C:\\tools' } })
    )

    expect(resolved).toEqual({ ok: false, problem: 'server-not-installed' })
  })
})

describe('user-command（MCP Server Manager に登録したサーバー。§21.4）', () => {
  const SYSTEM32 = 'C:\\Windows\\System32'
  const WIN_ENV = { PATH: `C:\\nodejs;.\\bin;${SYSTEM32}`, SystemRoot: 'C:\\Windows' }

  function userCommand(command: string, args: readonly string[] = []): UserCommandLaunch {
    return { kind: 'user-command', name: 'Example', command, args }
  }

  it('実行ファイルは PATH を辿って絶対パスで起動し、子孫ごと終わらせる道具を付ける', () => {
    expect(
      resolveMcpServerLaunch(
        userCommand('uvx', ['example-mcp', '--stdio']),
        context(['C:\\nodejs\\uvx.exe'], { env: WIN_ENV })
      )
    ).toEqual({
      ok: true,
      command: {
        name: 'Example',
        file: 'C:\\nodejs\\uvx.exe',
        args: ['example-mcp', '--stdio'],
        environment: {},
        killTreeWith: `${SYSTEM32}\\taskkill.exe`
      }
    })
  })

  it('.cmd は System32 の cmd.exe で包み、どの引数も " で囲む', () => {
    const resolved = resolveMcpServerLaunch(
      userCommand('npx', ['-y', '@example/mcp-server', 'C:\\My Files\\', 'a&b']),
      context(['C:\\nodejs\\npx.cmd'], { env: WIN_ENV })
    )

    expect(resolved).toEqual({
      ok: true,
      command: {
        name: 'Example',
        file: `${SYSTEM32}\\cmd.exe`,
        args: [
          '/d',
          '/s',
          '/c',
          '""C:\\nodejs\\npx.cmd" "-y" "@example/mcp-server" "C:\\My Files\\\\" "a&b""'
        ],
        environment: {},
        windowsVerbatimArguments: true,
        killTreeWith: `${SYSTEM32}\\taskkill.exe`
      }
    })
  })

  it('.cmd へ " % ! を含む引数は渡さない（囲みの中でも効いてしまう）', () => {
    for (const arg of ['a"b', '%PATH%', 'hi!']) {
      expect(
        resolveMcpServerLaunch(
          userCommand('npx', [arg]),
          context(['C:\\nodejs\\npx.cmd'], { env: WIN_ENV })
        )
      ).toEqual({ ok: false, problem: 'arguments-unsupported' })
    }
  })

  it('実行ファイル（.exe）へは同じ引数をそのまま渡せる', () => {
    expect(
      resolveMcpServerLaunch(
        userCommand('C:\\tools\\server.exe', ['%PATH%', 'a"b']),
        context(['C:\\tools\\server.exe'], { env: WIN_ENV })
      )
    ).toMatchObject({ ok: true, command: { args: ['%PATH%', 'a"b'] } })
  })

  it('絶対パスは、拡張子を省いた書き方も当たる', () => {
    expect(
      resolveMcpServerLaunch(
        userCommand('C:\\tools\\server'),
        context(['C:\\tools\\server.exe'], { env: WIN_ENV })
      )
    ).toMatchObject({ ok: true, command: { file: 'C:\\tools\\server.exe' } })
  })

  it('PATH の相対の項目（.\\bin）は辿らない', () => {
    expect(
      resolveMcpServerLaunch(
        userCommand('server'),
        context(['.\\bin\\server.exe'], { env: WIN_ENV })
      )
    ).toEqual({ ok: false, problem: 'command-not-found' })
  })

  it('見つからなければ command-not-found', () => {
    expect(resolveMcpServerLaunch(userCommand('missing'), context([], { env: WIN_ENV }))).toEqual({
      ok: false,
      problem: 'command-not-found'
    })
    expect(
      resolveMcpServerLaunch(userCommand('C:\\tools\\missing.exe'), context([], { env: WIN_ENV }))
    ).toEqual({ ok: false, problem: 'command-not-found' })
  })

  it('SystemRoot が分からなければ .cmd は起動しない（PATH から別の cmd を掴まない）', () => {
    expect(
      resolveMcpServerLaunch(
        userCommand('npx'),
        context(['C:\\nodejs\\npx.cmd'], { env: { PATH: 'C:\\nodejs' } })
      )
    ).toEqual({ ok: false, problem: 'command-not-found' })
  })

  it('Unix 系では PATH を辿って、そのまま起動する', () => {
    expect(
      resolveMcpServerLaunch(
        userCommand('npx', ['-y', 'pkg']),
        context(['/usr/local/bin/npx'], { platform: 'linux', env: { PATH: '/usr/local/bin' } })
      )
    ).toEqual({
      ok: true,
      command: { name: 'Example', file: '/usr/local/bin/npx', args: ['-y', 'pkg'], environment: {} }
    })
  })
})

describe('buildWindowsBatchCommandLine', () => {
  it('末尾の \\ を2つにして、閉じる " をそのまま文字にさせない', () => {
    expect(buildWindowsBatchCommandLine('C:\\a.cmd', ['C:\\dir\\'])).toBe(
      '"C:\\a.cmd" "C:\\dir\\\\"'
    )
  })

  it('空の引数は "" として残す', () => {
    expect(buildWindowsBatchCommandLine('C:\\a.cmd', [''])).toBe('"C:\\a.cmd" ""')
  })
})
