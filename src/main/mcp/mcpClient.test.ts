import { describe, expect, it } from 'vitest'
import { connectMcpClient, type McpTransport, type McpTransportClose } from './mcpClient'

/**
 * MCP のクライアント（mcpClient.ts）。偽の経路の上で、サーバーの振る舞いを台本にする。
 */

type Sent = Record<string, unknown>

interface FakeServer {
  readonly transport: McpTransport
  readonly sent: Sent[]
  /** サーバーから1通送る。 */
  readonly emit: (message: unknown) => void
  /** サーバーの stdout に生のバイト列を流す。 */
  readonly emitRaw: (text: string) => void
  /** プロセスが終わった / 起動できなかったことにする。 */
  readonly end: (close: McpTransportClose) => void
  readonly closeCalls: () => number
}

/**
 * `reply` は要求1通ごとに呼ばれ、返したものを応答として送る（undefined なら黙る）。
 */
function fakeServer(reply: (message: Sent, server: FakeServer) => unknown): FakeServer {
  const sent: Sent[] = []
  let onData: (chunk: Buffer) => void = () => {}
  let onClose: (close: McpTransportClose) => void = () => {}
  let closed: McpTransportClose | null = null
  let closeCalls = 0

  const server: FakeServer = {
    sent,
    transport: {
      send: (line) => {
        if (closed !== null) {
          throw new Error('closed')
        }

        const message = JSON.parse(line) as Sent
        sent.push(message)

        // 実物と同じく、応答は送った後で（非同期に）届く。
        queueMicrotask(() => {
          const response = reply(message, server)

          if (response !== undefined) {
            server.emit(response)
          }
        })
      },
      onData: (listener) => {
        onData = listener
      },
      onClose: (listener) => {
        onClose = listener

        // 本物の経路と同じく、登録より前に閉じていれば登録した時点で伝える。
        if (closed !== null) {
          listener(closed)
        }
      },
      close: async () => {
        closeCalls += 1
        server.end({ kind: 'exited', detail: 'exited with code 0.' })
      },
      terminate: () => {
        server.end({ kind: 'exited', detail: 'killed by SIGTERM.' })
      }
    },
    emit: (message) => onData(Buffer.from(`${JSON.stringify(message)}\n`, 'utf8')),
    emitRaw: (text) => onData(Buffer.from(text, 'utf8')),
    end: (close) => {
      if (closed === null) {
        closed = close
        onClose(close)
      }
    },
    closeCalls: () => closeCalls
  }

  return server
}

const CLIENT_INFO = { name: 'Fluvix Nexus', version: '1.0.0' }

function initializeResult(id: unknown, overrides: Record<string, unknown> = {}): unknown {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'example-server', version: '1.2.3' },
      ...overrides
    }
  }
}

/** initialize と tools/list（2ページ）に答える、ふつうのサーバー。 */
function healthyServer(): FakeServer {
  return fakeServer((message) => {
    switch (message['method']) {
      case 'initialize':
        return initializeResult(message['id'])
      case 'tools/list': {
        const cursor = (message['params'] as { cursor?: string } | undefined)?.cursor

        return cursor === undefined
          ? {
              jsonrpc: '2.0',
              id: message['id'],
              result: {
                tools: [{ name: 'API-post-search', description: 'Search', inputSchema: {} }],
                nextCursor: 'page-2'
              }
            }
          : {
              jsonrpc: '2.0',
              id: message['id'],
              result: { tools: [{ name: 'API-retrieve-a-page', inputSchema: {} }] }
            }
      }
      default:
        return undefined
    }
  })
}

