import { describe, expect, it } from 'vitest'
import {
  resolveMcpServerLaunch,
  type BundledNodeScriptLaunch,
  type McpLaunchContext
} from './mcpServerLaunch'

/**
 * MCP サーバーの起動のしかた（mcpServerLaunch.ts・MCP 共通）。架空のサーバーで確かめる。
 */

const APP_EXE = 'C:\\Program Files\\Fluvix Nexus\\Fluvix Nexus.exe'
const RESOURCES = 'C:\\Program Files\\Fluvix Nexus\\resources\\mcp-servers'

function context(present: readonly string[], overrides: Partial<McpLaunchContext> = {}) {
  const set = new Set(present.map((path) => path.toLowerCase()))

  return {
    platform: 'win32',
    env: { PATH: 'C:\\tools;C:\\Windows\\System32' },
    exists: (path: string) => set.has(path.toLowerCase()),
    bundledPackageDirectory: (launch: BundledNodeScriptLaunch) =>
      `${RESOURCES}\\${launch.bundleName}`,
    nodeRuntime: { file: APP_EXE, environment: { ELECTRON_RUN_AS_NODE: '1' } },
    ...overrides
  } satisfies McpLaunchContext
}

const BUNDLED: BundledNodeScriptLaunch = {
  kind: 'bundled-node-script',
  name: 'Example MCP',
  packageName: '@example/mcp-server',
  bundleName: 'example-mcp-server',
  entry: ['bin', 'cli.mjs'],
  args: ['--stdio']
}

const BUNDLED_ENTRY = `${RESOURCES}\\example-mcp-server\\bin\\cli.mjs`

describe('bundled-node-script', () => {
  it('同梱した入口を、アプリ自身の Node（Electron を Node として）で起動する', () => {
    expect(resolveMcpServerLaunch(BUNDLED, context([BUNDLED_ENTRY]))).toEqual({
      ok: true,
      command: {
        name: 'Example MCP',
        file: APP_EXE,
        args: [BUNDLED_ENTRY, '--stdio'],
        environment: { ELECTRON_RUN_AS_NODE: '1' }
      }
    })
  })

  it('PATH に node が無くても起動できる（利用者の PC の Node に頼らない）', () => {
    const resolved = resolveMcpServerLaunch(BUNDLED, context([BUNDLED_ENTRY], { env: {} }))

    expect(resolved.ok).toBe(true)
  })

  it('同梱したはずの入口が無ければ server-not-installed（配布物が壊れている）', () => {
    expect(resolveMcpServerLaunch(BUNDLED, context([]))).toEqual({
      ok: false,
      problem: 'server-not-installed'
    })
  })

  it('Unix 系では / で繋ぐ', () => {
    const resolved = resolveMcpServerLaunch(
      BUNDLED,
      context(['/opt/fluvix/resources/mcp-servers/example-mcp-server/bin/cli.mjs'], {
        platform: 'linux',
        bundledPackageDirectory: (launch) =>
          `/opt/fluvix/resources/mcp-servers/${launch.bundleName}/`
      })
    )

    expect(resolved.ok && resolved.command.args[0]).toBe(
      '/opt/fluvix/resources/mcp-servers/example-mcp-server/bin/cli.mjs'
    )
  })
})

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
