import {
  createJsonRpcDecoder,
  encodeJsonRpcMessage,
  isJsonRpcNotification,
  isJsonRpcRequest,
  JSON_RPC_VERSION,
  type JsonRpcErrorObject,
  type JsonRpcId,
  type JsonRpcMessage
} from './jsonRpcMessage'

/**
 * 1本のサーバとのやり取りを持つ層（Electron / child_process 非依存・テスト対象）。
 *
 * jsonRpcMessage.ts が「バイト列と電文」の相手なら、こちらは
 * **「要求と、その返事」の相手**にあたる。JSON-RPC の上でしか成立しない話
 * ── id を発番して控える、返ってきた返事を要求と結び付ける、
 * 相手から来た要求に必ず返事をする、途切れたときに待っているものを片付ける
 * ── だけをここに置く。
 *
 * プロセスのことは知らない。書き出す先も、届いたバイト列も引数で受け取るため、
 * テストでは偽の口を渡して動かせる（main/terminal/outputCoalescer.ts と同じ分け方）。
 *
 * ## 例外を投げない
 *
 * `request` は失敗しても reject しない。返るのは3つに分かれた結末で、
 * 「相手が失敗を返した」と「途中で切れた」を呼び出し側が取り違えないようにする
 * （IPC 層が IpcResult でくるむのと同じ考え方。shared/ipc/result.ts）。
 * 待っている間にサーバが落ちるのは異常ではなく**起こる前提の出来事**なので、
 * それを例外として扱うと、呼び出し側は毎回 try / catch を書くことになる。
 *
 * ## 相手からの要求には必ず返事をする
 *
 * Language Server は自分から要求を送ってくる（`client/registerCapability`、
 * `workspace/configuration`、`window/showMessageRequest` など）。
 * **返事をしないと、サーバはそこで待ち続ける。** 相手の実装によっては
 * 初期化が完了せず、以降のすべてが黙って止まる。
 *
 * Session 5-1 の時点で応じられる要求は1つも無いため、すべてに
 * `MethodNotFound` を返す。これは仕様どおりの返事で、サーバは
 * 「その機能は使えない」として先へ進める ── 黙っているのとは結果が違う。
 * 実際に応じる要求は、必要になった Session で1つずつ足す。
 *
 * ## 待っているものは、切れた時点で全部片付ける
 *
 * サーバが落ちれば返事は永久に来ない。`dispose` が呼ばれた時点で
 * 待っている要求をすべて `closed` で返すのは、**呼び出し側の Promise を
 * 宙に残さない**ため（残すと、そこで止まった UI は立て直しでも直らない）。
 */

/** 相手が知らない method を呼ばれたときに返す番号（JSON-RPC 2.0）。 */
export const JSON_RPC_METHOD_NOT_FOUND = -32601

/** 要求の結末。 */
export type JsonRpcRequestOutcome =
  | { readonly status: 'result'; readonly result: unknown }
  /** 相手が失敗として返した（要求は届いている）。 */
  | { readonly status: 'error'; readonly error: JsonRpcErrorObject }
  /** 返事を待っている間に経路が閉じた（サーバの終了・立て直し）。 */
  | { readonly status: 'closed'; readonly reason: string }

export interface JsonRpcConnectionOptions {
  /** 組み立てた電文の送り先（サーバの stdin）。 */
  readonly send: (data: Buffer) => void
  /** サーバからの通知（`window/logMessage`・`textDocument/publishDiagnostics` など）。 */
  readonly onNotification: (method: string, params: unknown) => void
  /**
   * 枠を見失った（jsonRpcMessage.ts の `broken-stream`）。
   *
   * **読み進めても意味が無い**ため、受け取った側はサーバを立て直す。
   * この層は立て直しの手段を持たないので、伝えるところまでを担う。
   */
  readonly onBrokenStream: (reason: string) => void
  /** 1通だけ読めなかった / 宛先の分からない返事が来た。読み進めはする。 */
  readonly onProtocolWarning?: (reason: string) => void
}

export interface JsonRpcConnection {
  /** サーバの stdout から届いたバイト列を渡す。 */
  readonly receive: (chunk: Buffer) => void
  /** 応答を待つ要求を送る。 */
  readonly request: (method: string, params?: unknown) => Promise<JsonRpcRequestOutcome>
  /** 応答を待たない通知を送る。 */
  readonly notify: (method: string, params?: unknown) => void
  /** 経路を閉じる。待っている要求はすべて `closed` で返る。 */
  readonly dispose: (reason: string) => void
}

