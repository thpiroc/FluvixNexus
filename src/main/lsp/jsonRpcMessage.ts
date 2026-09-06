/**
 * LSP の電文の組み立てと読み取り（Electron / child_process 非依存・テスト対象）。
 *
 * ## stdio は「メッセージの列」ではなく「バイトの流れ」
 *
 * Language Server とのやり取りは標準入出力の上で行う。届くのは
 * `stdout` の `data` イベントで、そこに乗ってくるのは**チャンクであって
 * メッセージではない**。
 *
 * ```
 * 1回の data に2通ぶん入っている        … 分けて読む必要がある
 * ヘッダの途中で切れている              … 続きが来るまで待つ必要がある
 * 本体の途中で切れている                … 同上
 * ```
 *
 * そこで LSP は HTTP に似たヘッダを被せて境界を決めている（Base Protocol）。
 *
 * ```
 * Content-Length: 123\r\n
 * \r\n
 * {"jsonrpc":"2.0", ... }
 * ```
 *
 * ## 長さは「文字数」ではなく「バイト数」
 *
 * `Content-Length` が数えるのは UTF-8 に符号化した後のバイト数で、
 * JavaScript の `string.length`（UTF-16 の符号単位）とは一致しない。
 * 日本語のファイル名やコメントが1つ入るだけでずれ、**ずれた瞬間に
 * それ以降の電文の境界がすべて壊れる**（次のヘッダを本体の途中から読み始める）。
 * だからこの層は文字列ではなく Buffer で数える。
 *
 * ## 壊れ方を2つに分ける
 *
 * | 分類              | 何が起きたか                             | 次の一手                     |
 * | ----------------- | ---------------------------------------- | ---------------------------- |
 * | `invalid-message` | 枠は読めたが、中身が JSON-RPC ではない   | その1通を捨てて読み進める    |
 * | `broken-stream`   | 枠そのものを見失った                     | 読み進めても意味が無い       |
 *
 * 前者は「1通おかしいだけ」で、`Content-Length` ぶんを読み飛ばせば次の電文の
 * 先頭に正しく着く。後者は**どこから次の電文が始まるのか分からない**状態で、
 * それ以降に読めたように見えるものはすべて偶然でしかない。
 * サーバを立て直す以外に戻る道が無いため、型で分けて呼び出し側へ渡す
 * （main/lsp/jsonRpcConnection.ts が受け取り、lifecycle 側が立て直す）。
 *
 * ## Electron に依存しない
 *
 * ログを出さず（結末に理由を載せて呼び出し側へ渡す）、`process` も読まない。
 * この層の判断をテストで固定するためで、main/terminal/outputCoalescer.ts と
 * 同じ分け方にあたる。
 */

/** JSON-RPC のバージョン。LSP は 2.0 だけを使う。 */
export const JSON_RPC_VERSION = '2.0'

/**
 * 1通あたりの本体の上限（バイト）。
 *
 * 上限があるのは、`Content-Length` が**相手から届いた数**であるため。
 * 桁の壊れた値（あるいは異常な応答）をそのまま信じると、その長さぶんが
 * 集まるまで Buffer を伸ばし続けることになる。
 *
 * 実際の LSP の電文で大きくなるのは、大きなファイルの全文を含む
 * `textDocument/didOpen` と、ワークスペース全体の診断・シンボル一覧になる。
 * 読み込むファイル自体に上限がある（FILES_FILE_MAX_BYTES）ことを踏まえても、
 * その数十倍の余裕を残しておけば実運用で当たることはない。
 */
export const JSON_RPC_MAX_CONTENT_LENGTH = 64 * 1024 * 1024

/**
 * ヘッダ部の上限（バイト）。
 *
 * 区切り（`\r\n\r\n`）が現れないまま溜まり続けるのは、相手が LSP の
 * Base Protocol を話していないか、枠を見失っているかのどちらかになる。
 * 本物のヘッダは長くても 100 バイト程度なので、ここに当たった時点で
 * 「読める見込みが無い」と判断してよい。
 */
export const JSON_RPC_MAX_HEADER_LENGTH = 8 * 1024

/** ヘッダと本体の区切り。 */
const HEADER_SEPARATOR = '\r\n\r\n'

