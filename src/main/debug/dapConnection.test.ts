import { describe, expect, it, vi } from 'vitest'
import { createDapConnection, type DapConnection } from './dapConnection'
import { createDapDecoder, encodeDapMessage, type DapMessage } from './dapMessage'

interface Harness {
  readonly connection: DapConnection
  readonly sent: readonly DapMessage[]
  readonly deliver: (message: DapMessage) => void
  readonly deliverRaw: (data: string) => void
  readonly events: readonly { event: string; body: unknown }[]
  readonly adapterRequests: readonly { command: string; args: unknown }[]
  readonly brokenReasons: readonly string[]
  readonly warnings: readonly string[]
}

function createHarness(options?: { readonly failSend?: boolean }): Harness {
  const sent: DapMessage[] = []
  const events: { event: string; body: unknown }[] = []
  const adapterRequests: { command: string; args: unknown }[] = []
  const brokenReasons: string[] = []
  const warnings: string[] = []
  const sentDecoder = createDapDecoder()

  const connection = createDapConnection({
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
    onEvent: (event, body) => {
      events.push({ event, body })
    },
    onAdapterRequest: (command, args) => {
      adapterRequests.push({ command, args })
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
    deliver: (message) => connection.receive(encodeDapMessage(message)),
    deliverRaw: (data) => connection.receive(Buffer.from(data, 'utf8')),
    events,
    adapterRequests,
    brokenReasons,
    warnings
  }
}

describe('createDapConnection', () => {
  it('要求に seq を振って送る', () => {
    const harness = createHarness()

    void harness.connection.request('initialize', { adapterID: 'fluvix' })

    expect(harness.sent).toEqual([
      { seq: 1, type: 'request', command: 'initialize', arguments: { adapterID: 'fluvix' } }
    ])
  })

  it('seq を使い回さない', () => {
    const harness = createHarness()

    void harness.connection.request('a')
    void harness.connection.request('b')

    expect(harness.sent.map((message) => message.seq)).toEqual([1, 2])
  })

  it('response の request_seq を使って要求に結び付ける', async () => {
    const harness = createHarness()
    const first = harness.connection.request('a')
    const second = harness.connection.request('b')

    harness.deliver({
      seq: 10,
      type: 'response',
      request_seq: 2,
      success: true,
      command: 'b',
      body: 'second'
    })
    harness.deliver({
      seq: 11,
      type: 'response',
      request_seq: 1,
      success: true,
      command: 'a',
      body: 'first'
    })

    await expect(first).resolves.toEqual({ status: 'success', body: 'first' })
    await expect(second).resolves.toEqual({ status: 'success', body: 'second' })
  })

  it('success=false の応答は failure として返す', async () => {
    const harness = createHarness()
    const pending = harness.connection.request('launch')

    harness.deliver({
      seq: 2,
      type: 'response',
      request_seq: 1,
      success: false,
      command: 'launch',
      message: 'failed',
      body: { detail: 'no program' }
    })

    await expect(pending).resolves.toEqual({
      status: 'failure',
      message: 'failed',
      body: { detail: 'no program' }
    })
  })

  it('Event 受信を受け手へ渡す', () => {
    const harness = createHarness()

    harness.deliver({ seq: 1, type: 'event', event: 'stopped', body: { reason: 'breakpoint' } })

    expect(harness.events).toEqual([{ event: 'stopped', body: { reason: 'breakpoint' } }])
  })

  it('adapter からの request には失敗応答を返す', () => {
    const harness = createHarness()

    harness.deliver({
      seq: 41,
      type: 'request',
      command: 'runInTerminal',
      arguments: { args: ['node', 'main.js'] }
    })

    expect(harness.adapterRequests).toEqual([
      { command: 'runInTerminal', args: { args: ['node', 'main.js'] } }
    ])
    expect(harness.sent).toEqual([
      {
        seq: 1,
        type: 'response',
        request_seq: 41,
        success: false,
        command: 'runInTerminal',
        message: 'the client does not handle "runInTerminal".'
      }
    ])
  })

  it('宛先の分からない response は警告にして読み進める', () => {
    const harness = createHarness()

    harness.deliver({
      seq: 1,
      type: 'response',
      request_seq: 99,
      success: true,
      command: 'unknown'
    })

    expect(harness.warnings).toHaveLength(1)
    expect(harness.brokenReasons).toEqual([])
  })

  it('invalid JSON は警告にして読み進める', () => {
    const harness = createHarness()

    harness.deliverRaw('Content-Length: 3\r\n\r\nbad')
    harness.deliver({ seq: 1, type: 'event', event: 'after' })

    expect(harness.warnings).toHaveLength(1)
    expect(harness.events).toEqual([{ event: 'after', body: undefined }])
  })

  it('malformed DAP payload は警告にして読み進める', () => {
    const harness = createHarness()
    const body = '{"seq":1,"type":"event"}'

    harness.deliverRaw(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    harness.deliver({ seq: 2, type: 'event', event: 'after' })

    expect(harness.warnings).toHaveLength(1)
    expect(harness.events).toEqual([{ event: 'after', body: undefined }])
  })

  it('malformed Content-Length は経路を閉じて pending request を片付ける', async () => {
    const harness = createHarness()
    const pending = harness.connection.request('a')

    harness.deliverRaw('Content-Length: nope\r\n\r\n')

    expect(harness.brokenReasons).toHaveLength(1)
    await expect(pending).resolves.toMatchObject({ status: 'closed' })
  })

  it('dispose で pending request をすべて closed にする', async () => {
    const harness = createHarness()
    const first = harness.connection.request('a')
    const second = harness.connection.request('b')

    harness.connection.dispose('the adapter closed.')

    await expect(first).resolves.toEqual({ status: 'closed', reason: 'the adapter closed.' })
    await expect(second).resolves.toEqual({ status: 'closed', reason: 'the adapter closed.' })
  })

  it('閉じた後の要求は送らずに closed を返す', async () => {
    const harness = createHarness()

    harness.connection.dispose('closed')

    await expect(harness.connection.request('a')).resolves.toEqual({
      status: 'closed',
      reason: 'closed'
    })
    expect(harness.sent).toEqual([])
  })

  it('送れなかった要求は待たせずに closed にする', async () => {
    const harness = createHarness({ failSend: true })

    await expect(harness.connection.request('a')).resolves.toEqual({
      status: 'closed',
      reason: 'the request could not be sent.'
    })
  })

  it('dispose は idempotent', async () => {
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
