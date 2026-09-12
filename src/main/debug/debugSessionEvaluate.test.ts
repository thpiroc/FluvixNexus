import { describe, expect, it, vi } from 'vitest'
import type { DebugAdapterCommand } from './adapterCatalog'
import type { DebugAdapterProcess, DebugAdapterProcessOptions } from './adapterProcess'
import type { DapConnection, DapRequestOutcome } from './dapConnection'
import { createDebugSessionManager } from './debugSessionManager'

/**
 * Evaluate の口（Session 6-7）が、Session 6-5 / 6-6 と同じ形で開いていること。
 *
 * ここで見るのは「stopped の間だけ開くこと」「送れるのが `evaluate` の1つだけであること」
 * 「停止が変わった後の口は adapter へ届かないこと」の3つになる。
 */

const OK: DapRequestOutcome = { status: 'success', body: undefined }

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] }
}))

interface PendingRequest {
  readonly command: string
  readonly args: unknown
  readonly resolve: (outcome: DapRequestOutcome) => void
}

function settle(): Promise<void> {
  return new Promise((resolveSettle) => setTimeout(resolveSettle, 0))
}

function createCommand(): DebugAdapterCommand {
  return { name: 'Mock Debug Adapter', file: 'C:\\Tools\\mock.exe', args: [], cwd: 'D:\\proj' }
}

function createAdapterHarness(options: DebugAdapterProcessOptions) {
  const requests: PendingRequest[] = []
  let disposed = false

  const connection: DapConnection = {
    receive: vi.fn(),
    request: vi.fn((command: string, args?: unknown) => {
      if (disposed) {
        return Promise.resolve({ status: 'closed', reason: 'disposed' } satisfies DapRequestOutcome)
      }

      return new Promise<DapRequestOutcome>((resolveRequest) => {
        requests.push({ command, args, resolve: resolveRequest })
      })
    }),
    dispose: vi.fn((reason: string) => {
      disposed = true

      for (const request of requests) {
        request.resolve({ status: 'closed', reason })
      }
    })
  }

  const process: DebugAdapterProcess = {
    connection,
    pid: 1234,
    dispose: vi.fn((reason) => {
      connection.dispose(reason)
      options.onClose?.('dispose', null, null)
    })
  }

  return {
    process,
    requests,
    event: (event: string, body?: unknown) => options.onEvent(event, body),
    resolve: async (command: string, outcome: DapRequestOutcome = OK) => {
      const pending = requests.find((request) => request.command === command)

      if (pending === undefined) {
        throw new Error(`no pending request: ${command}`)
      }

      pending.resolve(outcome)
      await settle()
    }
  }
}

async function startRunning() {
  const adapters: ReturnType<typeof createAdapterHarness>[] = []
  const manager = createDebugSessionManager({
    startTimeoutMs: 1_000,
    startAdapterProcess: (options) => {
      const adapter = createAdapterHarness(options)
      adapters.push(adapter)

      return { status: 'started', process: adapter.process }
    }
  })

  expect(manager.start({ adapterId: 'mock', adapterCommand: createCommand() }).status).toBe(
    'started'
  )

  const adapter = adapters[0]
  await adapter.resolve('initialize', {
    status: 'success',
    body: { supportsConfigurationDoneRequest: true }
  })
  adapter.event('initialized')
  await settle()
  await adapter.resolve('configurationDone')

  return { manager, adapter }
}

describe('debug session evaluate channel (Session 6-7)', () => {
  it('opens only while stopped', async () => {
    const { manager, adapter } = await startRunning()

    expect(manager.getEvaluateChannel()).toBeNull()

    adapter.event('stopped', { reason: 'breakpoint', threadId: 1 })

    expect(manager.getEvaluateChannel()).toMatchObject({
      sessionId: 'debug-session-1',
      generation: 1,
      stopGeneration: 1
    })

    adapter.event('continued')

    expect(manager.getEvaluateChannel()).toBeNull()
  })

  it('sends the evaluate request through the feature channel', async () => {
    const { manager, adapter } = await startRunning()
    adapter.event('stopped', { reason: 'breakpoint', threadId: 1 })

    const pending = manager
      .getEvaluateChannel()
      ?.requestEvaluate({ expression: 'count', frameId: 11, context: 'repl' })
    await settle()

    expect(adapter.requests.find((request) => request.command === 'evaluate')?.args).toEqual({
      expression: 'count',
      frameId: 11,
      context: 'repl'
    })

    await adapter.resolve('evaluate', { status: 'success', body: { result: '3' } })
    await expect(pending).resolves.toEqual({ status: 'success', body: { result: '3' } })
  })

  /**
   * 口は取った時点の停止を閉じ込める。次の停止が来た後に前の口を使っても、
   * adapter へは1通も届かない。
   */
  it('sends nothing once the session moved to the next stop', async () => {
    const { manager, adapter } = await startRunning()
    adapter.event('stopped', { reason: 'breakpoint', threadId: 1 })

    const channel = manager.getEvaluateChannel()
    adapter.event('continued')
    adapter.event('stopped', { reason: 'step', threadId: 1 })

    const outcome = await channel?.requestEvaluate({
      expression: 'count',
      frameId: 11,
      context: 'repl'
    })

    expect(outcome?.status).toBe('closed')
    expect(adapter.requests.some((request) => request.command === 'evaluate')).toBe(false)
    expect(manager.getEvaluateChannel()?.stopGeneration).toBe(2)
  })

  it('sends nothing once the session has ended', async () => {
    const { manager, adapter } = await startRunning()
    adapter.event('stopped', { reason: 'breakpoint', threadId: 1 })

    const channel = manager.getEvaluateChannel()
    manager.stop('the test ended the session.')

    const outcome = await channel?.requestEvaluate({
      expression: 'count',
      frameId: 11,
      context: 'repl'
    })

    expect(outcome?.status).toBe('closed')
    expect(adapter.requests.some((request) => request.command === 'evaluate')).toBe(false)
    expect(manager.getEvaluateChannel()).toBeNull()
  })

  /** Variables の口とは別物（相乗りさせていないこと）。 */
  it('is a separate channel from the variables channel', async () => {
    const { manager, adapter } = await startRunning()
    adapter.event('stopped', { reason: 'breakpoint', threadId: 1 })

    const evaluateChannel = manager.getEvaluateChannel()
    const variablesChannel = manager.getVariablesChannel()

    expect(Object.keys(evaluateChannel ?? {}).sort()).toEqual([
      'generation',
      'requestEvaluate',
      'sessionId',
      'stopGeneration'
    ])
    expect(variablesChannel).not.toHaveProperty('requestEvaluate')
    expect(evaluateChannel).not.toHaveProperty('requestScopes')
    expect(evaluateChannel).not.toHaveProperty('requestVariables')
  })
})