/** 電文の id。LSP は数値を使うが、仕様上は文字列も来うる。 */
export type JsonRpcId = number | string

/** 相手が返してきた失敗。 */
export interface JsonRpcErrorObject {
  readonly code: number
  readonly message: string
  readonly data?: unknown
}

/** 応答を期待する電文。 */
export interface JsonRpcRequestMessage {
  readonly jsonrpc: typeof JSON_RPC_VERSION
  readonly id: JsonRpcId
  readonly method: string
  readonly params?: unknown
}

/** 応答を期待しない電文。 */
export interface JsonRpcNotificationMessage {
  readonly jsonrpc: typeof JSON_RPC_VERSION
  readonly method: string
  readonly params?: unknown
}

/** 要求への返事。`id` が null になるのは、要求の id すら読めなかった場合。 */
export interface JsonRpcResponseMessage {
  readonly jsonrpc: typeof JSON_RPC_VERSION
  readonly id: JsonRpcId | null
  readonly result?: unknown
  readonly error?: JsonRpcErrorObject
}

export type JsonRpcMessage =
  JsonRpcRequestMessage | JsonRpcNotificationMessage | JsonRpcResponseMessage

/** 読み取りの結末（このファイルの冒頭の表）。 */
export type JsonRpcDecodeResult =
  | { readonly status: 'message'; readonly message: JsonRpcMessage }
  /** 枠は読めたが中身が使えない。その1通だけを捨てる。 */
  | { readonly status: 'invalid-message'; readonly reason: string }
  /** 枠を見失った。以降は読まない。 */
  | { readonly status: 'broken-stream'; readonly reason: string }

/**
 * 電文を1通ぶんのバイト列にする。
 *
 * ヘッダは ASCII、本体は UTF-8。`Content-Type` は付けない ── 既定が
 * `application/vscode-jsonrpc; charset=utf-8` で、それ以外を送ることが無い。
 */
export function encodeJsonRpcMessage(message: JsonRpcMessage): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8')

  /*
    数えるのは Buffer の byteLength。ここで `JSON.stringify(...).length` と
    書くと、日本語を含む電文のたびに1文字ぶんずつ足りない長さを申告することになり、
    相手側の枠がその時点で壊れる（このファイルの冒頭）。
  */
  const header = Buffer.from(`Content-Length: ${body.byteLength}${HEADER_SEPARATOR}`, 'ascii')

  return Buffer.concat([header, body])
}

/**
 * 届いたバイト列から電文を取り出す。
 *
 * 1回の `push` で0通のことも複数通のこともある（このファイルの冒頭）。
 * 一度 `broken-stream` を返した後は、何を渡しても何も返さない
 * ── 枠を見失った後の「読めたように見えるもの」を配らないため。
 */
export interface JsonRpcDecoder {
  readonly push: (chunk: Buffer) => readonly JsonRpcDecodeResult[]
}

export function createJsonRpcDecoder(): JsonRpcDecoder {
  /*
    型を明示する。`Buffer.alloc(0)` から推論させると `Buffer<ArrayBuffer>` に
    狭まり、届いたチャンク（`Buffer<ArrayBufferLike>`）をそのまま持てなくなる。
  */
  let pending: Buffer = Buffer.alloc(0)
  let broken = false

  return {
    push: (chunk: Buffer): readonly JsonRpcDecodeResult[] => {
      if (broken || chunk.byteLength === 0) {
        return []
      }

      pending = pending.byteLength === 0 ? chunk : Buffer.concat([pending, chunk])

      const results: JsonRpcDecodeResult[] = []

      /*
        1通取り出すたびに繰り返す。1回の data に複数通が入っているのは
        珍しくない（診断の通知は一度にまとめて届く）。
      */
      for (;;) {
        const separatorAt = pending.indexOf(HEADER_SEPARATOR)

        if (separatorAt < 0) {
          if (pending.byteLength > JSON_RPC_MAX_HEADER_LENGTH) {
            broken = true
            results.push({
              status: 'broken-stream',
              reason: `no header separator within ${JSON_RPC_MAX_HEADER_LENGTH} bytes.`
            })
          }

          // ヘッダがまだ揃っていない。続きを待つ。
          return results
        }

        const contentLength = readContentLength(pending.subarray(0, separatorAt).toString('ascii'))

        if (contentLength.status === 'invalid') {
          /*
            ヘッダが読めない時点で、本体がどこまでなのかも分からない。
            読み飛ばす長さを決められないので、これは枠の喪失にあたる。
          */
          broken = true
          results.push({ status: 'broken-stream', reason: contentLength.reason })

          return results
        }

        const bodyAt = separatorAt + HEADER_SEPARATOR.length
        const bodyEnd = bodyAt + contentLength.value

        if (pending.byteLength < bodyEnd) {
          // 本体がまだ揃っていない。続きを待つ。
          return results
        }

        const body = pending.subarray(bodyAt, bodyEnd)

        // 読んだぶんを落としてから中身を見る（中身が壊れていても次へ進めるように）。
        pending = pending.subarray(bodyEnd)

        results.push(readMessage(body))
      }
    }
  }
}

