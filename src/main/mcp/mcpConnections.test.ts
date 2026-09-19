import { describe, expect, it } from 'vitest'
import type { McpTransport, McpTransportClose } from './mcpClient'
import {
  createMcpConnections,
  type McpConnectionsDependencies,
  type McpWriteConfirmation
} from './mcpConnections'
import { McpRequestError } from './mcpOperations'
import type { McpStdioTransportOptions } from './mcpStdioTransport'

/**
 * MCP の接続を束ねる層（mcpConnections.ts）。
 *
 * token はテスト用の架空の値。
 */

const TOKEN = 'ntn_fictitiousTestToken0123456789'
const APP_EXE = 'C:\\Program Files\\Fluvix Nexus\\Fluvix Nexus.exe'
const RESOURCES = 'C:\\Program Files\\Fluvix Nexus\\resources\\mcp-servers'
const ENTRY = `${RESOURCES}\\notion-mcp-server\\bin\\cli.mjs`
const SYSTEM_PATH = 'C:\\Windows\\System32'

interface Harness {
  readonly deps: McpConnectionsDependencies
  readonly logs: string[]
  readonly spawned: McpStdioTransportOptions[]
  readonly terminated: () => number
  readonly closed: () => number
  readonly setEnv: (env: Record<string, string | undefined>) => void
  /** 届いた tools/call（名前と引数）。 */
  readonly toolCalls: { readonly name: unknown; readonly arguments: unknown }[]
  readonly confirmations: McpWriteConfirmation[]
}

type Behavior = 'healthy' | 'silent' | 'stderr-with-token'

interface HarnessOptions {
  /** 書き込みの確認への答え。 */
  readonly confirm?: boolean
  /** サーバーが公開するツール名。 */
  readonly tools?: readonly string[]
  /** tools/call への応答の result（既定は Notion の検索結果）。 */
  readonly toolResult?: (name: unknown) => unknown
  /** 同梱したサーバーのファイルがあるか（既定は有る）。 */
  readonly serverInstalled?: boolean
  /** tools/call に応答しない（送った後に時間切れ）。 */
  readonly silentToolCall?: boolean
}

const SEARCH_RESULT = {
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        object: 'list',
        results: [
          {
            object: 'page',
            id: '0f1e2d3c4b5a49688778695a4b3c2d1e',
            in_trash: false,
            properties: {
              title: { type: 'title', title: [{ plain_text: 'Cursor MCP 接続テスト' }] }
            }
          }
        ]
      })
    }
  ]
}

function harness(behavior: Behavior = 'healthy', setup: HarnessOptions = {}): Harness {
  const toolCalls: { readonly name: unknown; readonly arguments: unknown }[] = []
  const confirmations: McpWriteConfirmation[] = []
  const toolNames = setup.tools ?? [
    'API-post-search',
    'API-retrieve-a-page',
    'API-get-block-children',
    'API-patch-block-children'
  ]
  const logs: string[] = []
  const spawned: McpStdioTransportOptions[] = []
  let terminated = 0
  let closed = 0
  let env: Record<string, string | undefined> = {
    PATH: SYSTEM_PATH,
    FLUVIX_NOTION_MCP_TOKEN: TOKEN
  }

  function createTransport(options: McpStdioTransportOptions): McpTransport {
    spawned.push(options)

    let onData: (chunk: Buffer) => void = () => {}
    let onClose: (close: McpTransportClose) => void = () => {}
    let ended = false

    function end(): void {
      if (!ended) {
        ended = true
        onClose({ kind: 'exited', detail: 'exited with code 0.' })
      }
    }

    function reply(message: Record<string, unknown>): unknown {
      switch (message['method']) {
        case 'initialize':
          if (behavior === 'stderr-with-token') {
            options.onStderrLine?.(`request failed: Authorization: ${TOKEN}`)
          }

          return {
            jsonrpc: '2.0',
            id: message['id'],
            result: {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'Notion API', version: '2.5.1' }
            }
          }
        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id: message['id'],
            result: { tools: toolNames.map((name) => ({ name, description: name })) }
          }
        case 'tools/call': {
          const params = message['params'] as { name?: unknown; arguments?: unknown }
          toolCalls.push({ name: params.name, arguments: params.arguments })

          if (setup.silentToolCall === true) {
            return undefined
          }

          return {
            jsonrpc: '2.0',
            id: message['id'],
            result: setup.toolResult?.(params.name) ?? SEARCH_RESULT
          }
        }
        default:
          return undefined
      }
    }

    return {
      send: (line) => {
        const message = JSON.parse(line) as Record<string, unknown>

        if (behavior === 'silent') {
          return
        }

        queueMicrotask(() => {
          const response = reply(message)

          if (response !== undefined) {
            onData(Buffer.from(`${JSON.stringify(response)}\n`))
          }
        })
      },
      onData: (listener) => {
        onData = listener
      },
      onClose: (listener) => {
        onClose = listener
      },
      close: async () => {
        closed += 1
        end()
      },
      terminate: () => {
        terminated += 1
        end()
      }
    }
  }

  const deps: McpConnectionsDependencies = {
    env: () => env,
    platform: 'win32',
    exists: (path) => (setup.serverInstalled ?? true) && path.toLowerCase() === ENTRY.toLowerCase(),
    bundledPackageDirectory: (launch) => `${RESOURCES}\\${launch.bundleName}`,
    nodeRuntime: { file: APP_EXE, environment: { ELECTRON_RUN_AS_NODE: '1' } },
    cwd: () => 'C:\\Users\\dev\\AppData\\Roaming\\Fluvix Nexus',
    createTransport,
    clientInfo: { name: 'Fluvix Nexus', version: '1.0.0' },
    now: () => new Date('2026-09-19T00:00:00.000Z'),
    log: {
      debug: (message) => logs.push(`debug ${message}`),
      info: (message) => logs.push(`info ${message}`),
      warn: (message) => logs.push(`warn ${message}`)
    },
    language: () => 'ja',
    confirmWrite: async (confirmation) => {
      confirmations.push(confirmation)
      return setup.confirm ?? false
    },
    connectTimeoutMs: 30,
    requestTimeoutMs: 30
  }

  return {
    deps,
    logs,
    spawned,
    terminated: () => terminated,
    closed: () => closed,
    setEnv: (next) => {
      env = next
    },
    toolCalls,
    confirmations
  }
}

