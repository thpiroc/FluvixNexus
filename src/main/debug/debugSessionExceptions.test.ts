import { describe, expect, it, vi } from 'vitest'
import type { DebugAdapterCommand } from './adapterCatalog'
import type {
  DebugAdapterProcess,
  DebugAdapterProcessOptions,
  StartDebugAdapterProcessOutcome
} from './adapterProcess'
import type { DapConnection, DapRequestOutcome } from './dapConnection'
import {
  createDebugSessionManager,
  type DebugSessionBreakpointChannel,
  type DebugSessionManager,
  type DebugSessionStoppedEvent
} from './debugSessionManager'

/**
 * 例外停止と Debug Session lifecycle の噛み合わせ（Session 6-13）。
 *
 * ```
 * initialized → [ setBreakpoints ] → [ setExceptionBreakpoints ] → configurationDone → running
 * stopped(reason) → Call Stack の口 / stopped listener に理由が載る
 * stopped + supportsExceptionInfoRequest → exceptionInfo の口
 * ```
 *
 * Electron も child_process も使わない（偽の adapter process を渡す。debugSessionBreakpoints.test.ts と同じ形）。
 */

const DEBUGPY_CAPABILITIES = {
  supportsConfigurationDoneRequest: true,
  supportsExceptionInfoRequest: true,
  exceptionBreakpointFilters: [
    { filter: 'raised', label: 'Raised Exceptions', default: false },
    { filter: 'uncaught', label: 'Uncaught Exceptions', default: true },
    { filter: 'userUnhandled', label: 'User Uncaught Exceptions', default: false }
  ]
}

async function flush(): Promise<void> {
  for (let tick = 0; tick < 8; tick += 1) {
    await Promise.resolve()
  }
}

interface PendingRequest {
  readonly command: string
  readonly args: unknown
  readonly resolve: (outcome: DapRequestOutcome) => void
}

interface AdapterHarness {
  readonly requests: PendingRequest[]
  readonly resolve: (command: string, outcome: DapRequestOutcome) => Promise<void>
  readonly event: (event: string, body?: unknown) => void
}

function createCommand(): DebugAdapterCommand {
  return { name: 'Mock Debug Adapter', file: 'C:\\Tools\\mock.exe', args: [], cwd: 'C:\\data' }
}

function createAdapterHarness(options: DebugAdapterProcessOptions): {
  readonly harness: AdapterHarness
  readonly process: DebugAdapterProcess
} {
  const requests: PendingRequest[] = []
  let disposed = false

  const connection: DapConnection = {
    receive: vi.fn(),
    request: vi.fn((command: string, args?: unknown) => {
      if (disposed) {
        return Promise.resolve({ status: 'closed', reason: 'disposed' } satisfies DapRequestOutcome)
      }

      return new Promise<DapRequestOutcome>((resolve) => {
        requests.push({ command, args, resolve })
      })
    }),
    dispose: vi.fn((reason: string) => {
      if (disposed) {
        return
      }

      disposed = true

      for (const request of [...requests]) {
        request.resolve({ status: 'closed', reason })
      }
    })
  }

  return {
    process: {
      connection,
      pid: 4321,
      dispose: vi.fn((reason: string) => {
        connection.dispose(reason)
        options.onClose?.('dispose', null, null)
      })
    },
    harness: {
      requests,
      resolve: async (command, outcome) => {
        const index = requests.findIndex((request) => request.command === command)

        if (index < 0) {
          throw new Error(`no pending request: ${command}`)
        }

        const [pending] = requests.splice(index, 1)
        pending?.resolve(outcome)
        await flush()
      },
      event: (event, body) => {
        options.onEvent(event, body)
      }
    }
  }
}

function createManager(
  configurationHook?: (channel: DebugSessionBreakpointChannel) => Promise<void> | void
): {
  readonly manager: DebugSessionManager
  readonly adapters: AdapterHarness[]
  readonly logs: string[]
} {
  const adapters: AdapterHarness[] = []
  const logs: string[] = []

  const manager = createDebugSessionManager({
    startTimeoutMs: 1_000,
    ...(configurationHook === undefined ? {} : { configurationHook }),
    onLog: (_level, message) => {
      logs.push(message)
    },
    startAdapterProcess: (options): StartDebugAdapterProcessOutcome => {
      const { harness, process } = createAdapterHarness(options)
      adapters.push(harness)

      return { status: 'started', process }
    }
  })

  return { manager, adapters, logs }
}