type ContentLengthOutcome =
  | { readonly status: 'read'; readonly value: number }
  | { readonly status: 'invalid'; readonly reason: string }

/**
 * ヘッダ部から `Content-Length` を読む。
 *
 * 名前の大小は区別しない（仕様上は `Content-Length` だが、HTTP 風のヘッダを
 * 素直に実装したサーバは綴りを揃えないことがある）。`Content-Type` など
 * 知らないヘッダは黙って読み飛ばす ── 知らないものを失敗にすると、
 * 仕様に沿った拡張1つでやり取りが止まる。
 */
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

    /*
      正規表現で確かめてから数にする。`Number('12abc')` は NaN だが
      `parseInt('12abc')` は 12 を返す ── 後者だと、壊れた長さを
      「読めた」として扱ってしまう。
    */
    if (!/^\d+$/.test(raw)) {
      return { status: 'invalid', reason: `content-length is not a number: ${truncate(raw)}` }
    }

    found = Number(raw)
  }

  if (found === null) {
    return { status: 'invalid', reason: 'the header has no content-length.' }
  }

  if (found > JSON_RPC_MAX_CONTENT_LENGTH) {
    return { status: 'invalid', reason: `content-length is too large: ${found}` }
  }

  return { status: 'read', value: found }
}

/**
 * 本体を JSON-RPC の電文として読む。
 *
 * ここで確かめるのは**電文として扱える形か**だけで、method の名前も
 * params の中身も見ない。それを知っているのは上の層になる。
 */
function readMessage(body: Buffer): JsonRpcDecodeResult {
  let parsed: unknown

  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)

    return { status: 'invalid-message', reason: `the body is not valid JSON: ${detail}` }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { status: 'invalid-message', reason: 'the body is not a JSON-RPC message.' }
  }

  const message = parsed as Record<string, unknown>

  if (message.jsonrpc !== JSON_RPC_VERSION) {
    return {
      status: 'invalid-message',
      reason: `unexpected jsonrpc version: ${truncate(String(message.jsonrpc))}`
    }
  }

  const hasMethod = typeof message.method === 'string'
  const hasId = typeof message.id === 'number' || typeof message.id === 'string'

  /*
    method も id も無いものは、要求でも通知でも応答でもない。
    id が null の応答（要求の id すら読めなかった相手からの失敗）だけは通す。
  */
  if (!hasMethod && !hasId && !('error' in message)) {
    return { status: 'invalid-message', reason: 'the message has neither a method nor an id.' }
  }

  return { status: 'message', message: message as unknown as JsonRpcMessage }
}

/** 理由の文字列に、相手から届いたものをそのまま長く載せない。 */
function truncate(value: string): string {
  return value.length <= 80 ? value : `${value.slice(0, 80)}…`
}

/* -------------------------------------------------------------- 電文の見分け */

/** 応答を期待する電文か（相手からの要求）。 */
export function isJsonRpcRequest(message: JsonRpcMessage): message is JsonRpcRequestMessage {
  return 'method' in message && 'id' in message && message.id !== null
}

/** 応答を期待しない電文か（相手からの通知）。 */
export function isJsonRpcNotification(
  message: JsonRpcMessage
): message is JsonRpcNotificationMessage {
  return 'method' in message && !('id' in message)
}

/** こちらの要求への返事か。 */
export function isJsonRpcResponse(message: JsonRpcMessage): message is JsonRpcResponseMessage {
  return !('method' in message) && 'id' in message
}
