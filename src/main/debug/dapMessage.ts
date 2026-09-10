/**
 * DAP の電文の組み立てと読み取り（Electron / child_process 非依存・テスト対象）。
 *
 * DAP は LSP と同じ `Content-Length` の枠を使うが、中身は JSON-RPC ではない。
 * そのため `seq` と `type: request | response | event` を持つ DAP 専用の
 * message layer として分けてある。
 */

export const DAP_MAX_CONTENT_LENGTH = 64 * 1024 * 1024
export const DAP_MAX_HEADER_LENGTH = 8 * 1024

const HEADER_SEPARATOR = '\r\n\r\n'

export interface DapRequestMessage {
  readonly seq: number
  readonly type: 'request'
  readonly command: string
  readonly arguments?: unknown
}

export interface DapResponseMessage {
  readonly seq: number
  readonly type: 'response'
  readonly request_seq: number
  readonly success: boolean
  readonly command: string
  readonly message?: string
  readonly body?: unknown
}

export interface DapEventMessage {
  readonly seq: number
  readonly type: 'event'
  readonly event: string
  readonly body?: unknown
}

export type DapMessage = DapRequestMessage | DapResponseMessage | DapEventMessage

export type DapDecodeResult =
  | { readonly status: 'message'; readonly message: DapMessage }
  /** 枠は読めたが中身が DAP message ではない。その1通だけを捨てる。 */
  | { readonly status: 'invalid-message'; readonly reason: string }
  /** 枠を見失った。以降は読まない。 */
  | { readonly status: 'broken-stream'; readonly reason: string }

export function encodeDapMessage(message: DapMessage): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  const header = Buffer.from(`Content-Length: ${body.byteLength}${HEADER_SEPARATOR}`, 'ascii')

  return Buffer.concat([header, body])
}

export interface DapDecoder {
  readonly push: (chunk: Buffer) => readonly DapDecodeResult[]
}

export function createDapDecoder(): DapDecoder {
  let pending: Buffer = Buffer.alloc(0)
  let broken = false

  return {
    push: (chunk: Buffer): readonly DapDecodeResult[] => {
      if (broken || chunk.byteLength === 0) {
        return []
      }

      pending = pending.byteLength === 0 ? chunk : Buffer.concat([pending, chunk])

      const results: DapDecodeResult[] = []

      for (;;) {
        const separatorAt = pending.indexOf(HEADER_SEPARATOR)

        if (separatorAt < 0) {
          if (pending.byteLength > DAP_MAX_HEADER_LENGTH) {
            broken = true
            results.push({
              status: 'broken-stream',
              reason: `no header separator within ${DAP_MAX_HEADER_LENGTH} bytes.`
            })
          }

          return results
        }

        const contentLength = readContentLength(pending.subarray(0, separatorAt).toString('ascii'))

        if (contentLength.status === 'invalid') {
          broken = true
          results.push({ status: 'broken-stream', reason: contentLength.reason })

          return results
        }

        const bodyAt = separatorAt + HEADER_SEPARATOR.length
        const bodyEnd = bodyAt + contentLength.value

        if (pending.byteLength < bodyEnd) {
          return results
        }

        const body = pending.subarray(bodyAt, bodyEnd)
        pending = pending.subarray(bodyEnd)

        results.push(readMessage(body))
      }
    }
  }
}

type ContentLengthOutcome =
  | { readonly status: 'read'; readonly value: number }
  | { readonly status: 'invalid'; readonly reason: string }

function readContentLength(header: string): ContentLengthOutcome {
  let found: number | null = null

  for (const line of header.split('\r\n')) {
    if (line.length === 0) {
      continue
    }

    const colonAt = line.indexOf(':')

    if (colonAt < 0) {
      return { status: 'invalid', reason: `malformed header line: ${truncate(line)}` }
    }

    if (line.slice(0, colonAt).trim().toLowerCase() !== 'content-length') {
      continue
    }

    const raw = line.slice(colonAt + 1).trim()

    if (!/^\d+$/.test(raw)) {
      return { status: 'invalid', reason: `content-length is not a number: ${truncate(raw)}` }
    }

    found = Number(raw)
  }

  if (found === null) {
    return { status: 'invalid', reason: 'the header has no content-length.' }
  }

  if (found > DAP_MAX_CONTENT_LENGTH) {
    return { status: 'invalid', reason: `content-length is too large: ${found}` }
  }

  return { status: 'read', value: found }
}

