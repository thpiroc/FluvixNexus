import { describe, expect, it, vi } from 'vitest'
import { createDapConnection, type DapConnection, type DapConnectionOptions } from './dapConnection'
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

function createHarness(options?: {
  readonly failSend?: boolean
  readonly onStartDebugging?: DapConnectionOptions['onStartDebugging']
}): Harness {
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
    },
    ...(options?.onStartDebugging === undefined
      ? {}
      : { onStartDebugging: options.onStartDebugging })
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

  describe('startDebugging（Session 6-15A）', () => {
    const START_ARGS = {
      request: 'launch',
      configuration: { type: 'pwa-node', __pendingTargetId: 't1' }
    }

    it('答える口が無ければ、他の逆方向 request と同じく断る', () => {
      const harness = createHarness()

      harness.deliver({ seq: 7, type: 'request', command: 'startDebugging', arguments: START_ARGS })

      expect(harness.adapterRequests).toEqual([{ command: 'startDebugging', args: START_ARGS }])
      expect(harness.sent).toEqual([
        {
          seq: 1,
          type: 'response',
          request_seq: 7,
          success: false,
          command: 'startDebugging',
          message: 'the client does not handle "startDebugging".'
        }
      ])
    })

    it('受けたら本文の無い成功応答を返し、seq を使い回さない', () => {
      const decide = vi.fn(() => ({ accepted: true }) as const)
      const harness = createHarness({ onStartDebugging: decide })

      harness.deliver({ seq: 8, type: 'request', command: 'startDebugging', arguments: START_ARGS })
      void harness.connection.request('threads')

      expect(decide).toHaveBeenCalledWith(START_ARGS)
      expect(harness.adapterRequests).toEqual([])
      expect(harness.sent).toEqual([
        { seq: 1, type: 'response', request_seq: 8, success: true, command: 'startDebugging' },
        { seq: 2, type: 'request', command: 'threads' }
      ])
    })

    it('断ったら失敗応答に口が決めた文言だけを載せる', () => {
      const harness = createHarness({
        onStartDebugging: () => ({ accepted: false, message: 'not now.' })
      })

      harness.deliver({ seq: 9, type: 'request', command: 'startDebugging', arguments: START_ARGS })

      expect(harness.sent).toEqual([
        {
          seq: 1,
          type: 'response',
          request_seq: 9,
          success: false,
          command: 'startDebugging',
          message: 'not now.'
        }
      ])
    })

    it('判断が例外を投げても失敗応答を返して読み進める', () => {
      const harness = createHarness({
        onStartDebugging: () => {
          throw new Error('C:\\secret\\path exploded')
        }
      })

      harness.deliver({ seq: 10, type: 'request', command: 'startDebugging', arguments: 'bad' })
      harness.deliver({ seq: 11, type: 'event', event: 'after' })

      expect(harness.sent).toEqual([
        {
          seq: 1,
          type: 'response',
          request_seq: 10,
          success: false,
          command: 'startDebugging',
          message: 'the client could not start the debug session.'
        }
      ])
      expect(harness.warnings).toHaveLength(1)
      expect(harness.events).toEqual([{ event: 'after', body: undefined }])
    })

    it('答える口があっても runInTerminal と任意の逆方向 request は断る', () => {
      const decide = vi.fn(() => ({ accepted: true }) as const)
      const harness = createHarness({ onStartDebugging: decide })

      harness.deliver({
        seq: 12,
        type: 'request',
        command: 'runInTerminal',
        arguments: { args: ['calc.exe'] }
      })
      harness.deliver({ seq: 13, type: 'request', command: 'startDebuggingEx', arguments: {} })

      expect(decide).not.toHaveBeenCalled()
      expect(harness.sent).toEqual([
        {
          seq: 1,
          type: 'response',
          request_seq: 12,
          success: false,
          command: 'runInTerminal',
          message: 'the client does not handle "runInTerminal".'
        },
        {
          seq: 2,
          type: 'response',
          request_seq: 13,
          success: false,
          command: 'startDebuggingEx',
          message: 'the client does not handle "startDebuggingEx".'
        }
      ])
    })
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