describe('getStatus', () => {
  it('起動も通信もせずに、設定が揃っているかを返す', () => {
    const h = harness()
    const status = createMcpConnections(h.deps).getStatus('notion')

    expect(status).toEqual({
      connectionId: 'notion',
      configured: true,
      problems: [],
      testing: false,
      lastTest: null
    })
    expect(h.spawned).toEqual([])
  })

  it('足りないものをすべて挙げる', () => {
    const h = harness('healthy', { serverInstalled: false })
    h.setEnv({ PATH: SYSTEM_PATH })

    expect(createMcpConnections(h.deps).getStatus('notion')).toMatchObject({
      configured: false,
      problems: ['token-missing', 'server-not-installed']
    })
  })

  it('環境変数を呼ぶたびに読み直す', () => {
    const h = harness()
    const connections = createMcpConnections(h.deps)

    h.setEnv({ PATH: SYSTEM_PATH })
    expect(connections.getStatus('notion').problems).toEqual(['token-missing'])

    h.setEnv({ PATH: SYSTEM_PATH, FLUVIX_NOTION_MCP_TOKEN: TOKEN })
    expect(connections.getStatus('notion').problems).toEqual([])
  })
})

describe('testConnection', () => {
  it('接続してツールの一覧を取り、切断する', async () => {
    const h = harness('healthy', { tools: ['API-post-search'] })
    const connections = createMcpConnections(h.deps)
    const result = await connections.testConnection('notion')

    expect(result).toEqual({
      outcome: 'connected',
      testedAt: '2026-09-19T00:00:00.000Z',
      server: { name: 'Notion API', version: '2.5.1' },
      protocolVersion: '2025-06-18',
      tools: [{ name: 'API-post-search', description: 'API-post-search' }]
    })
    expect(h.closed()).toBeGreaterThanOrEqual(1)
    expect(connections.getStatus('notion').lastTest).toEqual(result)
  })

  it('表の行どおりに起動し、token は環境変数でだけ渡す', async () => {
    const h = harness()

    await createMcpConnections(h.deps).testConnection('notion')

    const [options] = h.spawned

    expect(options?.command).toEqual({
      name: 'Notion MCP',
      file: APP_EXE,
      args: [ENTRY, '--transport', 'stdio'],
      environment: { ELECTRON_RUN_AS_NODE: '1' }
    })
    expect(options?.command.args.join(' ')).not.toContain(TOKEN)
    expect(options?.env).toEqual({
      PATH: SYSTEM_PATH,
      NOTION_TOKEN: TOKEN,
      ELECTRON_RUN_AS_NODE: '1'
    })
    expect(options?.cwd).toBe('C:\\Users\\dev\\AppData\\Roaming\\Fluvix Nexus')
  })

  it('親の環境に BASE_URL があっても、起動するサーバーへは渡さない', async () => {
    const h = harness()
    h.setEnv({
      PATH: SYSTEM_PATH,
      FLUVIX_NOTION_MCP_TOKEN: TOKEN,
      BASE_URL: '/',
      GITHUB_TOKEN: 'ghp_fictitious',
      OPENAI_API_KEY: 'sk-fictitious'
    })

    const result = await createMcpConnections(h.deps).testConnection('notion')

    expect(result.outcome).toBe('connected')
    expect(h.spawned[0]?.env).not.toHaveProperty('BASE_URL')
    expect(h.spawned[0]?.env).not.toHaveProperty('GITHUB_TOKEN')
    expect(h.spawned[0]?.env).not.toHaveProperty('OPENAI_API_KEY')
  })

  it('設定が足りなければ起動せずに not-configured', async () => {
    const h = harness()
    h.setEnv({ PATH: SYSTEM_PATH })

    expect(await createMcpConnections(h.deps).testConnection('notion')).toEqual({
      outcome: 'not-configured',
      testedAt: '2026-09-19T00:00:00.000Z',
      problems: ['token-missing']
    })
    expect(h.spawned).toEqual([])
  })

  it('繋がらなければ failed で、経路は閉じる', async () => {
    const h = harness('silent')

    expect(await createMcpConnections(h.deps).testConnection('notion')).toEqual({
      outcome: 'failed',
      testedAt: '2026-09-19T00:00:00.000Z',
      failure: 'timeout'
    })
    expect(h.closed()).toBeGreaterThanOrEqual(1)
  })

  it('テスト中にもう一度呼ばれても、サーバーは1本しか立てない', async () => {
    const h = harness()
    const connections = createMcpConnections(h.deps)
    const first = connections.testConnection('notion')
    const second = connections.testConnection('notion')

    expect(connections.getStatus('notion').testing).toBe(true)
    expect(await second).toEqual(await first)
    expect(h.spawned).toHaveLength(1)
    expect(connections.getStatus('notion').testing).toBe(false)
  })

  it('サーバーの stderr に出た token はログへ出る前に伏せる', async () => {
    const h = harness('stderr-with-token')

    await createMcpConnections(h.deps).testConnection('notion')

    expect(h.logs.join('\n')).not.toContain(TOKEN)
    expect(h.logs).toContain('debug Notion MCP stderr: request failed: Authorization: <redacted>')
  })

  it('結果にもログにも token が現れない', async () => {
    const h = harness()
    const result = await createMcpConnections(h.deps).testConnection('notion')

    expect(JSON.stringify(result)).not.toContain(TOKEN)
    expect(h.logs.join('\n')).not.toContain(TOKEN)
  })
})

