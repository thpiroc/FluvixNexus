import { describe, expect, it, vi } from 'vitest'
import type { DebugAdapterCommand } from './adapterCatalog'
import type {
  DebugAdapterProcess,
  DebugAdapterProcessOptions,
  StartDebugAdapterProcessOutcome
} from './adapterProcess'
import type { DapConnection, DapRequestOutcome } from './dapConnection'
import { createSetBreakpointsArguments } from './dapBreakpoints'
import {
  createDebugSessionManager,
  type DebugSessionBreakpointChannel,
  type DebugSessionManager
} from './debugSessionManager'

/**
 * Breakpoint と Debug Session lifecycle の噛み合わせ（Session 6-3）。
 *
 * Session 6-2 の状態機械そのものは debugSessionManager.test.ts が見ている。
 * ここが見るのは**6-3 で足した一点**だけになる。
 *
 * ```
 * initialized → [ setBreakpoints ] → configurationDone → running
 * ```
 *
 * Electron も child_process も使わない（偽の adapter process を渡す）。
 */

const SOURCE = { path: 'D:\\proj\\src\\app.js', name: 'app.js' }

/** 仕込み（async）が終わるまで microtask を回す。 */
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
  readonly requests: readonly PendingRequest[]
  readonly resolve: (command: string, outcome: DapRequestOutcome) => Promise<void>
  readonly event: (event: string, body?: unknown) => void
}

function createCommand(): DebugAdapterCommand {
  return { name: 'Mock Debug Adapter', file: 'C:\\Tools\\mock.exe', args: [], cwd: 'D:\\proj' }
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
        const pending = requests.find((request) => request.command === command)

        if (pending === undefined) {
          throw new Error(`no pending request: ${command}`)
        }

        pending.resolve(outcome)
        await Promise.resolve()
      },
      event: (event, body) => {
        options.onEvent(event, body)
      }
    }
  }
}

function createManager(
  configurationHook?: (channel: DebugSessionBreakpointChannel) => Promise<void> | void
): { readonly manager: DebugSessionManager; readonly adapters: readonly AdapterHarness[] } {
  const adapters: AdapterHarness[] = []

  const manager = createDebugSessionManager({
    startTimeoutMs: 1_000,
    ...(configurationHook === undefined ? {} : { configurationHook }),
    startAdapterProcess: (options): StartDebugAdapterProcessOutcome => {
      const { harness, process } = createAdapterHarness(options)
      adapters.push(harness)

      return { status: 'started', process }
    }
  })

  return { manager, adapters }
}

function start(manager: DebugSessionManager): void {
  expect(
    manager.start({
      adapterId: 'mock',
      adapterCommand: createCommand(),
      launchArguments: { program: 'src/app.js' }
    }).status
  ).toBe('started')
}

/** start → initialize の応答 → initialized event → configurationDone まで進める。 */
async function reachRunning(
  manager: DebugSessionManager,
  adapters: readonly AdapterHarness[]
): Promise<AdapterHarness> {
  start(manager)

  const adapter = adapters[adapters.length - 1]

  await adapter.resolve('initialize', {
    status: 'success',
    body: { supportsConfigurationDoneRequest: true }
  })
  adapter.event('initialized')
  await Promise.resolve()
  await adapter.resolve('configurationDone', { status: 'success', body: undefined })

  expect(manager.getState()).toBe('running')

  return adapter
}

