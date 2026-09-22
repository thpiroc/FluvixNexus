import { describe, expect, it } from 'vitest'
import { MCP_BUILTIN_CONNECTION_IDS } from '@shared/mcp'
import {
  createMcpServerEnvironment,
  MCP_SERVER_DEFINITIONS,
  resolveMcpServerCommand,
  resolveMcpServerToken
} from './mcpServerCatalog'
import type { BundledNodeScriptLaunch, McpLaunchContext } from './mcpServerLaunch'
import { NOTION_MCP_SERVER, NOTION_MCP_TOKEN_ENV } from './notionMcpServer'

/**
 * MCP サーバーの表（mcpServerCatalog.ts）と、その Notion の行（notionMcpServer.ts）。
 *
 * token はテスト用の架空の値。
 */

const TOKEN = 'ntn_fictitiousTestToken0123456789'
const APP_EXE = 'C:\\Program Files\\Fluvix Nexus\\Fluvix Nexus.exe'
const RESOURCES = 'C:\\Program Files\\Fluvix Nexus\\resources\\mcp-servers'
const NOTION_ENTRY = `${RESOURCES}\\notion-mcp-server\\bin\\cli.mjs`

function launchContext(present: readonly string[], env = {}): McpLaunchContext {
  const set = new Set(present.map((path) => path.toLowerCase()))

  return {
    platform: 'win32',
    env,
    exists: (path) => set.has(path.toLowerCase()),
    bundledPackageDirectory: (launch: BundledNodeScriptLaunch) =>
      `${RESOURCES}\\${launch.bundleName}`,
    nodeRuntime: { file: APP_EXE, environment: { ELECTRON_RUN_AS_NODE: '1' } }
  }
}

describe('resolveMcpServerCommand（Notion）', () => {
  it('同梱したサーバーを、アプリ自身の Node で起動する（利用者の Node / npm に頼らない）', () => {
    expect(
      resolveMcpServerCommand(MCP_SERVER_DEFINITIONS.notion, launchContext([NOTION_ENTRY]))
    ).toEqual({
      ok: true,
      command: {
        name: 'Notion MCP',
        file: APP_EXE,
        args: [NOTION_ENTRY, '--transport', 'stdio'],
        environment: { ELECTRON_RUN_AS_NODE: '1' }
      }
    })
  })

  it('同梱したファイルが無ければ server-not-installed', () => {
    expect(resolveMcpServerCommand(MCP_SERVER_DEFINITIONS.notion, launchContext([]))).toEqual({
      ok: false,
      problem: 'server-not-installed'
    })
  })

  it('同梱の置き場所は、表の packageName / bundleName で決まる', () => {
    expect(NOTION_MCP_SERVER.launch).toMatchObject({
      kind: 'bundled-node-script',
      packageName: '@notionhq/notion-mcp-server',
      bundleName: 'notion-mcp-server',
      entry: ['bin', 'cli.mjs']
    })
  })
})

describe('resolveMcpServerToken（Notion）', () => {
  it('FLUVIX_NOTION_MCP_TOKEN から読む', () => {
    expect(NOTION_MCP_TOKEN_ENV).toBe('FLUVIX_NOTION_MCP_TOKEN')
    expect(
      resolveMcpServerToken(MCP_SERVER_DEFINITIONS.notion, { FLUVIX_NOTION_MCP_TOKEN: TOKEN })
    ).toEqual({
      ok: true,
      token: TOKEN
    })
  })

  it('フィードバック用の FLUVIX_NOTION_TOKEN は使わない', () => {
    expect(
      resolveMcpServerToken(MCP_SERVER_DEFINITIONS.notion, { FLUVIX_NOTION_TOKEN: TOKEN })
    ).toEqual({
      ok: false,
      problem: 'token-missing'
    })
  })

  it('サーバーが使う NOTION_TOKEN も読まない（利用者の既存の値を黙って使わない）', () => {
    expect(resolveMcpServerToken(MCP_SERVER_DEFINITIONS.notion, { NOTION_TOKEN: TOKEN })).toEqual({
      ok: false,
      problem: 'token-missing'
    })
  })
})

