import { describe, expect, it } from 'vitest'
import type { McpTransport, McpTransportClose } from './mcpClient'
import {
  createMcpConnections,
  type McpConnectionsDependencies,
  type McpWriteConfirmation
} from './mcpConnections'
import { createMcpCustomServerDefinition } from './mcpCustomServerDefinition'
import { isRecord } from './mcpMessage'
import {
  defineMcpOperation,
  McpRequestError,
  readArgumentObject,
  readJsonTextContent,
  readStringArgument,
  type McpArgumentsParse
} from './mcpOperations'
import type { McpServerDefinition } from './mcpServerDefinition'
import type { McpStdioTransportOptions } from './mcpStdioTransport'

/**
 * MCP の接続を束ねる層（mcpConnections.ts）。
 *
 * 題材は MCP Server Manager に登録したサーバー（mcpCustomServerDefinition.ts が
 * 登録簿の行から作る定義）。操作（callOperation）は、登録したサーバーの定義に
 * テスト用の操作表を足したもので確かめる ── 今は操作表を持つサーバーが無いが、
 * ツール呼び出しの手続き（tool-unavailable・outcome-unknown など）は将来の
 * 呼び手（MCP Gateway）のために残してある。
 *
 * 秘密の値はテスト用の架空のもの。
 */

const SECRET = 'ghp_fictitiousTestSecret0123456789'
const SYSTEM_PATH = 'C:\\Windows\\System32'
const SERVER_ID = 'custom-0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e'
const UNREGISTERED_ID = 'custom-11111111-2222-4333-8444-555555555555'
const SERVER_EXE = 'C:\\tools\\example-server.exe'
const ITEM_ID = 'item-42'
const NOTE_TEXT = 'Fluvix Nexus MCP 書き込みテスト'

/* ------------------------------------------------------------------ テスト用の操作表 */

function parseItem(raw: unknown): McpArgumentsParse<{ readonly id: string }> {
  const args = readArgumentObject(raw, ['id'])

  if (!args.ok) {
    return args
  }

  const id = readStringArgument(args.value, 'id', { minLength: 1, maxLength: 64, multiline: false })

  return id.ok ? { ok: true, value: { id: id.value } } : id
}

function parseNote(
  raw: unknown
): McpArgumentsParse<{ readonly id: string; readonly text: string }> {
  const args = readArgumentObject(raw, ['id', 'text'])

  if (!args.ok) {
    return args
  }

  const id = readStringArgument(args.value, 'id', { minLength: 1, maxLength: 64, multiline: false })

  if (!id.ok) {
    return id
  }

  const text = readStringArgument(args.value, 'text', {
    minLength: 1,
    maxLength: 200,
    multiline: true
  })

  return text.ok ? { ok: true, value: { id: id.value, text: text.value } } : text
}

/** 本文に `{ object: 'error', status, code }` が入っていれば失敗（`isError` の無いサーバーの返し方）。 */
function readExampleError(
  result: Parameters<typeof readJsonTextContent>[0]
): { status: number | null; code: string | null } | null {
  const json = readJsonTextContent(result)

  if (!isRecord(json) || json['object'] !== 'error') {
    return null
  }

  return {
    status: typeof json['status'] === 'number' ? json['status'] : null,
    code: typeof json['code'] === 'string' ? json['code'] : null
  }
}

const OPERATIONS = {
  'get-item': defineMcpOperation<{ readonly id: string }>({
    kind: 'read',
    tool: 'example-get-item',
    parseArguments: parseItem,
    toolArguments: (args) => ({ item_id: args.id }),
    readResult: (result) => {
      const json = readJsonTextContent(result)
      return isRecord(json) && typeof json['id'] === 'string' ? { id: json['id'] } : null
    },
    readToolError: readExampleError
  }),
  'append-note': defineMcpOperation<{ readonly id: string; readonly text: string }>({
    kind: 'write',
    tool: 'example-append-note',
    parseArguments: parseNote,
    toolArguments: (args) => ({ item_id: args.id, note: args.text }),
    readResult: (result, args) => {
      const json = readJsonTextContent(result)
      return isRecord(json) && typeof json['noteId'] === 'string'
        ? { id: args.id, noteId: json['noteId'] }
        : null
    },
    readToolError: readExampleError,
    describe: (args) => ({ title: 'ノートを追記します', detail: args.text })
  })
}

