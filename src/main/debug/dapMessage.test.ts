import { describe, expect, it } from 'vitest'
import {
  createDapDecoder,
  DAP_MAX_HEADER_LENGTH,
  encodeDapMessage,
  isDapEvent,
  isDapRequest,
  isDapResponse,
  type DapDecodeResult,
  type DapMessage
} from './dapMessage'

function framed(message: DapMessage): Buffer {
  return encodeDapMessage(message)
}

function messagesOf(results: readonly DapDecodeResult[]): readonly DapMessage[] {
  return results.flatMap((result) => (result.status === 'message' ? [result.message] : []))
}

describe('encodeDapMessage', () => {
  it('Content-Length ヘッダと空行に続けて本体を並べる', () => {
    const encoded = framed({ seq: 1, type: 'event', event: 'initialized' })

    expect(encoded.toString('utf8')).toMatch(/^Content-Length: \d+\r\n\r\n\{/)
  })

  it('長さは文字数ではなく UTF-8 のバイト数で申告する', () => {
    const encoded = framed({ seq: 1, type: 'event', event: 'output', body: { output: '日本語' } })
    const separatorAt = encoded.indexOf('\r\n\r\n')
    const header = encoded.subarray(0, separatorAt).toString('ascii')
    const body = encoded.subarray(separatorAt + 4)

    const declared = Number(/Content-Length: (\d+)/.exec(header)?.[1])

    expect(declared).toBe(body.byteLength)
    expect(declared).toBeGreaterThan(JSON.stringify({ output: '日本語' }).length)
  })
})

describe('createDapDecoder', () => {
  it('valid request を読む', () => {
    const decoder = createDapDecoder()

    expect(
      messagesOf(decoder.push(framed({ seq: 1, type: 'request', command: 'initialize' })))
    ).toEqual([{ seq: 1, type: 'request', command: 'initialize' }])
  })

  it('valid response を読む', () => {
    const decoder = createDapDecoder()

    expect(
      messagesOf(
        decoder.push(
          framed({
            seq: 2,
            type: 'response',
            request_seq: 1,
            success: true,
            command: 'initialize',
            body: { supportsConfigurationDoneRequest: true }
          })
        )
      )
    ).toEqual([
      {
        seq: 2,
        type: 'response',
        request_seq: 1,
        success: true,
        command: 'initialize',
        body: { supportsConfigurationDoneRequest: true }
      }
    ])
  })

  it('valid event を読む', () => {
    const decoder = createDapDecoder()

    expect(messagesOf(decoder.push(framed({ seq: 3, type: 'event', event: 'stopped' })))).toEqual([
      { seq: 3, type: 'event', event: 'stopped' }
    ])
  })

  it('partial header を待ってから読む', () => {
    const decoder = createDapDecoder()
    const encoded = framed({ seq: 1, type: 'event', event: 'split-header' })

    expect(decoder.push(encoded.subarray(0, 8))).toEqual([])
    expect(messagesOf(decoder.push(encoded.subarray(8)))).toHaveLength(1)
  })

  it('partial body を待ってから読む', () => {
    const decoder = createDapDecoder()
    const encoded = framed({ seq: 1, type: 'event', event: 'split-body', body: { a: 1 } })
    const cut = encoded.byteLength - 3

    expect(decoder.push(encoded.subarray(0, cut))).toEqual([])
    expect(messagesOf(decoder.push(encoded.subarray(cut)))).toHaveLength(1)
  })

  it('multiple frames を1回の chunk から順に読む', () => {
    const decoder = createDapDecoder()
    const chunk = Buffer.concat([
      framed({ seq: 1, type: 'event', event: 'a' }),
      framed({ seq: 2, type: 'event', event: 'b' }),
      framed({ seq: 3, type: 'event', event: 'c' })
    ])

    expect(
      messagesOf(decoder.push(chunk)).map((message) => (isDapEvent(message) ? message.event : ''))
    ).toEqual(['a', 'b', 'c'])
  })

  it('body が1バイトずつ分かれても読める', () => {
    const decoder = createDapDecoder()
    const encoded = framed({
      seq: 1,
      type: 'event',
      event: 'output',
      body: { output: 'あいうえお' }
    })
    const collected: DapMessage[] = []

    for (const byte of encoded) {
      collected.push(...messagesOf(decoder.push(Buffer.from([byte]))))
    }

    expect(collected).toEqual([
      { seq: 1, type: 'event', event: 'output', body: { output: 'あいうえお' } }
    ])
  })

  it('Content-Type など知らないヘッダは読み飛ばす', () => {
    const decoder = createDapDecoder()
    const body = Buffer.from('{"seq":1,"type":"event","event":"typed"}', 'utf8')
    const chunk = Buffer.concat([
      Buffer.from(
        `Content-Type: application/json\r\nContent-Length: ${body.byteLength}\r\n\r\n`,
        'ascii'
      ),
      body
    ])

    expect(messagesOf(decoder.push(chunk))).toEqual([{ seq: 1, type: 'event', event: 'typed' }])
  })

  it('malformed Content-Length は broken-stream にする', () => {
    const decoder = createDapDecoder()

    expect(decoder.push(Buffer.from('Content-Length: nope\r\n\r\n{}', 'ascii'))[0]?.status).toBe(
      'broken-stream'
    )
  })

  it('invalid JSON はその1通だけを捨てて読み進める', () => {
    const decoder = createDapDecoder()
    const broken = Buffer.from('not json', 'utf8')
    const results = decoder.push(
      Buffer.concat([
        Buffer.from(`Content-Length: ${broken.byteLength}\r\n\r\n`, 'ascii'),
        broken,
        framed({ seq: 1, type: 'event', event: 'after' })
      ])
    )

    expect(results[0]?.status).toBe('invalid-message')
    expect(messagesOf(results)).toEqual([{ seq: 1, type: 'event', event: 'after' }])
  })

  it('malformed DAP payload はその1通だけを捨てる', () => {
    const decoder = createDapDecoder()
    const body = Buffer.from('{"seq":1,"type":"response","success":true,"command":"x"}', 'utf8')

    expect(
      decoder.push(
        Buffer.concat([Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'ascii'), body])
      )[0]?.status
    ).toBe('invalid-message')
  })

  it('区切りが現れないまま溜まり続けたら broken-stream にする', () => {
    const decoder = createDapDecoder()

    expect(decoder.push(Buffer.alloc(DAP_MAX_HEADER_LENGTH + 1, 0x41))[0]?.status).toBe(
      'broken-stream'
    )
  })
})

describe('電文の見分け', () => {
  it('request / response / event を type で分ける', () => {
    const request: DapMessage = { seq: 1, type: 'request', command: 'initialize' }
    const response: DapMessage = {
      seq: 2,
      type: 'response',
      request_seq: 1,
      success: true,
      command: 'initialize'
    }
    const event: DapMessage = { seq: 3, type: 'event', event: 'initialized' }

    expect(isDapRequest(request)).toBe(true)
    expect(isDapResponse(response)).toBe(true)
    expect(isDapEvent(event)).toBe(true)
  })
})
