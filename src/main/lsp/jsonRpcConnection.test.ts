import { describe, expect, it, vi } from 'vitest'
import {
  createJsonRpcConnection,
  JSON_RPC_METHOD_NOT_FOUND,
  type JsonRpcConnection
} from './jsonRpcConnection'
import {
  createJsonRpcDecoder,
  encodeJsonRpcMessage,
  JSON_RPC_VERSION,
  type JsonRpcMessage
} from './jsonRpcMessage'

/**
 * 1本のサーバとのやり取り（jsonRpcConnection.ts）。
 *
 * プロセスを持たない層なので、偽の口（送り先と、届いたバイト列）で動かせる。
 * 確かめたいのは3つ。
 *
 *   - 返事が正しい要求に結び付くこと
 *   - サーバからの要求に**必ず**返事をすること（黙るとサーバが止まる）
 *   - 経路が閉じたときに、待っている要求が全部返ること（Promise を宙に残さない）
 */

interface Harness {
  readonly connection: JsonRpcConnection
  /** サーバへ送られた電文（枠を外したもの）。 */
  readonly sent: readonly JsonRpcMessage[]
  /** サーバから届いたことにする。 */
  readonly deliver: (message: JsonRpcMessage) => void
  /** サーバから生のバイト列が届いたことにする。 */
  readonly deliverRaw: (data: string) => void
  readonly notifications: readonly { method: string; params: unknown }[]
  readonly brokenReasons: readonly string[]
  readonly warnings: readonly string[]
}

function createHarness(options?: { readonly failSend?: boolean }): Harness {
  const sent: JsonRpcMessage[] = []
  const notifications: { method: string; params: unknown }[] = []
  const brokenReasons: string[] = []
  const warnings: string[] = []

  // 送られたバイト列も本物の decoder で読む（枠の作り方まで含めて確かめるため）。
  const sentDecoder = createJsonRpcDecoder()

  const connection = createJsonRpcConnection({
    send: (data) => {
      if (options?.failSend === true) {
        throw new Error('EPIPE')
      }

      for (const result of sentDecoder.push(data)) {
        if (result.status === 'message') {
          sent.push(result.message)
        }
      }
    },
    onNotification: (method, params) => {
      notifications.push({ method, params })
    },
    onBrokenStream: (reason) => {
      brokenReasons.push(reason)
    },
    onProtocolWarning: (reason) => {
      warnings.push(reason)
    }
  })

  return {
    connection,
    sent,
    deliver: (message) => connection.receive(encodeJsonRpcMessage(message)),
    deliverRaw: (data) => connection.receive(Buffer.from(data, 'utf8')),
    notifications,
    brokenReasons,
    warnings
  }
}