const ITEM_RESULT = { content: [{ type: 'text', text: JSON.stringify({ id: ITEM_ID }) }] }

/* ------------------------------------------------------------------ 足場 */

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

type Behavior = 'healthy' | 'silent' | 'stderr-with-secret'

interface HarnessOptions {
  /** 書き込みの確認への答え。 */
  readonly confirm?: boolean
  /** サーバーが公開するツール名。 */
  readonly tools?: readonly string[]
  /** tools/call への応答の result（既定は get-item の結果）。 */
  readonly toolResult?: (name: unknown) => unknown
  /** tools/call に応答しない（送った後に時間切れ）。 */
  readonly silentToolCall?: boolean
  /** Settings と登録簿の両方で有効にしてあるか（既定は有効）。 */
  readonly enabled?: boolean
  /** 秘密の環境変数の値（null で「読めない」）。 */
  readonly secret?: string | null
  /** 在ると見なす実行ファイル（既定はサーバーの Command だけ）。 */
  readonly existingFiles?: readonly string[]
  /** 定義に操作表を付けるか（既定は付けない ── 登録したサーバーそのまま）。 */
  readonly withOperations?: boolean
}

/** MCP Server Manager に登録したサーバー1つ分の定義（登録簿の行から作る）。 */
function registeredServer(secret: string | null, withOperations: boolean): McpServerDefinition {
  const definition = createMcpCustomServerDefinition(
    {
      id: SERVER_ID,
      name: 'Example Server',
      enabled: true,
      transport: { kind: 'stdio', command: SERVER_EXE, args: ['--stdio', 'C:\\My Files'] },
      env: [
        { name: 'EXAMPLE_REGION', secret: false, value: 'ap-northeast-1' },
        { name: 'EXAMPLE_API_KEY', secret: true }
      ]
    },
    () => secret
  )

  return withOperations ? { ...definition, operations: OPERATIONS } : definition
}