export function createJsonRpcConnection(options: JsonRpcConnectionOptions): JsonRpcConnection {
  const decoder = createJsonRpcDecoder()
  const pending = new Map<JsonRpcId, (outcome: JsonRpcRequestOutcome) => void>()

  /*
    id は 1 から増やしていく整数。相手が別の相手と取り違える余地を作らないため、
    使い回さない（LSP の仕様も同じ要求）。
  */
  let nextId = 1
  let closed = false
  let closedReason = ''

  function write(message: JsonRpcMessage): boolean {
    try {
      options.send(encodeJsonRpcMessage(message))
      return true
    } catch (cause) {
      /*
        相手の stdin が既に閉じている（終了とほぼ同時に送った）。
        ここで throw すると、通知を送っただけの呼び出し側が落ちる。
      */
      const detail = cause instanceof Error ? cause.message : String(cause)
      options.onProtocolWarning?.(`failed to send "${describe(message)}": ${detail}`)

      return false
    }
  }

  function settle(id: JsonRpcId, outcome: JsonRpcRequestOutcome): void {
    const resolve = pending.get(id)

    if (resolve === undefined) {
      options.onProtocolWarning?.(`a response arrived for an unknown request id: ${String(id)}`)
      return
    }

    pending.delete(id)
    resolve(outcome)
  }

  function handle(message: JsonRpcMessage): void {
    if (isJsonRpcNotification(message)) {
      options.onNotification(message.method, message.params)
      return
    }

    if (isJsonRpcRequest(message)) {
      /*
        応じられる要求はまだ1つも無い（このファイルの冒頭）。
        黙っているとサーバが待ち続けるため、仕様どおりの断りを返す。
      */
      write({
        jsonrpc: JSON_RPC_VERSION,
        id: message.id,
        error: {
          code: JSON_RPC_METHOD_NOT_FOUND,
          message: `the client does not handle "${message.method}".`
        }
      })

      return
    }

    if (message.id === null) {
      /*
        こちらの送った電文が読めなかった、という相手からの失敗。
        どの要求に対するものか分からないので、待っているものは動かせない。
      */
      options.onProtocolWarning?.(`the server rejected a message: ${describeError(message.error)}`)
      return
    }

    settle(
      message.id,
      message.error === undefined
        ? { status: 'result', result: message.result }
        : { status: 'error', error: message.error }
    )
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
            /*
              枠を見失った。読み進めても意味が無いので、この経路は閉じる
              ── 待っている要求を先に片付けてから伝える。
            */
            dispose(`the message stream is broken: ${result.reason}`)
            options.onBrokenStream(result.reason)
            break
        }
      }
    },

    request: (method: string, params?: unknown): Promise<JsonRpcRequestOutcome> => {
      if (closed) {
        return Promise.resolve({ status: 'closed', reason: closedReason })
      }

      const id = nextId
      nextId += 1

      const message: JsonRpcMessage =
        params === undefined
          ? { jsonrpc: JSON_RPC_VERSION, id, method }
          : { jsonrpc: JSON_RPC_VERSION, id, method, params }

      return new Promise<JsonRpcRequestOutcome>((resolve) => {
        /*
          控えてから送る。送った直後に返事が届く（テストの偽の口や、
          極端に速いサーバ）場合に、控える前の返事を落とさないため。
        */
        pending.set(id, resolve)

        if (!write(message)) {
          settle(id, { status: 'closed', reason: 'the request could not be sent.' })
        }
      })
    },

    notify: (method: string, params?: unknown): void => {
      if (closed) {
        return
      }

      write(
        params === undefined
          ? { jsonrpc: JSON_RPC_VERSION, method }
          : { jsonrpc: JSON_RPC_VERSION, method, params }
      )
    },

    dispose: (reason: string): void => {
      dispose(reason)
    }
  }

  function dispose(reason: string): void {
    if (closed) {
      return
    }

    closed = true
    closedReason = reason

    /*
      待っている要求を全部返す。呼び出し側の Promise を宙に残さない
      （このファイルの冒頭）。控えを先に空にしてから呼ぶ ── 受け取った側が
      その場で次の要求を出しても、閉じた後なので `closed` が即座に返る。
    */
    const waiting = [...pending.values()]
    pending.clear()

    for (const resolve of waiting) {
      resolve({ status: 'closed', reason })
    }
  }
}

/** ログと理由の文字列のため（電文の中身そのものは載せない）。 */
function describe(message: JsonRpcMessage): string {
  return 'method' in message ? message.method : `response to ${String(message.id)}`
}

function describeError(error: JsonRpcErrorObject | undefined): string {
  return error === undefined ? 'no error object' : `${error.code} ${error.message}`
}
