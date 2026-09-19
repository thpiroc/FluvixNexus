/**
 * MCP の stdio の電文を組み立てる・読む（Electron / child_process 非依存・テスト対象）。
 *
 * ## LSP の読み書きは使わない
 *
 * 中身は同じ JSON-RPC 2.0 でも、枠の付け方が違う。
 *
 * ```
 * LSP … `Content-Length: N\r\n\r\n` + 本文（main/lsp/jsonRpcMessage.ts）
 * MCP … 本文を1行に書き、`\n` で区切る（本文の中に改行を含めてはならない）
 * ```
 *
 * LSP の側を「枠を差し替えられる形」へ直すと、動いている Language Server の
 * 経路に手を入れることになる。この層は小さいので、MCP のために別に持つ。
 *
 * ## 行に収まらないものは読み捨てる
 *
 * MCP の仕様上、サーバーは stdout に電文以外を書いてはならないが、
 * 依存ライブラリの `console.log` が紛れ込むことは現実にある。JSON として読めない行は
 * 1行だけ読み捨てて先へ進む（行で区切られているので、枠を見失うことは無い）。
 *
 * 1行の長さには上限を置く。改行が来ないまま溜まり続けるのは壊れた相手で、
 * そこで経路を閉じる（`broken-stream`）。
 */

export const JSON_RPC_VERSION = '2.0'

/** 1行（電文1通）の上限（バイト）。ツールの一覧やページの本文でも十分に収まる大きさ。 */
export const MCP_MAX_LINE_BYTES = 16 * 1024 * 1024

export type JsonRpcId = number | string

export interface JsonRpcErrorObject {
  readonly code: number
  readonly message: string
  readonly data?: unknown
}

export interface JsonRpcRequestMessage {
  readonly jsonrpc: typeof JSON_RPC_VERSION
  readonly id: JsonRpcId
  readonly method: string
  readonly params?: unknown
}

export interface JsonRpcNotificationMessage {
  readonly jsonrpc: typeof JSON_RPC_VERSION
  readonly method: string
  readonly params?: unknown
}

export interface JsonRpcResponseMessage {
  readonly jsonrpc: typeof JSON_RPC_VERSION
  readonly id: JsonRpcId | null
  readonly result?: unknown
  readonly error?: JsonRpcErrorObject
}

export type JsonRpcMessage =
  JsonRpcRequestMessage | JsonRpcNotificationMessage | JsonRpcResponseMessage

export type McpLineDecodeResult =
  | { readonly status: 'message'; readonly message: JsonRpcMessage }
  /** 1行だけ読めなかった。先へは進める。 */
  | { readonly status: 'invalid-message'; readonly reason: string }
  /** 改行が来ないまま上限を越えた。この先は読まない。 */
  | { readonly status: 'broken-stream'; readonly reason: string }

/** 電文を1行にする（`JSON.stringify` は改行を `\n` とエスケープするので、本文に改行は残らない）。 */
export function encodeMcpMessage(message: JsonRpcMessage): string {
  return `${JSON.stringify(message)}\n`
}

export interface McpLineDecoder {
  readonly push: (chunk: Buffer) => readonly McpLineDecodeResult[]
}

export function createMcpLineDecoder(maxLineBytes = MCP_MAX_LINE_BYTES): McpLineDecoder {
  /*
    バイトのまま溜め、改行（0x0A）で切ってから UTF-8 として読む。
    文字列にしてから切ると、塊の境目で分かれた多バイト文字が壊れる。
  */
  let pending: Buffer[] = []
  let pendingBytes = 0
  let broken = false

  return {
    push: (chunk: Buffer): readonly McpLineDecodeResult[] => {
      if (broken) {
        return []
      }

      const results: McpLineDecodeResult[] = []
      let start = 0

      for (;;) {
        const newline = chunk.indexOf(0x0a, start)

        if (newline === -1) {
          break
        }

        const piece = chunk.subarray(start, newline)
        const line = pendingBytes === 0 ? piece : Buffer.concat([...pending, piece])
        pending = []
        pendingBytes = 0
        start = newline + 1

        if (line.length > maxLineBytes) {
          results.push({ status: 'invalid-message', reason: 'a message exceeded the size limit.' })
          continue
        }

        const result = readLine(line)

        if (result !== null) {
          results.push(result)
        }
      }

      if (start < chunk.length) {
        const rest = chunk.subarray(start)
        pending.push(rest)
        pendingBytes += rest.length

        if (pendingBytes > maxLineBytes) {
          broken = true
          pending = []
          pendingBytes = 0
          results.push({
            status: 'broken-stream',
            reason: `no line break within ${maxLineBytes} bytes.`
          })
        }
      }

      return results
    }
  }
}

function readLine(line: Buffer): McpLineDecodeResult | null {
  // Windows で書かれた `\r\n` を許す。空行は何も言わずに飛ばす。
  const text = line.toString('utf8').replace(/\r$/, '').trim()

  if (text.length === 0) {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    // 行の中身はログへ出さない（サーバーが何を書いたかは分からない）。
    return { status: 'invalid-message', reason: 'a line on stdout was not JSON.' }
  }

  const message = toJsonRpcMessage(parsed)

  return message === null
    ? { status: 'invalid-message', reason: 'a line on stdout was not a JSON-RPC 2.0 message.' }
    : { status: 'message', message }
}

/**
 * 形を確かめる。バッチ（配列）は受け付けない ── MCP の 2025-06-18 で取り除かれ、
 * こちらから送ることも無い。
 */
function toJsonRpcMessage(value: unknown): JsonRpcMessage | null {
  if (!isRecord(value) || value['jsonrpc'] !== JSON_RPC_VERSION) {
    return null
  }

  const id = value['id']
  const method = value['method']

  if (typeof method === 'string') {
    if (id === undefined) {
      return value as unknown as JsonRpcNotificationMessage
    }

    return isJsonRpcId(id) ? (value as unknown as JsonRpcRequestMessage) : null
  }

  if (id !== null && !isJsonRpcId(id)) {
    return null
  }

  const error = value['error']

  if (error !== undefined) {
    return isErrorObject(error) ? (value as unknown as JsonRpcResponseMessage) : null
  }

  return 'result' in value ? (value as unknown as JsonRpcResponseMessage) : null
}

export function isJsonRpcRequest(message: JsonRpcMessage): message is JsonRpcRequestMessage {
  return 'method' in message && 'id' in message
}

export function isJsonRpcNotification(
  message: JsonRpcMessage
): message is JsonRpcNotificationMessage {
  return 'method' in message && !('id' in message)
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'string'
}

function isErrorObject(value: unknown): value is JsonRpcErrorObject {
  return (
    isRecord(value) && typeof value['code'] === 'number' && typeof value['message'] === 'string'
  )
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