function readMessage(body: Buffer): DapDecodeResult {
  let parsed: unknown

  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)

    return { status: 'invalid-message', reason: `the body is not valid JSON: ${detail}` }
  }

  const message = parseDapMessage(parsed)

  if (message.status === 'invalid') {
    return { status: 'invalid-message', reason: message.reason }
  }

  return { status: 'message', message: message.value }
}

type DapMessageParseOutcome =
  | { readonly status: 'valid'; readonly value: DapMessage }
  | { readonly status: 'invalid'; readonly reason: string }

export function parseDapMessage(value: unknown): DapMessageParseOutcome {
  if (!isRecord(value)) {
    return { status: 'invalid', reason: 'the body is not a DAP message.' }
  }

  if (!isDapSeq(value.seq)) {
    return { status: 'invalid', reason: 'the message seq is not a positive integer.' }
  }

  switch (value.type) {
    case 'request':
      return parseDapRequest(value)

    case 'response':
      return parseDapResponse(value)

    case 'event':
      return parseDapEvent(value)

    default:
      return {
        status: 'invalid',
        reason: `unknown DAP message type: ${truncate(String(value.type))}`
      }
  }
}

function parseDapRequest(value: Readonly<Record<string, unknown>>): DapMessageParseOutcome {
  if (!isDapSeq(value.seq)) {
    return { status: 'invalid', reason: 'the message seq is not a positive integer.' }
  }

  if (typeof value.command !== 'string' || value.command.length === 0) {
    return { status: 'invalid', reason: 'the request command is not a non-empty string.' }
  }

  return 'arguments' in value
    ? {
        status: 'valid',
        value: {
          seq: value.seq,
          type: 'request',
          command: value.command,
          arguments: value.arguments
        }
      }
    : { status: 'valid', value: { seq: value.seq, type: 'request', command: value.command } }
}

function parseDapResponse(value: Readonly<Record<string, unknown>>): DapMessageParseOutcome {
  if (!isDapSeq(value.seq)) {
    return { status: 'invalid', reason: 'the message seq is not a positive integer.' }
  }

  if (!isDapSeq(value.request_seq)) {
    return { status: 'invalid', reason: 'the response request_seq is not a positive integer.' }
  }

  if (typeof value.success !== 'boolean') {
    return { status: 'invalid', reason: 'the response success flag is not a boolean.' }
  }

  if (typeof value.command !== 'string' || value.command.length === 0) {
    return { status: 'invalid', reason: 'the response command is not a non-empty string.' }
  }

  if ('message' in value && typeof value.message !== 'string') {
    return { status: 'invalid', reason: 'the response message is not a string.' }
  }

  const response: DapResponseMessage = {
    seq: value.seq,
    type: 'response',
    request_seq: value.request_seq,
    success: value.success,
    command: value.command,
    ...readOptionalString(value, 'message'),
    ...('body' in value ? { body: value.body } : {})
  }

  return { status: 'valid', value: response }
}

function parseDapEvent(value: Readonly<Record<string, unknown>>): DapMessageParseOutcome {
  if (!isDapSeq(value.seq)) {
    return { status: 'invalid', reason: 'the message seq is not a positive integer.' }
  }

  if (typeof value.event !== 'string' || value.event.length === 0) {
    return { status: 'invalid', reason: 'the event name is not a non-empty string.' }
  }

  return 'body' in value
    ? {
        status: 'valid',
        value: { seq: value.seq, type: 'event', event: value.event, body: value.body }
      }
    : { status: 'valid', value: { seq: value.seq, type: 'event', event: value.event } }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDapSeq(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function readOptionalString(
  value: Readonly<Record<string, unknown>>,
  key: string
): Readonly<Record<string, string>> {
  const field = value[key]

  return typeof field === 'string' ? { [key]: field } : {}
}

function truncate(value: string): string {
  return value.length <= 80 ? value : `${value.slice(0, 80)}...`
}

export function isDapRequest(message: DapMessage): message is DapRequestMessage {
  return message.type === 'request'
}

export function isDapResponse(message: DapMessage): message is DapResponseMessage {
  return message.type === 'response'
}

export function isDapEvent(message: DapMessage): message is DapEventMessage {
  return message.type === 'event'
}