describe('connectMcpClient', () => {
  it('initialize → initialized の順で接続し、名乗りと版を読む', async () => {
    const server = healthyServer()
    const connected = await connectMcpClient(server.transport, { clientInfo: CLIENT_INFO })

    expect(connected.ok).toBe(true)
    expect(server.sent[0]).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: CLIENT_INFO }
    })
    expect(server.sent[1]).toEqual({ jsonrpc: '2.0', method: 'notifications/initialized' })

    if (connected.ok) {
      expect(connected.client.protocolVersion).toBe('2025-06-18')
      expect(connected.client.serverInfo).toEqual({ name: 'example-server', version: '1.2.3' })
    }
  })

  it('tools/list のページを辿り、名前と説明だけを返す', async () => {
    const server = healthyServer()
    const connected = await connectMcpClient(server.transport, { clientInfo: CLIENT_INFO })

    if (!connected.ok) {
      throw new Error('should connect')
    }

    expect(await connected.client.listTools()).toEqual({
      ok: true,
      tools: [
        { name: 'API-post-search', description: 'Search' },
        { name: 'API-retrieve-a-page', description: null }
      ]
    })
    expect(server.sent.filter((message) => message['method'] === 'tools/list')).toEqual([
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/list', params: { cursor: 'page-2' } }
    ])
  })

  it('名前の無いツールは飛ばして知らせる', async () => {
    const warnings: string[] = []
    const server = fakeServer((message) =>
      message['method'] === 'initialize'
        ? initializeResult(message['id'])
        : {
            jsonrpc: '2.0',
            id: message['id'],
            result: { tools: [{ name: 'ok' }, { description: 'no name' }, 'junk'] }
          }
    )
    const connected = await connectMcpClient(server.transport, {
      clientInfo: CLIENT_INFO,
      onWarning: (reason) => warnings.push(reason)
    })

    if (!connected.ok) {
      throw new Error('should connect')
    }

    expect(await connected.client.listTools()).toEqual({
      ok: true,
      tools: [{ name: 'ok', description: null }]
    })
    expect(warnings).toContain('skipped 2 tool(s) without a valid name.')
  })

  it('同じ cursor を返し続けるサーバーでも止まる', async () => {
    const server = fakeServer((message) =>
      message['method'] === 'initialize'
        ? initializeResult(message['id'])
        : { jsonrpc: '2.0', id: message['id'], result: { tools: [], nextCursor: 'again' } }
    )
    const connected = await connectMcpClient(server.transport, { clientInfo: CLIENT_INFO })

    if (!connected.ok) {
      throw new Error('should connect')
    }

    expect(await connected.client.listTools()).toMatchObject({
      ok: false,
      failure: 'protocol-error'
    })
  })

  it('サーバーからの ping に答え、知らない要求は断る', async () => {
    const server = fakeServer((message, self) => {
      if (message['method'] === 'initialize') {
        self.emit({ jsonrpc: '2.0', id: 'srv-1', method: 'ping' })
        self.emit({ jsonrpc: '2.0', id: 'srv-2', method: 'roots/list' })
        return initializeResult(message['id'])
      }

      return undefined
    })

    await connectMcpClient(server.transport, { clientInfo: CLIENT_INFO })

    expect(server.sent).toContainEqual({ jsonrpc: '2.0', id: 'srv-1', result: {} })
    expect(server.sent).toContainEqual(
      expect.objectContaining({ id: 'srv-2', error: expect.objectContaining({ code: -32601 }) })
    )
  })

  it('stdout に紛れた JSON でない行は読み捨てて接続を続ける', async () => {
    const warnings: string[] = []
    const server = fakeServer((message, self) => {
      if (message['method'] === 'initialize') {
        self.emitRaw('some library log line\n')
        return initializeResult(message['id'])
      }

      return undefined
    })

    const connected = await connectMcpClient(server.transport, {
      clientInfo: CLIENT_INFO,
      onWarning: (reason) => warnings.push(reason)
    })

    expect(connected.ok).toBe(true)
    expect(warnings).toEqual(['a line on stdout was not JSON.'])
  })

  it('話せない版を選ばれたら unsupported-protocol で閉じる', async () => {
    const server = fakeServer((message) =>
      initializeResult(message['id'], { protocolVersion: '2023-01-01' })
    )
    const connected = await connectMcpClient(server.transport, { clientInfo: CLIENT_INFO })

    expect(connected).toMatchObject({ ok: false, failure: 'unsupported-protocol' })
    expect(server.closeCalls()).toBe(1)
  })

  it('ツールを持たないサーバーは protocol-error', async () => {
    const server = fakeServer((message) => initializeResult(message['id'], { capabilities: {} }))

    expect(await connectMcpClient(server.transport, { clientInfo: CLIENT_INFO })).toMatchObject({
      ok: false,
      failure: 'protocol-error'
    })
  })

  it('initialize を失敗で返されたら rejected', async () => {
    const server = fakeServer((message) => ({
      jsonrpc: '2.0',
      id: message['id'],
      error: { code: -32602, message: 'bad params' }
    }))

    expect(await connectMcpClient(server.transport, { clientInfo: CLIENT_INFO })).toMatchObject({
      ok: false,
      failure: 'rejected'
    })
  })

  it('応答が無ければ時間切れで閉じる', async () => {
    const server = fakeServer(() => undefined)
    const connected = await connectMcpClient(server.transport, {
      clientInfo: CLIENT_INFO,
      connectTimeoutMs: 20
    })

    expect(connected).toMatchObject({ ok: false, failure: 'timeout' })
    expect(server.closeCalls()).toBe(1)
  })

  it('tools/list の時間切れも timeout', async () => {
    const server = fakeServer((message) =>
      message['method'] === 'initialize' ? initializeResult(message['id']) : undefined
    )
    const connected = await connectMcpClient(server.transport, {
      clientInfo: CLIENT_INFO,
      requestTimeoutMs: 20
    })

    if (!connected.ok) {
      throw new Error('should connect')
    }

    expect(await connected.client.listTools()).toMatchObject({ ok: false, failure: 'timeout' })
  })

  it('接続中にプロセスが終わったら server-exited', async () => {
    const server = fakeServer((_message, self) => {
      self.end({ kind: 'exited', detail: 'exited with code 1.' })
      return undefined
    })

    expect(await connectMcpClient(server.transport, { clientInfo: CLIENT_INFO })).toEqual({
      ok: false,
      failure: 'server-exited',
      detail: 'exited with code 1.',
      // initialize は送った後に途切れた。
      requestSent: true
    })
  })

  it('起動できなかったら spawn-failed（送る前に閉じていた場合も）', async () => {
    const server = fakeServer(() => undefined)
    server.end({ kind: 'spawn-failed', detail: 'Error (ENOENT)' })

    expect(await connectMcpClient(server.transport, { clientInfo: CLIENT_INFO })).toEqual({
      ok: false,
      failure: 'spawn-failed',
      detail: 'Error (ENOENT)',
      requestSent: false
    })
  })

  it('close は待っている要求を失敗で返し、何度呼んでも経路を1度だけ閉じる', async () => {
    const server = fakeServer((message) =>
      message['method'] === 'initialize' ? initializeResult(message['id']) : undefined
    )
    const connected = await connectMcpClient(server.transport, { clientInfo: CLIENT_INFO })

    if (!connected.ok) {
      throw new Error('should connect')
    }

    const listing = connected.client.listTools()

    await Promise.all([connected.client.close(), connected.client.close()])

    expect(await listing).toMatchObject({ ok: false, failure: 'server-exited' })
    expect(server.closeCalls()).toBe(1)
    expect(await connected.client.listTools()).toMatchObject({ ok: false })
  })
})

