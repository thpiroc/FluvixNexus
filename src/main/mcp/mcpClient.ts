import type { McpConnectionFailure, McpToolSummary } from '@shared/mcp'
import {
  createMcpLineDecoder,
  encodeMcpMessage,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isRecord,
  JSON_RPC_VERSION,
  type JsonRpcId,
  type JsonRpcMessage
} from './mcpMessage'

/**
 * MCP のクライアント（Electron / child_process 非依存・テスト対象）。
 *
 * ## 持つもの
 *
 * ```
 * 接続      initialize → 応答 → notifications/initialized
 * 一覧      tools/list（nextCursor を辿る）
 * 呼び出し  tools/call（名前と引数をそのまま送る）
 * 切断      待っている要求を片付けて、経路（McpTransport）を閉じる
 * ```
 *
 * ツールの名前と引数を決めるのはここではない。Renderer から届くのは閉じた集合の
 * 操作名だけで、それをツールへ読み替えるのは操作の表（mcpOperations.ts と
 * 各サーバーの操作表）になる。
 *
 * ## 経路は外から受け取る
 *
 * 子プロセスを立てるのは mcpStdioTransport.ts で、ここは「1行を送る・
 * バイト列を受け取る・閉じる」しか知らない。テストでは偽の経路を渡す。
 *
 * ## 時間切れ
 *
 * どの要求にも上限を置く。サーバーが黙り込んだとき、待つ側（IPC の応答）が
 * 永遠に返らないのがいちばん困る。時間切れになった接続は閉じる
 * ── 遅れて届いた応答を、別の要求の応答として読み違えないため。
 */

/** こちらが話せる MCP の版（新しい順）。送るのは先頭。 */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const

/** 接続（initialize の応答まで）を待つ上限。node の起動とサーバーの読み込みを含む。 */
export const MCP_CONNECT_TIMEOUT_MS = 20_000

/** 接続した後の1要求を待つ上限。 */
export const MCP_REQUEST_TIMEOUT_MS = 15_000

/** tools/list のページを辿る上限（壊れたサーバーが同じ cursor を返し続けても止まる）。 */
const MCP_TOOLS_MAX_PAGES = 50

/** 相手が知らない method を呼ばれたときに返す番号（JSON-RPC 2.0）。 */
const JSON_RPC_METHOD_NOT_FOUND = -32601

/** 経路が閉じた理由。 */
export type McpTransportClose =
  /** 起動できなかった。 */
  | { readonly kind: 'spawn-failed'; readonly detail: string }
  /** 起動した後に終わった。 */
  | { readonly kind: 'exited'; readonly detail: string }

/**
 * 経路（サーバーの stdin / stdout）。
 *
 * `onData` / `onClose` は作った直後に1度だけ登録する。
 */
export interface McpTransport {
  /** 1行を送る。閉じた後に呼ぶと投げることがある。 */
  readonly send: (line: string) => void
  readonly onData: (listener: (chunk: Buffer) => void) => void
  readonly onClose: (listener: (close: McpTransportClose) => void) => void
  /** 閉じる（プロセスが終わるまで待つ）。何度呼んでもよい。 */
  readonly close: () => Promise<void>
  /**
   * 待たずに終わらせる。アプリの終了（will-quit）のように、待つ時間が無いときだけ使う。
   */
  readonly terminate: () => void
}

export interface McpClientOptions {
  /** initialize で名乗る名前と版。 */
  readonly clientInfo: { readonly name: string; readonly version: string }
  readonly connectTimeoutMs?: number
  readonly requestTimeoutMs?: number
  /** 読めなかった行・宛先の無い応答など、先へ進める異常。 */
  readonly onWarning?: (reason: string) => void
}

/** 失敗の結末。`detail` は Main のログ向けで、画面へは渡さない。 */
export interface McpFailure {
  readonly ok: false
  readonly failure: McpConnectionFailure
  readonly detail: string
  /**
   * 要求をサーバーへ書き込んだ後の失敗か（要求1つに対する失敗のときだけ持つ）。
   *
   * true なら、サーバーは受け取って処理したかもしれない。書き込みの操作では
   * 「結果不明」として扱う（押し直すと二重に書き込みうる。mcpConnections.ts）。
   */
  readonly requestSent?: boolean
}