/** initialize → launch → initialized まで進め、仕込みの窓に入ったところで返す。 */
async function startToConfiguration(
  manager: DebugSessionManager,
  adapters: AdapterHarness[],
  options: { readonly filters?: readonly string[]; readonly capabilities?: unknown } = {}
): Promise<AdapterHarness> {
  expect(
    manager.start({
      adapterId: 'mock',
      adapterCommand: createCommand(),
      launchArguments: { program: 'main.py' },
      ...(options.filters === undefined ? {} : { exceptionBreakpointFilters: options.filters })
    }).status
  ).toBe('started')

  const adapter = adapters.at(-1)

  if (adapter === undefined) {
    throw new Error('adapter was not started')
  }

  await adapter.resolve('initialize', {
    status: 'success',
    body: options.capabilities ?? DEBUGPY_CAPABILITIES
  })
  adapter.event('initialized')
  await flush()

  return adapter
}

function commands(adapter: AdapterHarness): string[] {
  return adapter.requests.map((request) => request.command)
}

async function startRunning(
  manager: DebugSessionManager,
  adapters: AdapterHarness[],
  capabilities: unknown = DEBUGPY_CAPABILITIES
): Promise<AdapterHarness> {
  const adapter = await startToConfiguration(manager, adapters, { capabilities })

  await adapter.resolve('configurationDone', { status: 'success', body: {} })
  expect(manager.getState()).toBe('running')

  return adapter
}

describe('setExceptionBreakpoints in the configuration window', () => {
  it('sends the table filters after setBreakpoints and before configurationDone', async () => {
    const order: string[] = []
    const { manager, adapters } = createManager(async (channel) => {
      order.push('hook')
      await channel.setBreakpoints({
        source: { path: 'C:\\ws\\main.py', name: 'main.py' },
        breakpoints: [{ line: 3 }],
        lines: [3],
        sourceModified: false
      })
      order.push('hook-done')
    })
    const adapter = await startToConfiguration(manager, adapters, { filters: ['uncaught'] })

    expect(commands(adapter)).toEqual(['launch', 'setBreakpoints'])
    await adapter.resolve('setBreakpoints', { status: 'success', body: { breakpoints: [] } })

    expect(commands(adapter)).toEqual(['launch', 'setExceptionBreakpoints'])
    expect(adapter.requests.find((r) => r.command === 'setExceptionBreakpoints')?.args).toEqual({
      filters: ['uncaught']
    })
    expect(order).toEqual(['hook', 'hook-done'])

    await adapter.resolve('setExceptionBreakpoints', { status: 'success', body: {} })
    expect(commands(adapter)).toEqual(['launch', 'configurationDone'])

    await adapter.resolve('configurationDone', { status: 'success', body: {} })
    expect(manager.getState()).toBe('running')
  })

  it('sends nothing when the start options carry no filters (6-12 lifecycle unchanged)', async () => {
    const { manager, adapters } = createManager()
    const adapter = await startToConfiguration(manager, adapters)

    expect(commands(adapter)).toEqual(['launch', 'configurationDone'])
  })

  it('sends nothing when the adapter did not advertise the requested filter', async () => {
    const { manager, adapters } = createManager()
    const adapter = await startToConfiguration(manager, adapters, {
      filters: ['uncaught'],
      capabilities: {
        supportsConfigurationDoneRequest: true,
        exceptionBreakpointFilters: [{ filter: 'all' }]
      }
    })

    expect(commands(adapter)).toEqual(['launch', 'configurationDone'])

    const noFilters = createManager()
    const second = await startToConfiguration(noFilters.manager, noFilters.adapters, {
      filters: ['uncaught'],
      capabilities: { supportsConfigurationDoneRequest: true }
    })

    expect(commands(second)).toEqual(['launch', 'configurationDone'])
  })

  it('keeps the session going when the adapter rejects setExceptionBreakpoints', async () => {
    const { manager, adapters, logs } = createManager()
    const adapter = await startToConfiguration(manager, adapters, { filters: ['uncaught'] })

    await adapter.resolve('setExceptionBreakpoints', {
      status: 'failure',
      message: 'nope at C:\\secret\\adapter.py',
      body: undefined
    })
    expect(commands(adapter)).toEqual(['launch', 'configurationDone'])

    await adapter.resolve('configurationDone', { status: 'success', body: {} })
    expect(manager.getState()).toBe('running')
    expect(logs.some((line) => line.includes('setExceptionBreakpoints'))).toBe(true)
  })

  it('does not send configurationDone when Stop arrives while waiting for setExceptionBreakpoints', async () => {
    const { manager, adapters } = createManager()
    const adapter = await startToConfiguration(manager, adapters, { filters: ['uncaught'] })

    const stopping = manager.requestStop()
    await flush()
    await adapter.resolve('setExceptionBreakpoints', { status: 'success', body: {} })

    expect(commands(adapter)).not.toContain('configurationDone')

    await adapter.resolve('disconnect', { status: 'success', body: {} })
    await stopping
    expect(manager.getState()).toBe('idle')
  })
})

