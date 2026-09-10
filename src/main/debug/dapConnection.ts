import {
  createDapDecoder,
  encodeDapMessage,
  isDapEvent,
  isDapRequest,
  isDapResponse,
  type DapMessage,
  type DapResponseMessage
} from './dapMessage'

/**
 * 1本の Debug Adapter との DAP 経路（child_process 非依存・テスト対象）。
 *
 * DAP は JSON-RPC ではないため、応答の対応付けは `id` ではなく
 * response の `request_seq` で行う。adapter からの逆方向 request は、
 * Session 6-0 の境界に従って失敗応答を返す。
 */

export type DapRequestOutcome =
  | { readonly status: 'success'; readonly body: unknown }
  | { readonly status: 'failure'; readonly message?: string; readonly body: unknown }
  | { readonly status: 'closed'; readonly reason: string }

export interface DapConnectionOptions {
  readonly send: (data: Buffer) => void
  readonly onEvent: (event: string, body: unknown) => void
  readonly onAdapterRequest?: (command: string, args: unknown) => void
  readonly onBrokenStream: (reason: string) => void
  readonly onProtocolWarning?: (reason: string) => void
}

export interface DapConnection {
  readonly receive: (chunk: Buffer) => void
  readonly request: (command: string, args?: unknown) => Promise<DapRequestOutcome>
  readonly dispose: (reason: string) => void
}

export function createDapConnection(options: DapConnectionOptions): DapConnection {
  const decoder = createDapDecoder()
  const pending = new Map<number, (outcome: DapRequestOutcome) => void>()
  let nextSeq = 1
  let closed = false
  let closedReason = ''

  function write(message: DapMessage): boolean {
    try {
      options.send(encodeDapMessage(message))
      return true
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      options.onProtocolWarning?.(`failed to send "${describe(message)}": ${detail}`)

      return false
    }
  }

  function settle(response: DapResponseMessage): void {
    const resolve = pending.get(response.request_seq)

    if (resolve === undefined) {
      options.onProtocolWarning?.(
        `a response arrived for an unknown request seq: ${String(response.request_seq)}`
      )
      return
    }

    pending.delete(response.request_seq)
    resolve(
      response.success
        ? { status: 'success', body: response.body }
        : { status: 'failure', message: response.message, body: response.body }
    )
  }

  function handle(message: DapMessage): void {
    if (isDapEvent(message)) {
      options.onEvent(message.event, message.body)
      return
    }

    if (isDapResponse(message)) {
      settle(message)
      return
    }

    if (isDapRequest(message)) {
      options.onAdapterRequest?.(message.command, message.arguments)

      write({
        seq: nextSeq,
        type: 'response',
        request_seq: message.seq,
        success: false,
        command: message.command,
        message: `the client does not handle "${message.command}".`
      })
      nextSeq += 1
    }
  }

  function dispose(reason: string): void {
    if (closed) {
      return
    }

    closed = true
    closedReason = reason

    const waiting = [...pending.values()]
    pending.clear()

    for (const resolve of waiting) {
      resolve({ status: 'closed', reason })
    }
  }

  return {
    receive: (chunk: Buffer): void => {
      if (closed) {
        return
      }

      for (const result of decoder.push(chunk)) {
        switch (result.status) {
          case 'message':
            handle(result.message)
            break

          case 'invalid-message':
            options.onProtocolWarning?.(result.reason)
            break

          case 'broken-stream':
            dispose(`the message stream is broken: ${result.reason}`)
            options.onBrokenStream(result.reason)
            break
        }
      }
    },

    request: (command: string, args?: unknown): Promise<DapRequestOutcome> => {
      if (closed) {
        return Promise.resolve({ status: 'closed', reason: closedReason })
      }

      const seq = nextSeq
      nextSeq += 1

      const message: DapMessage =
        args === undefined
          ? { seq, type: 'request', command }
          : { seq, type: 'request', command, arguments: args }

      return new Promise<DapRequestOutcome>((resolve) => {
        pending.set(seq, resolve)

        if (!write(message)) {
          const pendingResolve = pending.get(seq)
          pending.delete(seq)
          pendingResolve?.({ status: 'closed', reason: 'the request could not be sent.' })
        }
      })
    },

    dispose
  }
}

function describe(message: DapMessage): string {
  switch (message.type) {
    case 'request':
      return message.command
    case 'response':
      return `response to ${String(message.request_seq)}`
    case 'event':
      return message.event
  }
}