describe('仕込みの位置', () => {
  it('initialized の後、configurationDone の前に呼ばれる', async () => {
    const order: string[] = []

    const { manager, adapters } = createManager(async (channel) => {
      order.push('hook')
      void channel.setBreakpoints(createSetBreakpointsArguments(SOURCE, [3]))
      await Promise.resolve()
    })

    start(manager)

    const adapter = adapters[0]

    await adapter.resolve('initialize', {
      status: 'success',
      body: { supportsConfigurationDoneRequest: true }
    })

    expect(order).toEqual([])

    adapter.event('initialized')
    await flush()

    expect(order).toEqual(['hook'])
    expect(adapter.requests.map((request) => request.command)).toEqual([
      'initialize',
      'launch',
      'setBreakpoints',
      'configurationDone'
    ])
  })

  it('送るのは setBreakpoints の引数そのもの（絶対パスは Main の中だけ）', async () => {
    const { manager, adapters } = createManager((channel) => {
      void channel.setBreakpoints(createSetBreakpointsArguments(SOURCE, [3, 8]))
    })

    start(manager)
    const adapter = adapters[0]

    await adapter.resolve('initialize', {
      status: 'success',
      body: { supportsConfigurationDoneRequest: true }
    })
    adapter.event('initialized')
    await flush()

    expect(adapter.requests.find((request) => request.command === 'setBreakpoints')?.args).toEqual({
      source: SOURCE,
      breakpoints: [{ line: 3 }, { line: 8 }],
      lines: [3, 8],
      sourceModified: false
    })
  })

  /*
    configurationDone を名乗らない adapter でも仕込みは走る。
    breakpoint を送ってよい窓は `initialized` の後であって、
    `configurationDone` を送るかどうかとは別のことにあたる。
  */
  it('configurationDone を名乗らない adapter でも呼ばれる', async () => {
    const hook = vi.fn()
    const { manager, adapters } = createManager(hook)

    start(manager)
    const adapter = adapters[0]

    await adapter.resolve('initialize', {
      status: 'success',
      body: { supportsConfigurationDoneRequest: false }
    })
    adapter.event('initialized')
    await flush()

    expect(hook).toHaveBeenCalledTimes(1)
    expect(manager.getState()).toBe('running')
  })

  /* 印が付かないことと、走らせられないことは別のこと。 */
  it('仕込みが失敗しても Debug Session は始まる', async () => {
    const { manager, adapters } = createManager(() => {
      throw new Error('boom')
    })

    start(manager)
    const adapter = adapters[0]

    await adapter.resolve('initialize', {
      status: 'success',
      body: { supportsConfigurationDoneRequest: true }
    })
    adapter.event('initialized')
    await flush()
    await adapter.resolve('configurationDone', { status: 'success', body: undefined })

    expect(manager.getState()).toBe('running')
  })

  it('仕込みが無くても lifecycle は 6-2 のまま', async () => {
    const { manager, adapters } = createManager()

    start(manager)
    const adapter = adapters[0]

    await adapter.resolve('initialize', {
      status: 'success',
      body: { supportsConfigurationDoneRequest: true }
    })
    adapter.event('initialized')
    await Promise.resolve()
    await adapter.resolve('configurationDone', { status: 'success', body: undefined })

    expect(adapter.requests.map((request) => request.command)).toEqual([
      'initialize',
      'launch',
      'configurationDone'
    ])
    expect(manager.getState()).toBe('running')
  })
})

describe('送る口', () => {
  it('セッションが無い間は口が返らない', () => {
    const { manager } = createManager()

    expect(manager.getBreakpointChannel()).toBeNull()
  })

  /* 起動中の同期は仕込みが引き受ける（割り込ませない）。 */
  it('起動中は口が返らない', async () => {
    const { manager, adapters } = createManager()

    start(manager)
    expect(manager.getBreakpointChannel()).toBeNull()

    await adapters[0].resolve('initialize', {
      status: 'success',
      body: { supportsConfigurationDoneRequest: true }
    })

    expect(manager.getState()).toBe('starting')
    expect(manager.getBreakpointChannel()).toBeNull()
  })

  it('running 中は送り直せる', async () => {
    const { manager, adapters } = createManager()
    const adapter = await reachRunning(manager, adapters)

    const channel = manager.getBreakpointChannel()

    expect(channel).not.toBeNull()

    void channel?.setBreakpoints(createSetBreakpointsArguments(SOURCE, [5]))

    expect(adapter.requests.filter((request) => request.command === 'setBreakpoints')).toHaveLength(
      1
    )
  })

  it('stopped の間も送り直せる（停止中に印を足せる）', async () => {
    const { manager, adapters } = createManager()
    const adapter = await reachRunning(manager, adapters)

    adapter.event('stopped', { reason: 'breakpoint' })

    expect(manager.getState()).toBe('stopped')
    expect(manager.getBreakpointChannel()).not.toBeNull()
  })

  it('終わった後は口が返らない', async () => {
    const { manager, adapters } = createManager()

    await reachRunning(manager, adapters)
    manager.stop('test')

    expect(manager.getState()).toBe('idle')
    expect(manager.getBreakpointChannel()).toBeNull()
  })

  /*
    前のセッションへ渡した口は、握られたままでも adapter へ届かない
    （世代が一致しないため）。stale な口から新しい adapter を触らせない。
  */
  it('前のセッションの口は closed を返す', async () => {
    const { manager, adapters } = createManager()

    await reachRunning(manager, adapters)

    const stale = manager.getBreakpointChannel()

    expect(stale).not.toBeNull()

    manager.stop('test')

    const outcome = await stale?.setBreakpoints(createSetBreakpointsArguments(SOURCE, [1]))

    expect(outcome?.status).toBe('closed')
  })

  it('世代はセッションごとに進む', async () => {
    const { manager, adapters } = createManager()

    await reachRunning(manager, adapters)

    const first = manager.getBreakpointChannel()

    manager.stop('test')

    await reachRunning(manager, adapters)

    const second = manager.getBreakpointChannel()

    expect(second?.generation).toBeGreaterThan(first?.generation ?? 0)
  })
})