describe('stopped reason on events and channels', () => {
  it('normalizes the reason for listeners and the call stack channel', async () => {
    const { manager, adapters } = createManager()
    const stopped: DebugSessionStoppedEvent[] = []
    manager.onStopped((event) => stopped.push(event))
    const adapter = await startRunning(manager, adapters)

    adapter.event('stopped', {
      reason: 'exception',
      description: 'bad value 42',
      text: 'ValueError',
      threadId: 1,
      allThreadsStopped: true
    })

    expect(stopped.at(-1)?.stop).toEqual({
      reason: 'exception',
      description: 'bad value 42',
      text: 'ValueError'
    })
    expect(manager.getCallStackChannel()?.stop).toEqual({
      reason: 'exception',
      description: 'bad value 42',
      text: 'ValueError'
    })
  })

  it.each([
    [{ reason: 'breakpoint', threadId: 1 }, 'breakpoint'],
    [{ reason: 'step', threadId: 1 }, 'step'],
    [{ reason: 'pause', threadId: 1 }, 'pause'],
    [{ reason: 'entry', threadId: 1 }, 'entry'],
    [{ reason: 'custom adapter thing', threadId: 1 }, 'unknown'],
    [undefined, 'unknown'],
    ['malformed', 'unknown']
  ])('reads stopped body %j as %s and still stops', async (body, reason) => {
    const { manager, adapters } = createManager()
    const adapter = await startRunning(manager, adapters)

    adapter.event('stopped', body)

    expect(manager.getState()).toBe('stopped')
    expect(manager.getCallStackChannel()?.stop?.reason).toBe(reason)
  })

  it('replaces the reason on the next stop', async () => {
    const { manager, adapters } = createManager()
    const adapter = await startRunning(manager, adapters)

    adapter.event('stopped', { reason: 'breakpoint', threadId: 1 })
    expect(manager.getCallStackChannel()?.stop?.reason).toBe('breakpoint')

    adapter.event('stopped', { reason: 'step', threadId: 1 })
    expect(manager.getCallStackChannel()?.stop?.reason).toBe('step')
  })
})

describe('exceptionInfo channel', () => {
  it('opens only while stopped for adapters that advertise exceptionInfo', async () => {
    const { manager, adapters } = createManager()
    const adapter = await startRunning(manager, adapters)

    expect(manager.getExceptionInfoChannel()).toBeNull()

    adapter.event('stopped', { reason: 'exception', threadId: 1 })
    const channel = manager.getExceptionInfoChannel()

    expect(channel).not.toBeNull()
    void channel?.requestExceptionInfo({ threadId: 1 })
    expect(adapter.requests.at(-1)).toMatchObject({
      command: 'exceptionInfo',
      args: { threadId: 1 }
    })
  })

  it('is never offered to adapters that did not advertise supportsExceptionInfoRequest', async () => {
    const { manager, adapters } = createManager()
    const adapter = await startRunning(manager, adapters, {
      supportsConfigurationDoneRequest: true
    })

    adapter.event('stopped', { reason: 'exception', threadId: 1 })

    expect(manager.getState()).toBe('stopped')
    expect(manager.getExceptionInfoChannel()).toBeNull()
    expect(commands(adapter)).not.toContain('exceptionInfo')
  })

  it('closes a channel from an older stop without reaching the adapter', async () => {
    const { manager, adapters } = createManager()
    const adapter = await startRunning(manager, adapters)

    adapter.event('stopped', { reason: 'exception', threadId: 1 })
    const old = manager.getExceptionInfoChannel()

    adapter.event('stopped', { reason: 'exception', threadId: 1 })
    const outcome = await old?.requestExceptionInfo({ threadId: 1 })

    expect(outcome?.status).toBe('closed')
    expect(commands(adapter)).not.toContain('exceptionInfo')
  })

  it('closes after continued and after the session ends', async () => {
    const { manager, adapters } = createManager()
    const adapter = await startRunning(manager, adapters)

    adapter.event('stopped', { reason: 'exception', threadId: 1 })
    const channel = manager.getExceptionInfoChannel()

    adapter.event('continued', { threadId: 1 })
    expect(manager.getExceptionInfoChannel()).toBeNull()
    expect((await channel?.requestExceptionInfo({ threadId: 1 }))?.status).toBe('closed')

    adapter.event('stopped', { reason: 'exception', threadId: 1 })
    const beforeExit = manager.getExceptionInfoChannel()
    adapter.event('exited', { exitCode: 1 })

    expect(manager.getState()).toBe('idle')
    expect(manager.getExceptionInfoChannel()).toBeNull()
    expect((await beforeExit?.requestExceptionInfo({ threadId: 1 }))?.status).toBe('closed')
  })
})