function harness(behavior: Behavior = 'healthy', setup: HarnessOptions = {}): Harness {
  const toolCalls: { readonly name: unknown; readonly arguments: unknown }[] = []
  const confirmations: McpWriteConfirmation[] = []
  const toolNames = setup.tools ?? ['example-get-item', 'example-append-note']
  const logs: string[] = []
  const spawned: McpStdioTransportOptions[] = []
  const definition = registeredServer(
    setup.secret === undefined ? SECRET : setup.secret,
    setup.withOperations ?? false
  )
  let terminated = 0
  let closed = 0
  let env: Record<string, string | undefined> = { PATH: SYSTEM_PATH, SystemRoot: 'C:\\Windows' }

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
          if (behavior === 'stderr-with-secret') {
            options.onStderrLine?.(`request failed: Authorization: ${SECRET}`)
          }

          return {
            jsonrpc: '2.0',
            id: message['id'],
            result: {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'example-server', version: '1.2.3' }
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
            result: setup.toolResult?.(params.name) ?? ITEM_RESULT
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

  const existing = setup.existingFiles ?? [SERVER_EXE]

  const deps: McpConnectionsDependencies = {
    env: () => env,
    platform: 'win32',
    exists: (path) => existing.some((file) => file.toLowerCase() === path.toLowerCase()),
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
    isEnabled: () => setup.enabled ?? true,
    definitionOf: (id) => (id === SERVER_ID ? definition : null),
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

/* ------------------------------------------------------------------ 状態 */

describe('getStatus', () => {
  it('起動も通信もせずに、設定が揃っているかを返す', () => {
    const h = harness()
    const status = createMcpConnections(h.deps).getStatus(SERVER_ID)

    expect(status).toEqual({
      connectionId: SERVER_ID,
      configured: true,
      problems: [],
      enabled: true,
      testing: false,
      lastTest: null
    })
    expect(h.spawned).toEqual([])
  })

  it('足りないものをすべて挙げる', () => {
    const h = harness('healthy', { secret: null, existingFiles: [] })

    expect(createMcpConnections(h.deps).getStatus(SERVER_ID)).toMatchObject({
      configured: false,
      problems: ['secret-missing', 'command-not-found']
    })
  })

  it('環境変数を呼ぶたびに読み直す（名前だけの Command は PATH を辿る）', () => {
    const h = harness('healthy', { existingFiles: ['C:\\tools\\bin\\example-server.exe'] })
    const connections = createMcpConnections({
      ...h.deps,
      definitionOf: (id) =>
        id === SERVER_ID
          ? {
              ...registeredServer(SECRET, false),
              launch: {
                kind: 'user-command',
                name: 'Example Server',
                command: 'example-server',
                args: []
              }
            }
          : null
    })

    expect(connections.getStatus(SERVER_ID).problems).toEqual(['command-not-found'])

    h.setEnv({ PATH: `${SYSTEM_PATH};C:\\tools\\bin`, SystemRoot: 'C:\\Windows' })
    expect(connections.getStatus(SERVER_ID).problems).toEqual([])
  })

  it('登録簿に無い id は McpRequestError（呼び手の不具合）', async () => {
    const connections = createMcpConnections(harness().deps)

    expect(() => connections.getStatus(UNREGISTERED_ID)).toThrow(McpRequestError)
    await expect(connections.testConnection(UNREGISTERED_ID)).rejects.toThrow(McpRequestError)
  })
})

describe('有効 / 無効（全体の元栓とサーバーの栓）', () => {
  it('無効なら、ほかに何が足りていても理由は disabled だけ', () => {
    const h = harness('healthy', { enabled: false, secret: null, existingFiles: [] })

    expect(createMcpConnections(h.deps).getStatus(SERVER_ID)).toMatchObject({
      configured: false,
      enabled: false,
      problems: ['disabled']
    })
  })

  it('無効なら、接続テストはサーバーを起動しない', async () => {
    const h = harness('healthy', { enabled: false })
    const result = await createMcpConnections(h.deps).testConnection(SERVER_ID)

    expect(result).toMatchObject({ outcome: 'not-configured', problems: ['disabled'] })
    expect(h.spawned).toEqual([])
  })

  it('無効なら、操作は起動も確認もせずに断る', async () => {
    const h = harness('healthy', { enabled: false, confirm: true, withOperations: true })

    const result = await createMcpConnections(h.deps).callOperation(SERVER_ID, 'append-note', {
      id: ITEM_ID,
      text: 'x'
    })

    expect(result).toMatchObject({ outcome: 'not-configured', problems: ['disabled'] })
    expect(h.spawned).toEqual([])
    /* 無効なものに「書き込んでよいか」を訊ねない。 */
    expect(h.confirmations).toEqual([])
  })

  it('有効かどうかは呼ぶたびに読み直す', () => {
    let enabled = false
    const h = harness()
    const connections = createMcpConnections({ ...h.deps, isEnabled: () => enabled })

    expect(connections.getStatus(SERVER_ID).problems).toEqual(['disabled'])

    enabled = true
    expect(connections.getStatus(SERVER_ID).problems).toEqual([])
  })
})

/* ------------------------------------------------------------------ 接続テスト */

describe('testConnection', () => {
  it('接続してツールの一覧を取り、切断する', async () => {
    const h = harness('healthy', { tools: ['example-get-item'] })
    const connections = createMcpConnections(h.deps)
    const result = await connections.testConnection(SERVER_ID)

    expect(result).toEqual({
      outcome: 'connected',
      testedAt: '2026-09-19T00:00:00.000Z',
      server: { name: 'example-server', version: '1.2.3' },
      protocolVersion: '2025-06-18',
      tools: [{ name: 'example-get-item', description: 'example-get-item' }]
    })
    expect(h.closed()).toBeGreaterThanOrEqual(1)
    expect(connections.getStatus(SERVER_ID).lastTest).toEqual(result)
  })

  it('公開されたツールをすべて数える（GitHub MCP の 45 個のように多くても落とさない）', async () => {
    const tools = Array.from({ length: 45 }, (_, index) => `tool_${index}`)
    const h = harness('healthy', { tools })
    const result = await createMcpConnections(h.deps).testConnection(SERVER_ID)

    expect(result.outcome === 'connected' ? result.tools.length : null).toBe(45)
  })

  it('Command と引数を配列のまま起動し、登録した変数と共通の許可だけを渡す', async () => {
    const h = harness()
    h.setEnv({
      PATH: SYSTEM_PATH,
      SystemRoot: 'C:\\Windows',
      FLUVIX_NOTION_MCP_TOKEN: 'ntn_fictitious',
      GITHUB_TOKEN: 'ghp_parent',
      OPENAI_API_KEY: 'sk-fictitious',
      BASE_URL: '/',
      EXAMPLE_REGION: 'parent-value'
    })

    const result = await createMcpConnections(h.deps).testConnection(SERVER_ID)
    const [options] = h.spawned

    expect(result.outcome).toBe('connected')
    expect(options?.command).toEqual({
      name: 'Example Server',
      file: SERVER_EXE,
      args: ['--stdio', 'C:\\My Files'],
      environment: {},
      killTreeWith: 'C:\\Windows\\System32\\taskkill.exe'
    })
    /*
      親の秘密情報（GITHUB_TOKEN・FLUVIX_*）はどれも渡らない。登録した名前は
      親の値ではなく、登録した値になる。秘密の値は引数ではなく環境変数でだけ渡す。
    */
    expect(options?.env).toEqual({
      PATH: SYSTEM_PATH,
      SystemRoot: 'C:\\Windows',
      EXAMPLE_REGION: 'ap-northeast-1',
      EXAMPLE_API_KEY: SECRET
    })
    expect(options?.command.args.join(' ')).not.toContain(SECRET)
    expect(options?.cwd).toBe('C:\\Users\\dev\\AppData\\Roaming\\Fluvix Nexus')
  })

  it('秘密の値が読めなければ、起動せずに secret-missing', async () => {
    const h = harness('healthy', { secret: null })

    expect(await createMcpConnections(h.deps).testConnection(SERVER_ID)).toEqual({
      outcome: 'not-configured',
      testedAt: '2026-09-19T00:00:00.000Z',
      problems: ['secret-missing']
    })
    expect(h.spawned).toEqual([])
  })

  it('Command が見つからなければ、起動せずに command-not-found', async () => {
    const h = harness('healthy', { existingFiles: [] })

    expect(await createMcpConnections(h.deps).testConnection(SERVER_ID)).toMatchObject({
      outcome: 'not-configured',
      problems: ['command-not-found']
    })
    expect(h.spawned).toEqual([])
  })

  it('繋がらなければ failed で、経路は閉じる', async () => {
    const h = harness('silent')

    expect(await createMcpConnections(h.deps).testConnection(SERVER_ID)).toEqual({
      outcome: 'failed',
      testedAt: '2026-09-19T00:00:00.000Z',
      failure: 'timeout'
    })
    expect(h.closed()).toBeGreaterThanOrEqual(1)
  })

  it('テスト中にもう一度呼ばれても、サーバーは1本しか立てない', async () => {
    const h = harness()
    const connections = createMcpConnections(h.deps)
    const first = connections.testConnection(SERVER_ID)
    const second = connections.testConnection(SERVER_ID)

    expect(connections.getStatus(SERVER_ID).testing).toBe(true)
    expect(await second).toEqual(await first)
    expect(h.spawned).toHaveLength(1)
    expect(connections.getStatus(SERVER_ID).testing).toBe(false)
  })

  /*
    登録を変えた後に、前の設定での結末が残らないこと。秘密の値を入れ替えても
    「接続できました」が残ったままだと、前の資格情報での結果を今の結果として読む。
  */
  it('forgetLastTest で、前の設定での結末を忘れる', async () => {
    const h = harness()
    const connections = createMcpConnections(h.deps)

    await connections.testConnection(SERVER_ID)
    expect(connections.getStatus(SERVER_ID).lastTest).toMatchObject({ outcome: 'connected' })

    connections.forgetLastTest(SERVER_ID)

    expect(connections.getStatus(SERVER_ID).lastTest).toBeNull()
  })

  it('サーバーの stderr に出た秘密の値はログへ出る前に伏せる', async () => {
    const h = harness('stderr-with-secret')

    await createMcpConnections(h.deps).testConnection(SERVER_ID)

    expect(h.logs.join('\n')).not.toContain(SECRET)
    expect(h.logs).toContain(
      'debug Example Server stderr: request failed: Authorization: <redacted>'
    )
  })

  it('結果にもログにも秘密の値が現れない', async () => {
    const h = harness()
    const result = await createMcpConnections(h.deps).testConnection(SERVER_ID)

    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(h.logs.join('\n')).not.toContain(SECRET)
  })
})

describe('terminateAll', () => {
  it('テスト中のサーバーを待たずに終わらせる', async () => {
    const h = harness('silent')
    const connections = createMcpConnections(h.deps)
    const testing = connections.testConnection(SERVER_ID)

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

/* ------------------------------------------------------------------ 操作（Main の中だけの口） */

describe('callOperation', () => {
  it('登録したサーバーは操作表を持たないので、ツールは呼べない（サーバーも起動しない）', async () => {
    const h = harness()

    await expect(
      createMcpConnections(h.deps).callOperation(SERVER_ID, 'get-item', { id: ITEM_ID })
    ).rejects.toThrow(McpRequestError)
    expect(h.spawned).toEqual([])
  })

  it('読み取りの操作は確認なしで、表のツールと組み立て直した引数で呼ぶ', async () => {
    const h = harness('healthy', { withOperations: true })
    const result = await createMcpConnections(h.deps).callOperation(SERVER_ID, 'get-item', {
      id: `  ${ITEM_ID}  `
    })

    expect(result).toEqual({ outcome: 'completed', operation: 'get-item', data: { id: ITEM_ID } })
    expect(h.confirmations).toEqual([])
    expect(h.toolCalls).toEqual([{ name: 'example-get-item', arguments: { item_id: ITEM_ID } }])
  })

  it('知らない操作名は McpRequestError で、サーバーを起動しない', async () => {
    const h = harness('healthy', { withOperations: true })
    const connections = createMcpConnections(h.deps)

    for (const name of ['example-get-item', 'toString', '__proto__', '']) {
      await expect(connections.callOperation(SERVER_ID, name, {})).rejects.toBeInstanceOf(
        McpRequestError
      )
    }

    expect(h.spawned).toEqual([])
  })

  it('壊れた引数は McpRequestError で、サーバーを起動しない', async () => {
    const h = harness('healthy', { withOperations: true })
    const connections = createMcpConnections(h.deps)

    await expect(
      connections.callOperation(SERVER_ID, 'get-item', { id: '' })
    ).rejects.toBeInstanceOf(McpRequestError)
    await expect(
      connections.callOperation(SERVER_ID, 'get-item', { id: ITEM_ID, tool: 'example-delete' })
    ).rejects.toBeInstanceOf(McpRequestError)

    expect(h.spawned).toEqual([])
  })

  it('書き込みは起動する前に確かめ、断られたら何も起動しない', async () => {
    const h = harness('healthy', { confirm: false, withOperations: true })
    const result = await createMcpConnections(h.deps).callOperation(SERVER_ID, 'append-note', {
      id: ITEM_ID,
      text: NOTE_TEXT
    })

    expect(result).toEqual({ outcome: 'declined', operation: 'append-note' })
    expect(h.confirmations).toEqual([
      {
        connectionId: SERVER_ID,
        operation: 'append-note',
        title: 'ノートを追記します',
        detail: NOTE_TEXT
      }
    ])
    expect(h.spawned).toEqual([])
    expect(h.toolCalls).toEqual([])
  })

  it('確認で実行を選ぶと、表のツールだけを送る', async () => {
    const h = harness('healthy', {
      confirm: true,
      withOperations: true,
      toolResult: () => ({ content: [{ type: 'text', text: JSON.stringify({ noteId: 'n-1' }) }] })
    })
    const result = await createMcpConnections(h.deps).callOperation(SERVER_ID, 'append-note', {
      id: ITEM_ID,
      text: NOTE_TEXT
    })

    expect(result).toEqual({
      outcome: 'completed',
      operation: 'append-note',
      data: { id: ITEM_ID, noteId: 'n-1' }
    })
    expect(h.toolCalls).toEqual([
      { name: 'example-append-note', arguments: { item_id: ITEM_ID, note: NOTE_TEXT } }
    ])
  })

  it('ログに操作の引数（本文）も秘密の値も書かない', async () => {
    const h = harness('healthy', {
      confirm: true,
      withOperations: true,
      toolResult: () => ({ content: [{ type: 'text', text: JSON.stringify({ noteId: 'n-1' }) }] })
    })

    await createMcpConnections(h.deps).callOperation(SERVER_ID, 'append-note', {
      id: ITEM_ID,
      text: 'secret-looking body text'
    })

    expect(h.logs.join('\n')).not.toContain('secret-looking body text')
    expect(h.logs.join('\n')).not.toContain(SECRET)
  })

  it('サーバーがツールを公開していなければ tool-unavailable で、呼ばない', async () => {
    const h = harness('healthy', { tools: ['example-other'], withOperations: true })
    const result = await createMcpConnections(h.deps).callOperation(SERVER_ID, 'get-item', {
      id: ITEM_ID
    })

    expect(result).toMatchObject({ outcome: 'failed', failure: 'tool-unavailable' })
    expect(h.toolCalls).toEqual([])
  })

  it('ツールの失敗は tool-error で、番号と分類だけを返す', async () => {
    const h = harness('healthy', {
      withOperations: true,
      toolResult: () => ({
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              object: 'error',
              status: 404,
              code: 'object_not_found',
              message: 'Could not find item with ID ...'
            })
          }
        ]
      })
    })
    const result = await createMcpConnections(h.deps).callOperation(SERVER_ID, 'get-item', {
      id: ITEM_ID
    })

    expect(result).toEqual({
      outcome: 'failed',
      operation: 'get-item',
      failure: 'tool-error',
      toolError: { status: 404, code: 'object_not_found' }
    })
  })

  it('isError の付かない API のエラーも、操作が失敗と読めば tool-error にする', async () => {
    const h = harness('healthy', {
      withOperations: true,
      toolResult: () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ status: 401, object: 'error', code: 'unauthorized' })
          }
        ]
      })
    })

    expect(
      await createMcpConnections(h.deps).callOperation(SERVER_ID, 'get-item', { id: ITEM_ID })
    ).toEqual({
      outcome: 'failed',
      operation: 'get-item',
      failure: 'tool-error',
      toolError: { status: 401, code: 'unauthorized' }
    })
  })

  it('結果が読めなければ invalid-result', async () => {
    const h = harness('healthy', {
      withOperations: true,
      toolResult: () => ({ content: [{ type: 'text', text: 'not json' }] })
    })

    expect(
      await createMcpConnections(h.deps).callOperation(SERVER_ID, 'get-item', { id: ITEM_ID })
    ).toMatchObject({ outcome: 'failed', failure: 'invalid-result' })
  })

  it('設定が足りなければ起動も確認もせずに not-configured', async () => {
    const h = harness('healthy', {
      confirm: true,
      withOperations: true,
      secret: null,
      existingFiles: []
    })

    expect(
      await createMcpConnections(h.deps).callOperation(SERVER_ID, 'append-note', {
        id: ITEM_ID,
        text: 'x'
      })
    ).toEqual({
      outcome: 'not-configured',
      operation: 'append-note',
      problems: ['secret-missing', 'command-not-found']
    })
    expect(h.confirmations).toEqual([])
    expect(h.spawned).toEqual([])
  })

  it('同じ接続の操作は1つずつ実行する（サーバーを同時に2本立てない）', async () => {
    const h = harness('healthy', { withOperations: true })
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
      serial.callOperation(SERVER_ID, 'get-item', { id: 'a' }),
      serial.callOperation(SERVER_ID, 'get-item', { id: 'b' }),
      serial.callOperation(SERVER_ID, 'get-item', { id: 'c' })
    ])

    expect(results.map((result) => result.outcome)).toEqual(['completed', 'completed', 'completed'])
    expect(maxRunning).toBe(1)
  })

  it('前の操作が壊れた要求で失敗しても、次の操作は動く', async () => {
    const h = harness('healthy', { withOperations: true })
    const connections = createMcpConnections(h.deps)
    const broken = connections.callOperation(SERVER_ID, 'unknown-operation', {})
    const next = connections.callOperation(SERVER_ID, 'get-item', { id: ITEM_ID })

    await expect(broken).rejects.toBeInstanceOf(McpRequestError)
    expect((await next).outcome).toBe('completed')
  })

  it('書き込みを送った後に時間切れになったら outcome-unknown（やり直すと二重に書きうる）', async () => {
    const h = harness('healthy', { confirm: true, withOperations: true, silentToolCall: true })
    const result = await createMcpConnections(h.deps).callOperation(SERVER_ID, 'append-note', {
      id: ITEM_ID,
      text: NOTE_TEXT
    })

    expect(h.toolCalls).toHaveLength(1)
    expect(result).toEqual({
      outcome: 'failed',
      operation: 'append-note',
      failure: 'outcome-unknown',
      toolError: null
    })
  })

  it('読み取りの時間切れは timeout のまま（やり直して困ることが無い）', async () => {
    const h = harness('healthy', { withOperations: true, silentToolCall: true })

    expect(
      await createMcpConnections(h.deps).callOperation(SERVER_ID, 'get-item', { id: ITEM_ID })
    ).toMatchObject({ outcome: 'failed', failure: 'timeout' })
  })

  it('書き込みで相手がエラーを返したら tool-error（反映されていないと分かる）', async () => {
    const h = harness('healthy', {
      confirm: true,
      withOperations: true,
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
      await createMcpConnections(h.deps).callOperation(SERVER_ID, 'append-note', {
        id: ITEM_ID,
        text: NOTE_TEXT
      })
    ).toMatchObject({ failure: 'tool-error', toolError: { status: 403 } })
  })

  it('書き込みの結果が読めなければ outcome-unknown', async () => {
    const h = harness('healthy', {
      confirm: true,
      withOperations: true,
      toolResult: () => ({ content: [{ type: 'text', text: 'not json' }] })
    })

    expect(
      await createMcpConnections(h.deps).callOperation(SERVER_ID, 'append-note', {
        id: ITEM_ID,
        text: NOTE_TEXT
      })
    ).toMatchObject({ failure: 'outcome-unknown' })
  })
})