export type McpConnectResult = { readonly ok: true; readonly client: McpClient } | McpFailure

export type McpListToolsResult =
  { readonly ok: true; readonly tools: readonly McpToolSummary[] } | McpFailure

/**
 * tools/call の結果（MCP の `CallToolResult` を、使う分だけ読んだもの）。
 *
 * `isError` はツールの失敗（相手の API が断った など）で、プロトコルの失敗とは別
 * ── プロトコルの失敗は `McpFailure` として返る。
 */
export interface McpToolCallResult {
  readonly isError: boolean
  /** `content` のうち文字のもの（順に）。 */
  readonly texts: readonly string[]
  /** 文字以外の `content` の数（画像・リソースなど。まだ読まない）。 */
  readonly otherContent: number
  readonly structuredContent: Readonly<Record<string, unknown>> | null
}

export type McpCallToolResult =
  { readonly ok: true; readonly result: McpToolCallResult } | McpFailure

export interface McpClient {
  readonly protocolVersion: string
  readonly serverInfo: { readonly name: string | null; readonly version: string | null }
  readonly listTools: () => Promise<McpListToolsResult>
  /**
   * ツールを1つ呼ぶ。名前と引数を**検めずに**そのまま送るので、呼ぶのは
   * 操作の表（mcpOperations.ts）を通った後だけにする。
   */
  readonly callTool: (
    name: string,
    toolArguments: Readonly<Record<string, unknown>>
  ) => Promise<McpCallToolResult>
  /** 切断する。待っている要求はすべて失敗で返る。何度呼んでもよい。 */
  readonly close: () => Promise<void>
}

type RequestOutcome =
  | { readonly status: 'result'; readonly result: unknown }
  | { readonly status: 'error'; readonly code: number; readonly message: string }
  | { readonly status: 'timeout' }
  | { readonly status: 'closed'; readonly sent: boolean }

/**
 * 経路の上で MCP の接続を確立する。
 *
 * 失敗したときは経路を閉じてから返す（呼び出し側が片付けを忘れても、プロセスは残らない）。
 */