describe('callTool', () => {
  async function connectWith(onCall: (message: Sent) => unknown): Promise<{
    server: FakeServer
    client: Extract<Awaited<ReturnType<typeof connectMcpClient>>, { ok: true }>['client']
  }> {
    const server = fakeServer((message) =>
      message['method'] === 'initialize' ? initializeResult(message['id']) : onCall(message)
    )
    const connected = await connectMcpClient(server.transport, {
      clientInfo: CLIENT_INFO,
      requestTimeoutMs: 30
    })

    if (!connected.ok) {
      throw new Error('should connect')
    }

    return { server, client: connected.client }
  }

  it('名前と引数を tools/call で送り、文字の content を順に読む', async () => {
    const { server, client } = await connectWith((message) => ({
      jsonrpc: '2.0',
      id: message['id'],
      result: {
        content: [
          { type: 'text', text: '{"a":1}' },
          { type: 'image', data: 'xx', mimeType: 'image/png' },
          { type: 'text', text: 'second' }
        ],
        structuredContent: { a: 1 }
      }
    }))

    expect(await client.callTool('example', { q: 'x' })).toEqual({
      ok: true,
      result: {
        isError: false,
        texts: ['{"a":1}', 'second'],
        otherContent: 1,
        structuredContent: { a: 1 }
      }
    })
    expect(server.sent.at(-1)).toMatchObject({
      method: 'tools/call',
      params: { name: 'example', arguments: { q: 'x' } }
    })
  })

  it('ツールの失敗（isError）はプロトコルの失敗と分けて返す', async () => {
    const { client } = await connectWith((message) => ({
      jsonrpc: '2.0',
      id: message['id'],
      result: { isError: true, content: [{ type: 'text', text: 'denied' }] }
    }))

    expect(await client.callTool('example', {})).toMatchObject({
      ok: true,
      result: { isError: true, texts: ['denied'] }
    })
  })

  it('JSON-RPC の失敗は rejected、形の違う結果は protocol-error、無応答は timeout', async () => {
    const rejected = await connectWith((message) => ({
      jsonrpc: '2.0',
      id: message['id'],
      error: { code: -32602, message: 'Unknown tool' }
    }))
    const malformed = await connectWith((message) => ({
      jsonrpc: '2.0',
      id: message['id'],
      result: { content: 'x' }
    }))
    const silent = await connectWith(() => undefined)

    expect(await rejected.client.callTool('x', {})).toMatchObject({
      ok: false,
      failure: 'rejected'
    })
    expect(await malformed.client.callTool('x', {})).toMatchObject({
      ok: false,
      failure: 'protocol-error'
    })
    expect(await silent.client.callTool('x', {})).toMatchObject({ ok: false, failure: 'timeout' })
  })
})
