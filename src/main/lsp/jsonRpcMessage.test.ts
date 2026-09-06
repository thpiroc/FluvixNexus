import { describe, expect, it } from 'vitest'
import {
  createJsonRpcDecoder,
  encodeJsonRpcMessage,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  JSON_RPC_MAX_HEADER_LENGTH,
  JSON_RPC_VERSION,
  type JsonRpcDecodeResult,
  type JsonRpcMessage
} from './jsonRpcMessage'

/**
 * LSP の電文の組み立てと読み取り（jsonRpcMessage.ts）。
 *
 * ここで確かめたいのは**枠が壊れないこと**に尽きる。長さの数え方を1バイト
 * 間違えるだけで、それ以降の電文の境界がすべてずれる（元に戻る道は無い）。
 * だから「日本語を含む電文」「チャンクの切れ方」「1回に複数通」を明示的に置く。
 */

/** テストの読みやすさのため、届いたバイト列を作る側も本物の encode を使う。 */
function framed(message: JsonRpcMessage): Buffer {
  return encodeJsonRpcMessage(message)
}

function messagesOf(results: readonly JsonRpcDecodeResult[]): readonly JsonRpcMessage[] {
  return results.flatMap((result) => (result.status === 'message' ? [result.message] : []))
}

describe('encodeJsonRpcMessage', () => {
  it('Content-Length ヘッダと空行に続けて本体を並べる', () => {
    const encoded = framed({ jsonrpc: JSON_RPC_VERSION, method: 'initialized', params: {} })
    const text = encoded.toString('utf8')

    expect(text).toMatch(/^Content-Length: \d+\r\n\r\n\{/)
  })

  /*
    UTF-16 の符号単位ではなく UTF-8 のバイト数を申告する。
    ここを取り違えると、日本語のファイル名が1つ混ざった時点で枠が壊れる。
  */
  it('長さは文字数ではなくバイト数で申告する', () => {
    const encoded = framed({ jsonrpc: JSON_RPC_VERSION, method: '日本語', params: 'あ' })
    const separatorAt = encoded.indexOf('\r\n\r\n')
    const header = encoded.subarray(0, separatorAt).toString('ascii')
    const body = encoded.subarray(separatorAt + 4)

    const declared = Number(/Content-Length: (\d+)/.exec(header)?.[1])

    expect(declared).toBe(body.byteLength)
    expect(declared).toBeGreaterThan(JSON.stringify({ method: '日本語' }).length)
  })
})

describe('createJsonRpcDecoder', () => {
  it('1通ぶんが揃えばそれを返す', () => {
    const decoder = createJsonRpcDecoder()
    const results = decoder.push(framed({ jsonrpc: JSON_RPC_VERSION, id: 1, method: 'initialize' }))

    expect(messagesOf(results)).toEqual([
      { jsonrpc: JSON_RPC_VERSION, id: 1, method: 'initialize' }
    ])
  })

  it('1回のチャンクに複数通が入っていれば、その順に全部返す', () => {
    const decoder = createJsonRpcDecoder()
    const chunk = Buffer.concat([
      framed({ jsonrpc: JSON_RPC_VERSION, method: 'a' }),
      framed({ jsonrpc: JSON_RPC_VERSION, method: 'b' }),
      framed({ jsonrpc: JSON_RPC_VERSION, method: 'c' })
    ])

    expect(
      messagesOf(decoder.push(chunk)).map((message) => 'method' in message && message.method)
    ).toEqual(['a', 'b', 'c'])
  })

  it('ヘッダの途中で切れていても、続きが届けば読める', () => {
    const decoder = createJsonRpcDecoder()
    const encoded = framed({ jsonrpc: JSON_RPC_VERSION, method: 'split-header' })

    expect(decoder.push(encoded.subarray(0, 8))).toEqual([])
    expect(messagesOf(decoder.push(encoded.subarray(8)))).toHaveLength(1)
  })

  it('本体の途中で切れていても、続きが届けば読める', () => {
    const decoder = createJsonRpcDecoder()
    const encoded = framed({ jsonrpc: JSON_RPC_VERSION, method: 'split-body', params: { a: 1 } })
    const cut = encoded.byteLength - 4

    expect(decoder.push(encoded.subarray(0, cut))).toEqual([])
    expect(messagesOf(decoder.push(encoded.subarray(cut)))).toHaveLength(1)
  })

  /*
    1バイトずつ届く形は実際には起きにくいが、「境界がチャンクの切れ方に
    依存しないこと」を最も強く確かめられる。
  */
  it('1バイトずつ届いても、1文字も欠けずに読める', () => {
    const decoder = createJsonRpcDecoder()
    const encoded = framed({ jsonrpc: JSON_RPC_VERSION, method: '日本語', params: 'あいうえお' })

    const collected: JsonRpcMessage[] = []

    for (const byte of encoded) {
      collected.push(...messagesOf(decoder.push(Buffer.from([byte]))))
    }

    expect(collected).toEqual([
      { jsonrpc: JSON_RPC_VERSION, method: '日本語', params: 'あいうえお' }
    ])
  })

  it('知らないヘッダ（Content-Type）は読み飛ばす', () => {
    const decoder = createJsonRpcDecoder()
    const body = Buffer.from('{"jsonrpc":"2.0","method":"typed"}', 'utf8')
    const chunk = Buffer.concat([
      Buffer.from(
        `Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: ${body.byteLength}\r\n\r\n`,
        'ascii'
      ),
      body
    ])

    expect(messagesOf(decoder.push(chunk))).toEqual([
      { jsonrpc: JSON_RPC_VERSION, method: 'typed' }
    ])
  })

  it('ヘッダの名前の大小は区別しない', () => {
    const decoder = createJsonRpcDecoder()
    const body = Buffer.from('{"jsonrpc":"2.0","method":"lower"}', 'utf8')
    const chunk = Buffer.concat([
      Buffer.from(`content-length: ${body.byteLength}\r\n\r\n`, 'ascii'),
      body
    ])

    expect(messagesOf(decoder.push(chunk))).toHaveLength(1)
  })

  /* --------------------------------------------------------------- 壊れ方 */

  /*
    枠は読めているので、その1通を捨てれば次から正しく読める。
    「読み進められる壊れ方」と「読み進められない壊れ方」を分けているのが要点。
  */
  it('本体が JSON でなければ、その1通だけを捨てて次を読む', () => {
    const decoder = createJsonRpcDecoder()
    const broken = Buffer.from('not json', 'utf8')
    const chunk = Buffer.concat([
      Buffer.from(`Content-Length: ${broken.byteLength}\r\n\r\n`, 'ascii'),
      broken,
      framed({ jsonrpc: JSON_RPC_VERSION, method: 'after' })
    ])

    const results = decoder.push(chunk)

    expect(results[0]?.status).toBe('invalid-message')
    expect(messagesOf(results)).toEqual([{ jsonrpc: JSON_RPC_VERSION, method: 'after' }])
  })

  it('JSON-RPC の版が違う電文は、その1通だけを捨てる', () => {
    const decoder = createJsonRpcDecoder()
    const body = Buffer.from('{"jsonrpc":"1.0","method":"old"}', 'utf8')
    const chunk = Buffer.concat([
      Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'ascii'),
      body
    ])

    expect(decoder.push(chunk)[0]?.status).toBe('invalid-message')
  })

  it('Content-Length が数でなければ、枠を見失ったものとして扱う', () => {
    const decoder = createJsonRpcDecoder()
    const results = decoder.push(Buffer.from('Content-Length: abc\r\n\r\n{}', 'ascii'))

    expect(results[0]?.status).toBe('broken-stream')
  })

  it('Content-Length が無ければ、枠を見失ったものとして扱う', () => {
    const decoder = createJsonRpcDecoder()
    const results = decoder.push(Buffer.from('Content-Type: text/plain\r\n\r\n{}', 'ascii'))

    expect(results[0]?.status).toBe('broken-stream')
  })

  /*
    枠を見失った後に「読めたように見えるもの」を配らない。
    配ると、偶然 JSON として通ったバイト列が電文として扱われる。
  */
  it('枠を見失った後は、正しい電文が届いても読まない', () => {
    const decoder = createJsonRpcDecoder()

    decoder.push(Buffer.from('Content-Length: abc\r\n\r\n', 'ascii'))

    expect(decoder.push(framed({ jsonrpc: JSON_RPC_VERSION, method: 'after' }))).toEqual([])
  })

  it('区切りが現れないまま溜まり続けたら、枠を見失ったものとして扱う', () => {
    const decoder = createJsonRpcDecoder()
    const results = decoder.push(Buffer.alloc(JSON_RPC_MAX_HEADER_LENGTH + 1, 0x41))

    expect(results[0]?.status).toBe('broken-stream')
  })
})

describe('電文の見分け', () => {
  it('id を持つ method は要求', () => {
    const message: JsonRpcMessage = { jsonrpc: JSON_RPC_VERSION, id: 7, method: 'initialize' }

    expect(isJsonRpcRequest(message)).toBe(true)
    expect(isJsonRpcNotification(message)).toBe(false)
    expect(isJsonRpcResponse(message)).toBe(false)
  })

  it('id を持たない method は通知', () => {
    const message: JsonRpcMessage = { jsonrpc: JSON_RPC_VERSION, method: 'initialized' }

    expect(isJsonRpcNotification(message)).toBe(true)
    expect(isJsonRpcRequest(message)).toBe(false)
  })

  it('method を持たない id は応答', () => {
    const message: JsonRpcMessage = { jsonrpc: JSON_RPC_VERSION, id: 7, result: null }

    expect(isJsonRpcResponse(message)).toBe(true)
    expect(isJsonRpcRequest(message)).toBe(false)
  })
})