export async function connectMcpClient(
  transport: McpTransport,
  options: McpClientOptions
): Promise<McpConnectResult> {
  const connectTimeoutMs = options.connectTimeoutMs ?? MCP_CONNECT_TIMEOUT_MS
  const requestTimeoutMs = options.requestTimeoutMs ?? MCP_REQUEST_TIMEOUT_MS
  const warn = options.onWarning ?? (() => {})

  const decoder = createMcpLineDecoder()
  const pending = new Map<JsonRpcId, (outcome: RequestOutcome) => void>()
  let nextId = 1
  let transportClose: McpTransportClose | null = null
  let brokenStream: string | null = null

  function write(message: JsonRpcMessage): boolean {
    try {
      transport.send(encodeMcpMessage(message))
      return true
    } catch (cause) {
      warn(`failed to send a message: ${cause instanceof Error ? cause.message : String(cause)}`)
      return false
    }
  }

  function settleAll(outcome: RequestOutcome): void {
    const waiting = [...pending.values()]
    pending.clear()

    for (const resolve of waiting) {
      resolve(outcome)
    }
  }

  function handle(message: JsonRpcMessage): void {
    if (isJsonRpcNotification(message)) {
      // 通知（ログ・一覧の変化など）はまだ使わない。
      return
    }

    if (isJsonRpcRequest(message)) {
      /*
        サーバーからの要求。`ping` には答える（答えないと切られうる）。
        それ以外（roots / sampling / elicitation）は initialize で持つと言っていないので、
        仕様どおりの断りを返す ── 黙っているとサーバーが待ち続ける。
      */
      write(
        message.method === 'ping'
          ? { jsonrpc: JSON_RPC_VERSION, id: message.id, result: {} }
          : {
              jsonrpc: JSON_RPC_VERSION,
              id: message.id,
              error: {
                code: JSON_RPC_METHOD_NOT_FOUND,
                message: `the client does not handle "${message.method}".`
              }
            }
      )
      return
    }

    const resolve = message.id === null ? undefined : pending.get(message.id)

    if (message.id === null || resolve === undefined) {
      warn('a response arrived for an unknown request.')
      return
    }

    pending.delete(message.id)
    resolve(
      message.error === undefined
        ? { status: 'result', result: message.result }
        : { status: 'error', code: message.error.code, message: message.error.message }
    )
  }

  transport.onData((chunk) => {
    for (const result of decoder.push(chunk)) {
      switch (result.status) {
        case 'message':
          handle(result.message)
          break
        case 'invalid-message':
          warn(result.reason)
          break
        case 'broken-stream':
          brokenStream = result.reason
          settleAll({ status: 'closed', sent: true })
          void transport.close()
          break
      }
    }
  })

  transport.onClose((close) => {
    transportClose ??= close
    settleAll({ status: 'closed', sent: true })
  })

  function request(method: string, params: unknown, timeoutMs: number): Promise<RequestOutcome> {
    if (transportClose !== null || brokenStream !== null) {
      return Promise.resolve({ status: 'closed', sent: false })
    }

    const id = nextId
    nextId += 1

    return new Promise<RequestOutcome>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        resolve({ status: 'timeout' })
      }, timeoutMs)

      // 控えてから送る（送った直後に届いた応答を落とさない）。
      pending.set(id, (outcome) => {
        clearTimeout(timer)
        resolve(outcome)
      })

      if (!write({ jsonrpc: JSON_RPC_VERSION, id, method, params })) {
        pending.delete(id)
        clearTimeout(timer)
        resolve({ status: 'closed', sent: false })
      }
    })
  }

  /** 要求が結果を返さなかったときの失敗。 */
  function failureOf(outcome: Exclude<RequestOutcome, { status: 'result' }>): McpFailure {
    switch (outcome.status) {
      case 'timeout':
        return {
          ok: false,
          failure: 'timeout',
          detail: 'the server did not respond in time.',
          requestSent: true
        }
      case 'error':
        return {
          ok: false,
          failure: 'rejected',
          detail: `the server returned an error (${outcome.code}): ${outcome.message}`,
          requestSent: true
        }
      case 'closed':
        if (brokenStream !== null) {
          return {
            ok: false,
            failure: 'protocol-error',
            detail: brokenStream,
            requestSent: outcome.sent
          }
        }

        if (transportClose?.kind === 'spawn-failed') {
          return {
            ok: false,
            failure: 'spawn-failed',
            detail: transportClose.detail,
            requestSent: false
          }
        }

        return {
          ok: false,
          failure: 'server-exited',
          detail: transportClose?.detail ?? 'the connection was closed.',
          requestSent: outcome.sent
        }
    }
  }

  let closing: Promise<void> | null = null

  function close(): Promise<void> {
    closing ??= (async () => {
      settleAll({ status: 'closed', sent: true })
      await transport.close()
    })()

    return closing
  }

  async function fail(failure: McpFailure): Promise<McpFailure> {
    await close()
    return failure
  }

  const initialized = await request(
    'initialize',
    {
      protocolVersion: MCP_SUPPORTED_PROTOCOL_VERSIONS[0],
      // 応じられる機能（roots / sampling / elicitation）はまだ無い。
      capabilities: {},
      clientInfo: options.clientInfo
    },
    connectTimeoutMs
  )

  if (initialized.status !== 'result') {
    return fail(failureOf(initialized))
  }

  const handshake = readInitializeResult(initialized.result)

  if (handshake === null) {
    return fail({
      ok: false,
      failure: 'protocol-error',
      detail: 'the initialize result had an unexpected shape.'
    })
  }

  if (!(MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(handshake.protocolVersion)) {
    return fail({
      ok: false,
      failure: 'unsupported-protocol',
      detail: `the server chose protocol version "${handshake.protocolVersion}".`
    })
  }

  if (!handshake.hasTools) {
    return fail({
      ok: false,
      failure: 'protocol-error',
      detail: 'the server does not offer tools.'
    })
  }

  write({ jsonrpc: JSON_RPC_VERSION, method: 'notifications/initialized' })

  async function listTools(): Promise<McpListToolsResult> {
    const tools: McpToolSummary[] = []
    let cursor: string | undefined

    for (let page = 0; page < MCP_TOOLS_MAX_PAGES; page += 1) {
      const outcome = await request(
        'tools/list',
        cursor === undefined ? {} : { cursor },
        requestTimeoutMs
      )

      if (outcome.status !== 'result') {
        return failureOf(outcome)
      }

      const read = readToolsPage(outcome.result)

      if (read === null) {
        return {
          ok: false,
          failure: 'protocol-error',
          detail: 'the tools/list result had an unexpected shape.'
        }
      }

      if (read.skipped > 0) {
        warn(`skipped ${read.skipped} tool(s) without a valid name.`)
      }

      tools.push(...read.tools)

      if (read.nextCursor === null) {
        return { ok: true, tools }
      }

      cursor = read.nextCursor
    }

    return {
      ok: false,
      failure: 'protocol-error',
      detail: `tools/list did not finish within ${MCP_TOOLS_MAX_PAGES} pages.`
    }
  }

  async function callTool(
    name: string,
    toolArguments: Readonly<Record<string, unknown>>
  ): Promise<McpCallToolResult> {
    const outcome = await request(
      'tools/call',
      { name, arguments: toolArguments },
      requestTimeoutMs
    )

    if (outcome.status !== 'result') {
      return failureOf(outcome)
    }

    const result = readToolCallResult(outcome.result)

    return result === null
      ? {
          ok: false,
          failure: 'protocol-error',
          detail: 'the tools/call result had an unexpected shape.'
        }
      : { ok: true, result }
  }

  return {
    ok: true,
    client: {
      protocolVersion: handshake.protocolVersion,
      serverInfo: handshake.serverInfo,
      listTools,
      callTool,
      close
    }
  }
}