describe('createMcpServerEnvironment（Notion）', () => {
  const parent = {
    Path: 'C:\\Windows\\System32',
    SystemRoot: 'C:\\Windows',
    USERPROFILE: 'C:\\Users\\dev',
    ELECTRON_RUN_AS_NODE: '1',
    node_options: '--inspect',
    OPENAPI_MCP_HEADERS: '{"Authorization":"Bearer other"}',
    NOTION_TOKEN: 'ntn_someOtherValue',
    BASE_URL: 'https://example.invalid/',
    auth_token: 'http-transport-secret',
    ENABLE_TOKEN_PASSTHROUGH: 'true',
    FLUVIX_NOTION_MCP_TOKEN: TOKEN,
    FLUVIX_NOTION_TOKEN: 'ntn_feedbackValue',
    FLUVIX_NOTION_DATABASE_ID: '0123456789abcdef0123456789abcdef',
    GITHUB_TOKEN: 'ghp_fictitious',
    OPENAI_API_KEY: 'sk-fictitious'
  }

  it('許可した OS の変数と、NOTION_TOKEN と、起動用の変数だけを渡す', () => {
    expect(
      createMcpServerEnvironment(MCP_SERVER_DEFINITIONS.notion, parent, TOKEN, {
        ELECTRON_RUN_AS_NODE: '1'
      })
    ).toEqual({
      Path: parent.Path,
      SystemRoot: parent.SystemRoot,
      USERPROFILE: parent.USERPROFILE,
      NOTION_TOKEN: TOKEN,
      ELECTRON_RUN_AS_NODE: '1'
    })
  })

  it('BASE_URL を引き継がない（API の接続先として読まれ、token 付きの要求がそこへ行く）', () => {
    expect(
      createMcpServerEnvironment(MCP_SERVER_DEFINITIONS.notion, parent, TOKEN)
    ).not.toHaveProperty('BASE_URL')
    expect(
      createMcpServerEnvironment(
        MCP_SERVER_DEFINITIONS.notion,
        { Path: 'C:\\Windows', base_url: '/' },
        TOKEN
      )
    ).not.toHaveProperty('base_url')
  })

  it('Notion の宣言はサーバーが設定として読む変数をすべて挙げている（2.5.1 で確認）', () => {
    expect([...NOTION_MCP_SERVER.environment(TOKEN).reservedVariables].sort()).toEqual([
      'AUTH_TOKEN',
      'BASE_URL',
      'ENABLE_TOKEN_PASSTHROUGH',
      'NOTION_TOKEN',
      'OPENAPI_MCP_HEADERS'
    ])
  })

  it('親の環境を書き換えない', () => {
    const copy = { ...parent }

    createMcpServerEnvironment(MCP_SERVER_DEFINITIONS.notion, parent, TOKEN, {
      ELECTRON_RUN_AS_NODE: '1'
    })

    expect(parent).toEqual(copy)
  })
})

describe('MCP_SERVER_DEFINITIONS', () => {
  it('どの行も、token を FLUVIX_ の変数から読み、渡す変数はすべて宣言している', () => {
    for (const id of MCP_BUILTIN_CONNECTION_IDS) {
      const definition = MCP_SERVER_DEFINITIONS[id]
      const profile = definition.environment(definition.secret === null ? null : TOKEN)
      const reserved = profile.reservedVariables.map((name) => name.toUpperCase())

      // FLUVIX_ の変数は子へ渡らない（mcpServerEnvironment.ts）ので、token の元も漏れない。
      if (definition.secret !== null) {
        expect(definition.secret.variable.startsWith('FLUVIX_')).toBe(true)
      }

      for (const name of Object.keys(profile.providedVariables)) {
        expect(reserved).toContain(name.toUpperCase())
      }

      // 作るときに投げない（宣言と値が食い違っていない）。
      expect(() =>
        createMcpServerEnvironment(MCP_SERVER_DEFINITIONS[id], { Path: 'C:\\Windows' }, TOKEN, {
          ELECTRON_RUN_AS_NODE: '1'
        })
      ).not.toThrow()
    }
  })

  it('どの行の操作表にも、書き込みには確認の文がある', () => {
    for (const id of MCP_BUILTIN_CONNECTION_IDS) {
      for (const operation of Object.values(MCP_SERVER_DEFINITIONS[id].operations)) {
        if (operation.kind === 'write') {
          expect(operation.describe).toBeTypeOf('function')
        }
      }
    }
  })
})