describe('createJsonRpcConnection', () => {
  it('要求に id を振って送る', () => {
    const harness = createHarness()

    void harness.connection.request('initialize', { rootUri: null })

    expect(harness.sent).toEqual([
      { jsonrpc: JSON_RPC_VERSION, id: 1, method: 'initialize', params: { rootUri: null } }
    ])
  })

  it('id を使い回さない', () => {
    const harness = createHarness()

    void harness.connection.request('a')
    void harness.connection.request('b')

    expect(harness.sent.map((message) => 'id' in message && message.id)).toEqual([1, 2])
  })

  it('返事を、その id の要求に結び付ける', async () => {
    const harness = createHarness()

    const first = harness.connection.request('a')
    const second = harness.connection.request('b')

    // わざと逆の順で返す。順番ではなく id で結び付いていることを確かめる。
    harness.deliver({ jsonrpc: JSON_RPC_VERSION, id: 2, result: 'second' })
    harness.deliver({ jsonrpc: JSON_RPC_VERSION, id: 1, result: 'first' })

    await expect(first).resolves.toEqual({ status: 'result', result: 'first' })
    await expect(second).resolves.toEqual({ status: 'result', result: 'second' })
  })

  it('相手が失敗を返した場合は、error として返す（例外にしない）', async () => {
    const harness = createHarness()
    const pending = harness.connection.request('a')

    harness.deliver({
      jsonrpc: JSON_RPC_VERSION,
      id: 1,
      error: { code: -32603, message: 'internal' }
    })

    await expect(pending).resolves.toEqual({
      status: 'error',
      error: { code: -32603, message: 'internal' }
    })
  })

  it('通知には id を付けない', () => {
    const harness = createHarness()

    harness.connection.notify('initialized', {})

    expect(harness.sent).toEqual([{ jsonrpc: JSON_RPC_VERSION, method: 'initialized', params: {} }])
  })

  it('サーバからの通知を受け手へ渡す', () => {
    const harness = createHarness()

    harness.deliver({ jsonrpc: JSON_RPC_VERSION, method: 'window/logMessage', params: { type: 3 } })

    expect(harness.notifications).toEqual([{ method: 'window/logMessage', params: { type: 3 } }])
  })

  /*
    黙っているとサーバがそこで待ち続ける（初期化が終わらないサーバもある）。
    応じられないことを仕様どおりに伝えるのが、この層の役目にあたる。
  */
  it('応じられないサーバからの要求にも、必ず返事をする', () => {
    const harness = createHarness()

    harness.deliver({
      jsonrpc: JSON_RPC_VERSION,
      id: 41,
      method: 'workspace/configuration',
      params: {}
    })

    expect(harness.sent).toEqual([
      {
        jsonrpc: JSON_RPC_VERSION,
        id: 41,
        error: {
          code: JSON_RPC_METHOD_NOT_FOUND,
          message: 'the client does not handle "workspace/configuration".'
        }
      }
    ])
  })

  it('宛先の分からない返事は、警告にして読み進める', () => {
    const harness = createHarness()

    harness.deliver({ jsonrpc: JSON_RPC_VERSION, id: 99, result: null })

    expect(harness.warnings).toHaveLength(1)
    expect(harness.brokenReasons).toEqual([])
  })

  /* ------------------------------------------------------------- 閉じたとき */

  it('閉じたら、待っている要求が全部 closed で返る', async () => {
    const harness = createHarness()

    const first = harness.connection.request('a')
    const second = harness.connection.request('b')

    harness.connection.dispose('the server exited.')

    await expect(first).resolves.toEqual({ status: 'closed', reason: 'the server exited.' })
    await expect(second).resolves.toEqual({ status: 'closed', reason: 'the server exited.' })
  })

  it('閉じた後の要求は、送らずに closed を返す', async () => {
    const harness = createHarness()

    harness.connection.dispose('stopped')

    await expect(harness.connection.request('a')).resolves.toEqual({
      status: 'closed',
      reason: 'stopped'
    })
    expect(harness.sent).toEqual([])
  })

  it('閉じた後の通知は送らない', () => {
    const harness = createHarness()

    harness.connection.dispose('stopped')
    harness.connection.notify('initialized')

    expect(harness.sent).toEqual([])
  })

  it('送れなかった要求は、待たせずに closed で返す', async () => {
    const harness = createHarness({ failSend: true })

    await expect(harness.connection.request('a')).resolves.toEqual({
      status: 'closed',
      reason: 'the request could not be sent.'
    })
  })

  /*
    枠を見失ったら、読み進めても意味が無い（jsonRpcMessage.ts）。
    待っている要求を片付けたうえで、立て直しの判断へ渡す。
  */
  it('枠を見失ったら、経路を閉じてから呼び出し側へ伝える', async () => {
    const harness = createHarness()
    const pending = harness.connection.request('a')

    harness.deliverRaw('Content-Length: not-a-number\r\n\r\n')

    expect(harness.brokenReasons).toHaveLength(1)
    await expect(pending).resolves.toMatchObject({ status: 'closed' })
  })

  it('枠を見失った後に届いたものは読まない', () => {
    const harness = createHarness()

    harness.deliverRaw('Content-Length: not-a-number\r\n\r\n')
    harness.deliver({ jsonrpc: JSON_RPC_VERSION, method: 'window/logMessage' })

    expect(harness.notifications).toEqual([])
  })

  it('1通だけ読めなかった場合は、警告にして読み進める', () => {
    const harness = createHarness()

    harness.deliverRaw('Content-Length: 3\r\n\r\nbad')
    harness.deliver({ jsonrpc: JSON_RPC_VERSION, method: 'window/logMessage' })

    expect(harness.warnings).toHaveLength(1)
    expect(harness.notifications).toHaveLength(1)
    expect(harness.brokenReasons).toEqual([])
  })

  it('二度閉じても、最初の理由のまま一度だけ返る', async () => {
    const settled = vi.fn()
    const harness = createHarness()
    const pending = harness.connection.request('a').then((outcome) => {
      settled(outcome)
      return outcome
    })

    harness.connection.dispose('first')
    harness.connection.dispose('second')

    await expect(pending).resolves.toEqual({ status: 'closed', reason: 'first' })
    expect(settled).toHaveBeenCalledTimes(1)
  })
})