/**
 * tools/call の結果を読む。
 *
 * `content` のうち文字（`text`）だけを取り出す。画像・音声・リソースの参照は、
 * まだどの操作も使わないので数だけ残す。
 */
function readToolCallResult(result: unknown): McpToolCallResult | null {
  if (!isRecord(result) || !Array.isArray(result['content'])) {
    return null
  }

  const texts: string[] = []
  let otherContent = 0

  for (const item of result['content']) {
    if (isRecord(item) && item['type'] === 'text' && typeof item['text'] === 'string') {
      texts.push(item['text'])
    } else {
      otherContent += 1
    }
  }

  return {
    isError: result['isError'] === true,
    texts,
    otherContent,
    structuredContent: isRecord(result['structuredContent']) ? result['structuredContent'] : null
  }
}

interface InitializeResult {
  readonly protocolVersion: string
  readonly serverInfo: { readonly name: string | null; readonly version: string | null }
  readonly hasTools: boolean
}

function readInitializeResult(result: unknown): InitializeResult | null {
  if (!isRecord(result) || typeof result['protocolVersion'] !== 'string') {
    return null
  }

  const capabilities = result['capabilities']
  const serverInfo = isRecord(result['serverInfo']) ? result['serverInfo'] : {}

  return {
    protocolVersion: result['protocolVersion'],
    serverInfo: {
      name: typeof serverInfo['name'] === 'string' ? serverInfo['name'] : null,
      version: typeof serverInfo['version'] === 'string' ? serverInfo['version'] : null
    },
    hasTools: isRecord(capabilities) && isRecord(capabilities['tools'])
  }
}

interface ToolsPage {
  readonly tools: readonly McpToolSummary[]
  readonly skipped: number
  readonly nextCursor: string | null
}

function readToolsPage(result: unknown): ToolsPage | null {
  if (!isRecord(result) || !Array.isArray(result['tools'])) {
    return null
  }

  const tools: McpToolSummary[] = []
  let skipped = 0

  for (const item of result['tools']) {
    if (!isRecord(item) || typeof item['name'] !== 'string' || item['name'].length === 0) {
      skipped += 1
      continue
    }

    tools.push({
      name: item['name'],
      description: typeof item['description'] === 'string' ? item['description'] : null
    })
  }

  const nextCursor = result['nextCursor']

  return {
    tools,
    skipped,
    nextCursor: typeof nextCursor === 'string' && nextCursor.length > 0 ? nextCursor : null
  }
}
