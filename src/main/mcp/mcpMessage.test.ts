import { describe, expect, it } from 'vitest'
import { createMcpLineDecoder, encodeMcpMessage } from './mcpMessage'

/**
 * MCP の stdio の電文（mcpMessage.ts）── 改行で区切った JSON-RPC 2.0。
 */

function bytes(text: string): Buffer {
  return Buffer.from(text, 'utf8')
}

describe('encodeMcpMessage', () => {
  it('1行に書いて改行で終える（本文の改行はエスケープされる）', () => {
    const line = encodeMcpMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { text: 'a\nb' }
    })

    expect(line.endsWith('\n')).toBe(true)
    expect(line.slice(0, -1)).not.toContain('\n')
    expect(JSON.parse(line)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { text: 'a\nb' }
    })
  })
})

describe('createMcpLineDecoder', () => {
  it('塊の境目で分かれた行をつなぐ', () => {
    const decoder = createMcpLineDecoder()

    expect(decoder.push(bytes('{"jsonrpc":"2.0","id":1,'))).toEqual([])
    expect(decoder.push(bytes('"result":{}}\n{"jsonrpc":"2.0","method":"x"}\n'))).toEqual([
      { status: 'message', message: { jsonrpc: '2.0', id: 1, result: {} } },
      { status: 'message', message: { jsonrpc: '2.0', method: 'x' } }
    ])
  })

  it('塊の境目で分かれた多バイト文字を壊さない', () => {
    const decoder = createMcpLineDecoder()
    const whole = bytes('{"jsonrpc":"2.0","id":1,"result":{"text":"日本語"}}\n')
    const cut = whole.indexOf(bytes('本')) + 1

    decoder.push(whole.subarray(0, cut))

    expect(decoder.push(whole.subarray(cut))).toEqual([
      { status: 'message', message: { jsonrpc: '2.0', id: 1, result: { text: '日本語' } } }
    ])
  })

  it('\\r\\n と空行を許す', () => {
    const decoder = createMcpLineDecoder()

    expect(decoder.push(bytes('\r\n{"jsonrpc":"2.0","id":"a","result":null}\r\n'))).toEqual([
      { status: 'message', message: { jsonrpc: '2.0', id: 'a', result: null } }
    ])
  })

  it('JSON でない行は1行だけ読み捨てて先へ進む', () => {
    const decoder = createMcpLineDecoder()
    const results = decoder.push(bytes('Server started\n{"jsonrpc":"2.0","id":2,"result":1}\n'))

    expect(results[0]?.status).toBe('invalid-message')
    expect(results[1]).toEqual({
      status: 'message',
      message: { jsonrpc: '2.0', id: 2, result: 1 }
    })
  })

  it('JSON-RPC の形でないものは読み捨てる（バッチ・版違い・壊れた error）', () => {
    const decoder = createMcpLineDecoder()
    const results = decoder.push(
      bytes(
        [
          '[{"jsonrpc":"2.0","id":1,"result":1}]',
          '{"jsonrpc":"1.0","id":1,"result":1}',
          '{"jsonrpc":"2.0","id":1,"error":{"code":"x"}}',
          '{"jsonrpc":"2.0","id":{},"result":1}',
          '{"jsonrpc":"2.0","id":1}'
        ].join('\n') + '\n'
      )
    )

    expect(results.map((result) => result.status)).toEqual([
      'invalid-message',
      'invalid-message',
      'invalid-message',
      'invalid-message',
      'invalid-message'
    ])
  })

  it('読めなかった理由に行の中身を含めない', () => {
    const decoder = createMcpLineDecoder()
    const [result] = decoder.push(bytes('Authorization: Bearer ntn_secretish\n'))

    expect(JSON.stringify(result)).not.toContain('ntn_secretish')
  })

  it('改行が来ないまま上限を越えたら、経路が壊れたと伝えてそれ以上読まない', () => {
    const decoder = createMcpLineDecoder(16)

    expect(decoder.push(bytes('x'.repeat(10)))).toEqual([])
    expect(decoder.push(bytes('x'.repeat(10)))[0]?.status).toBe('broken-stream')
    expect(decoder.push(bytes('{"jsonrpc":"2.0","id":1,"result":1}\n'))).toEqual([])
  })
})