describe('terminateAll', () => {
  it('テスト中のサーバーを待たずに終わらせる', async () => {
    const h = harness('silent')
    const connections = createMcpConnections(h.deps)
    const testing = connections.testConnection('notion')

    connections.terminateAll()

    expect(h.terminated()).toBe(1)
    expect(await testing).toMatchObject({ outcome: 'failed', failure: 'server-exited' })
  })

  it('何も動いていなければ何もしない', () => {
    const h = harness()

    createMcpConnections(h.deps).terminateAll()

    expect(h.terminated()).toBe(0)
  })
})

describe('callOperation', () => {
  const PAGE_ID = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e'
  const WRITE_TEXT = 'FluvixNexus MCP 書き込みテスト成功'

  it('読み取りの操作は確認なしで、表のツールと組み立て直した引数で呼ぶ', async () => {
    const h = harness()
    const result = await createMcpConnections(h.deps).callOperation('notion', 'search-pages', {
      query: '  Cursor MCP 接続テスト  '
    })

    expect(result).toEqual({
      outcome: 'completed',
      operation: 'search-pages',
      data: { pages: [{ id: PAGE_ID, title: 'Cursor MCP 接続テスト', inTrash: false }] }
    })
    expect(h.confirmations).toEqual([])
    expect(h.toolCalls).toEqual([
      {
        name: 'API-post-search',
        arguments: {
          query: 'Cursor MCP 接続テスト',
          filter: { property: 'object', value: 'page' },
          page_size: 10
        }
      }
    ])
  })

  it('知らない操作名は McpRequestError で、サーバーを起動しない', async () => {
    const h = harness()
    const connections = createMcpConnections(h.deps)

    for (const name of ['API-delete-a-block', 'toString', '__proto__', '']) {
      await expect(connections.callOperation('notion', name, {})).rejects.toBeInstanceOf(
        McpRequestError
      )
    }

    expect(h.spawned).toEqual([])
  })

  it('壊れた引数は McpRequestError で、サーバーを起動しない', async () => {
    const h = harness()
    const connections = createMcpConnections(h.deps)

    await expect(
      connections.callOperation('notion', 'get-page', { pageId: '../users' })
    ).rejects.toBeInstanceOf(McpRequestError)
    await expect(
      connections.callOperation('notion', 'search-pages', { query: 'x', tool: 'API-delete' })
    ).rejects.toBeInstanceOf(McpRequestError)

    expect(h.spawned).toEqual([])
  })

  it('書き込みは起動する前に確かめ、断られたら何も起動しない', async () => {
    const h = harness('healthy', { confirm: false })
    const result = await createMcpConnections(h.deps).callOperation('notion', 'append-paragraph', {
      pageId: PAGE_ID,
      text: WRITE_TEXT
    })

    expect(result).toEqual({ outcome: 'declined', operation: 'append-paragraph' })
    expect(h.confirmations).toEqual([
      {
        connectionId: 'notion',
        operation: 'append-paragraph',
        title: 'Notion のページに段落を追記します',
        detail: expect.stringContaining(WRITE_TEXT)
      }
    ])
    expect(h.spawned).toEqual([])
    expect(h.toolCalls).toEqual([])
  })

  it('確認で実行を選ぶと、末尾への追記だけを送る', async () => {
    const h = harness('healthy', {
      confirm: true,
      toolResult: () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              object: 'list',
              results: [{ object: 'block', id: '11111111-2222-3333-4444-555555555555' }]
            })
          }
        ]
      })
    })
    const result = await createMcpConnections(h.deps).callOperation('notion', 'append-paragraph', {
      pageId: PAGE_ID,
      text: WRITE_TEXT
    })

    expect(result).toEqual({
      outcome: 'completed',
      operation: 'append-paragraph',
      data: { pageId: PAGE_ID, appendedBlockIds: ['11111111-2222-3333-4444-555555555555'] }
    })
    expect(h.toolCalls).toEqual([
      {
        name: 'API-patch-block-children',
        arguments: {
          block_id: PAGE_ID,
          children: [
            {
              type: 'paragraph',
              paragraph: { rich_text: [{ type: 'text', text: { content: WRITE_TEXT } }] }
            }
          ]
        }
      }
    ])
  })

  it('ログに操作の引数（本文）も token も書かない', async () => {
    const h = harness('healthy', { confirm: true })

    await createMcpConnections(h.deps).callOperation('notion', 'append-paragraph', {
      pageId: PAGE_ID,
      text: 'secret-looking body text'
    })

    expect(h.logs.join('\n')).not.toContain('secret-looking body text')
    expect(h.logs.join('\n')).not.toContain(TOKEN)
  })

  it('サーバーがツールを公開していなければ tool-unavailable で、呼ばない', async () => {
    const h = harness('healthy', { tools: ['API-get-self'] })
    const result = await createMcpConnections(h.deps).callOperation('notion', 'get-page', {
      pageId: PAGE_ID
    })

    expect(result).toMatchObject({ outcome: 'failed', failure: 'tool-unavailable' })
    expect(h.toolCalls).toEqual([])
  })

  it('ツールの失敗は tool-error で、番号と分類だけを返す', async () => {
    const h = harness('healthy', {
      toolResult: () => ({
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              object: 'error',
              status: 404,
              code: 'object_not_found',
              message: 'Could not find page with ID ...'
            })
          }
        ]
      })
    })
    const result = await createMcpConnections(h.deps).callOperation('notion', 'get-page', {
      pageId: PAGE_ID
    })

    expect(result).toEqual({
      outcome: 'failed',
      operation: 'get-page',
      failure: 'tool-error',
      toolError: { status: 404, code: 'object_not_found' }
    })
  })

  it('結果が読めなければ invalid-result', async () => {
    const h = harness('healthy', {
      toolResult: () => ({ content: [{ type: 'text', text: 'not json' }] })
    })

    expect(
      await createMcpConnections(h.deps).callOperation('notion', 'get-page', { pageId: PAGE_ID })
    ).toMatchObject({ outcome: 'failed', failure: 'invalid-result' })
  })

  it('設定が足りなければ起動も確認もせずに not-configured', async () => {
    const h = harness('healthy', { confirm: true, serverInstalled: false })
    h.setEnv({ PATH: SYSTEM_PATH })

    expect(
      await createMcpConnections(h.deps).callOperation('notion', 'append-paragraph', {
        pageId: PAGE_ID,
        text: 'x'
      })
    ).toEqual({
      outcome: 'not-configured',
      operation: 'append-paragraph',
      problems: ['token-missing', 'server-not-installed']
    })
    expect(h.confirmations).toEqual([])
    expect(h.spawned).toEqual([])
  })

  it('同じ接続の操作は1つずつ実行する（サーバーを同時に2本立てない）', async () => {
    const h = harness()
    let running = 0
    let maxRunning = 0
    const serial = createMcpConnections({
      ...h.deps,
      createTransport: (options) => {
        running += 1
        maxRunning = Math.max(maxRunning, running)
        const transport = h.deps.createTransport(options)

        return {
          ...transport,
          close: async () => {
            await transport.close()
            running -= 1
          }
        }
      }
    })

    const results = await Promise.all([
      serial.callOperation('notion', 'search-pages', { query: 'a' }),
      serial.callOperation('notion', 'search-pages', { query: 'b' }),
      serial.callOperation('notion', 'search-pages', { query: 'c' })
    ])

    expect(results.map((result) => result.outcome)).toEqual(['completed', 'completed', 'completed'])
    expect(maxRunning).toBe(1)
  })

  it('前の操作が壊れた要求で失敗しても、次の操作は動く', async () => {
    const h = harness()
    const connections = createMcpConnections(h.deps)
    const broken = connections.callOperation('notion', 'unknown-operation', {})
    const next = connections.callOperation('notion', 'search-pages', { query: 'a' })

    await expect(broken).rejects.toBeInstanceOf(McpRequestError)
    expect((await next).outcome).toBe('completed')
  })

  it('isError の付かない API のエラー（Notion MCP サーバーの返し方）も tool-error にする', async () => {
    const h = harness('healthy', {
      toolResult: () => ({
        // 架空の token で実物に送ったときの形（isError 無し・本文に status / code）。
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 401,
              object: 'error',
              code: 'unauthorized',
              message: 'API token is invalid.'
            })
          }
        ]
      })
    })

    expect(
      await createMcpConnections(h.deps).callOperation('notion', 'get-page', { pageId: PAGE_ID })
    ).toEqual({
      outcome: 'failed',
      operation: 'get-page',
      failure: 'tool-error',
      toolError: { status: 401, code: 'unauthorized' }
    })
  })

  it('書き込みを送った後に時間切れになったら outcome-unknown（押し直すと二重に書きうる）', async () => {
    const h = harness('healthy', { confirm: true, silentToolCall: true })
    const result = await createMcpConnections(h.deps).callOperation('notion', 'append-paragraph', {
      pageId: PAGE_ID,
      text: WRITE_TEXT
    })

    expect(h.toolCalls).toHaveLength(1)
    expect(result).toEqual({
      outcome: 'failed',
      operation: 'append-paragraph',
      failure: 'outcome-unknown',
      toolError: null
    })
  })

  it('読み取りの時間切れは timeout のまま（押し直して困ることが無い）', async () => {
    const h = harness('healthy', { silentToolCall: true })

    expect(
      await createMcpConnections(h.deps).callOperation('notion', 'get-page', { pageId: PAGE_ID })
    ).toMatchObject({ outcome: 'failed', failure: 'timeout' })
  })

  it('書き込みで Notion がエラーを返したら tool-error（反映されていないと分かる）', async () => {
    const h = harness('healthy', {
      confirm: true,
      toolResult: () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ object: 'error', status: 403, code: 'restricted_resource' })
          }
        ]
      })
    })

    expect(
      await createMcpConnections(h.deps).callOperation('notion', 'append-paragraph', {
        pageId: PAGE_ID,
        text: WRITE_TEXT
      })
    ).toMatchObject({ failure: 'tool-error', toolError: { status: 403 } })
  })

  it('書き込みの結果が読めなければ outcome-unknown', async () => {
    const h = harness('healthy', {
      confirm: true,
      toolResult: () => ({ content: [{ type: 'text', text: 'not json' }] })
    })

    expect(
      await createMcpConnections(h.deps).callOperation('notion', 'append-paragraph', {
        pageId: PAGE_ID,
        text: WRITE_TEXT
      })
    ).toMatchObject({ failure: 'outcome-unknown' })
  })
})
