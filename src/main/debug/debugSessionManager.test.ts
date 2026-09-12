import { describe, expect, it, vi } from 'vitest'
import {
  createDebugSessionManager,
  type DebugSessionManager,
  type DebugSessionState
} from './debugSessionManager'
import type {
  DebugAdapterProcess,
  DebugAdapterProcessOptions,
  DebugAdapterProcessCloseReason
} from './adapterProcess'
import type { DebugAdapterCommand } from './adapterCatalog'
import type { DapConnection, DapRequestOutcome } from './dapConnection'

interface PendingRequest {
  readonly command: string
  readonly args: unknown
  readonly resolve: (outcome: DapRequestOutcome) => void
}

interface AdapterHarness {
  readonly process: DebugAdapterProcess
  readonly connection: DapConnection
  readonly requests: readonly PendingRequest[]
  readonly disposeReasons: readonly string[]
  readonly options: DebugAdapterProcessOptions
  readonly resolve: (command: string, outcome: DapRequestOutcome) => Promise<void>
  readonly event: (event: string, body?: unknown) => void
  readonly error: (message: string) => void
  readonly close: (
    reason?: DebugAdapterProcessCloseReason,
    code?: number | null,
    signal?: NodeJS.Signals | null
  ) => void
}

function createCommand(): DebugAdapterCommand {
  return {
    name: 'Mock Debug Adapter',
    file: 'C:\\Tools\\mock-adapter.exe',
    args: ['--stdio'],
    cwd: 'D:\\Workspace'
  }
}

function createStartOptions(overrides?: Partial<DebugAdapterCommand>) {
  return {
    adapterId: 'mock',
    adapterCommand: { ...createCommand(), ...overrides },
    launchArguments: { program: 'main.js' },
    clientName: 'Test Client',
    clientVersion: '1.2.3',
    processId: 42
  }
}

function createHarness(): {
  readonly manager: DebugSessionManager
  readonly adapters: readonly AdapterHarness[]
  readonly states: readonly DebugSessionState[]
} {
  const adapters: AdapterHarness[] = []
  const states: DebugSessionState[] = []

  const manager = createDebugSessionManager({
    startTimeoutMs: 1_000,
    startAdapterProcess: (options) => {
      const adapter = createAdapterHarness(options)
      adapters.push(adapter)

      return { status: 'started', process: adapter.process }
    }
  })

  manager.onStateChange((state) => {
    states.push(state)
  })

  return { manager, adapters, states }
}

function createSpawnFailureHarness(): DebugSessionManager {
  return createDebugSessionManager({
    startTimeoutMs: 1_000,
    startAdapterProcess: () => ({ status: 'spawn-failed', detail: 'Error: boom' })
  })
}

function createTimeoutHarness(): ReturnType<typeof createHarness> {
  const adapters: AdapterHarness[] = []
  const states: DebugSessionState[] = []

  const manager = createDebugSessionManager({
    startTimeoutMs: 1,
    startAdapterProcess: (options) => {
      const adapter = createAdapterHarness(options)
      adapters.push(adapter)

      return { status: 'started', process: adapter.process }
    }
  })

  manager.onStateChange((state) => {
    states.push(state)
  })

  return { manager, adapters, states }
}

function createAdapterHarness(options: DebugAdapterProcessOptions): AdapterHarness {
  const requests: PendingRequest[] = []
  const disposeReasons: string[] = []
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

  const process: DebugAdapterProcess = {
    connection,
    pid: 1234,
    dispose: vi.fn((reason: string) => {
      if (disposed) {
        return
      }

      disposeReasons.push(reason)
      connection.dispose(reason)
      options.onClose?.('dispose', null, null)
    })
  }

  return {
    process,
    connection,
    requests,
    disposeReasons,
    options,
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
    },
    error: (message) => {
      options.onError?.(new Error(message))
    },
    close: (reason = 'close', code = 0, signal = null) => {
      options.onClose?.(reason, code, signal)
    }
  }
}

async function startRunning(harness: ReturnType<typeof createHarness>): Promise<AdapterHarness> {
  expect(harness.manager.start(createStartOptions()).status).toBe('started')
  const adapter = harness.adapters[0]

  await adapter.resolve('initialize', {
    status: 'success',
    body: { supportsConfigurationDoneRequest: true }
  })
  adapter.event('initialized')
  await Promise.resolve()
  await adapter.resolve('configurationDone', { status: 'success', body: undefined })

  expect(harness.manager.getState()).toBe('running')

  return adapter
}

describe('debug session manager', () => {
  it('starts in idle', () => {
    const { manager } = createHarness()

    expect(manager.getState()).toBe('idle')
    expect(manager.getSessionId()).toBeNull()
  })

  it('starts the adapter from a Main-owned command and sends initialize / launch', async () => {
    const harness = createHarness()

    expect(harness.manager.start(createStartOptions()).status).toBe('started')
    expect(harness.manager.getState()).toBe('starting')

    const adapter = harness.adapters[0]

    expect(adapter.options.command).toEqual(createCommand())
    expect(adapter.requests[0]).toMatchObject({
      command: 'initialize',
      args: {
        adapterID: 'mock',
        clientID: 'fluvix-nexus',
        clientName: 'Test Client',
        clientVersion: '1.2.3',
        processId: 42,
        supportsRunInTerminalRequest: false
      }
    })

    await adapter.resolve('initialize', {
      status: 'success',
      body: { supportsConfigurationDoneRequest: false }
    })

    expect(adapter.requests.map((request) => request.command)).toEqual(['initialize', 'launch'])
  })

  it('moves to running after initialized and configurationDone, without waiting for launch response', async () => {
    const harness = createHarness()

    expect(harness.manager.start(createStartOptions()).status).toBe('started')
    const adapter = harness.adapters[0]

    await adapter.resolve('initialize', {
      status: 'success',
      body: { supportsConfigurationDoneRequest: true }
    })
    adapter.event('initialized')
    await Promise.resolve()

    expect(adapter.requests.map((request) => request.command)).toEqual([
      'initialize',
      'launch',
      'configurationDone'
    ])

    await adapter.resolve('configurationDone', { status: 'success', body: undefined })

    expect(harness.manager.getState()).toBe('running')
    expect(adapter.requests.find((request) => request.command === 'launch')).toBeDefined()
  })

  it('enters stopped and resumes to running from adapter events', async () => {
    const harness = createHarness()
    const adapter = await startRunning(harness)

    adapter.event('stopped', { reason: 'breakpoint' })
    expect(harness.manager.getState()).toBe('stopped')

    adapter.event('continued')
    expect(harness.manager.getState()).toBe('running')
  })

  it('rejects a second session while one is active', async () => {
    const harness = createHarness()

    expect(harness.manager.start(createStartOptions()).status).toBe('started')
    expect(harness.manager.start(createStartOptions()).status).toBe('already-running')
    expect(harness.adapters).toHaveLength(1)
  })

  it('returns terminating sessions to idle and disposes the adapter once', async () => {
    const harness = createHarness()
    const adapter = await startRunning(harness)

    expect(harness.manager.stop('normal stop')).toEqual({ status: 'stopped' })
    expect(harness.manager.getState()).toBe('idle')
    expect(adapter.requests.map((request) => request.command)).toContain('disconnect')

    harness.manager.stop('again')
    harness.manager.dispose('again')

    expect(adapter.process.dispose).toHaveBeenCalledTimes(1)
    expect(adapter.disposeReasons).toEqual(['normal stop'])
  })

  it('cleans up start failure after initialize failure', async () => {
    const harness = createHarness()

    expect(harness.manager.start(createStartOptions()).status).toBe('started')
    const adapter = harness.adapters[0]

    await adapter.resolve('initialize', { status: 'failure', message: 'bad init', body: undefined })

    expect(harness.manager.getState()).toBe('idle')
    expect(adapter.process.dispose).toHaveBeenCalledWith('bad init')
  })

  it('cleans up a start that never reaches initialized', async () => {
    const harness = createTimeoutHarness()

    expect(harness.manager.start(createStartOptions()).status).toBe('started')
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(harness.manager.getState()).toBe('idle')
    expect(harness.adapters[0].process.dispose).toHaveBeenCalledWith(
      'debug session start timed out.'
    )
  })

  it('cleans up synchronous spawn failure', () => {
    const manager = createSpawnFailureHarness()

    expect(manager.start(createStartOptions())).toEqual({
      status: 'spawn-failed',
      detail: 'Error: boom'
    })
    expect(manager.getState()).toBe('idle')
  })

  it('cleans up adapter errors and exits', async () => {
    const errorHarness = createHarness()
    const errorAdapter = await startRunning(errorHarness)

    errorAdapter.error('boom')
    expect(errorHarness.manager.getState()).toBe('idle')

    const closeHarness = createHarness()
    const closeAdapter = await startRunning(closeHarness)

    closeAdapter.close('close', 1, null)
    expect(closeHarness.manager.getState()).toBe('idle')
  })

  it('cleans up pending requests by disposing the DAP connection', async () => {
    const harness = createHarness()
    const adapter = await startRunning(harness)

    const pending = adapter.connection.request('threads')
    harness.manager.stop('pending cleanup')

    await expect(pending).resolves.toEqual({ status: 'closed', reason: 'pending cleanup' })
    expect(adapter.connection.dispose).toHaveBeenCalledWith('pending cleanup')
  })

  it('ignores stale generation callbacks from an old adapter', async () => {
    const harness = createHarness()
    const oldAdapter = await startRunning(harness)

    harness.manager.stop('replace session')
    expect(harness.manager.start(createStartOptions({ name: 'New Adapter' })).status).toBe(
      'started'
    )
    expect(harness.manager.getState()).toBe('starting')

    oldAdapter.event('stopped')
    oldAdapter.close('close', 1, null)

    expect(harness.manager.getState()).toBe('starting')
    expect(harness.adapters).toHaveLength(2)
  })

  it('emits output events from the active adapter only', async () => {
    const harness = createHarness()
    const outputs: unknown[] = []
    const unsubscribe = harness.manager.onOutput((event) => {
      outputs.push(event)
    })
    const oldAdapter = await startRunning(harness)

    oldAdapter.event('output', { category: 'stdout', output: 'one' })

    expect(outputs).toEqual([
      {
        sessionId: 'debug-session-1',
        generation: 1,
        body: { category: 'stdout', output: 'one' }
      }
    ])

    harness.manager.stop('replace session')
    expect(harness.manager.start(createStartOptions({ name: 'New Adapter' })).status).toBe(
      'started'
    )

    oldAdapter.event('output', { category: 'stderr', output: 'stale' })

    expect(outputs).toHaveLength(1)

    unsubscribe()
    harness.adapters[1]?.event('output', { category: 'stdout', output: 'ignored' })

    expect(outputs).toHaveLength(1)
  })

  it('workspace switch and app quit cleanup are the same idempotent dispose path', async () => {
    const workspaceHarness = createHarness()
    const workspaceAdapter = await startRunning(workspaceHarness)

    workspaceHarness.manager.dispose('the workspace folder changed.')
    expect(workspaceHarness.manager.getState()).toBe('idle')
    expect(workspaceAdapter.disposeReasons).toEqual(['the workspace folder changed.'])

    const quitHarness = createHarness()
    const quitAdapter = await startRunning(quitHarness)

    quitHarness.manager.dispose('the application is quitting.')
    quitHarness.manager.dispose('the application is quitting again.')

    expect(quitHarness.manager.getState()).toBe('idle')
    expect(quitAdapter.process.dispose).toHaveBeenCalledTimes(1)
    expect(quitAdapter.disposeReasons).toEqual(['the application is quitting.'])
  })

  it('has no orphan process after stop, start failure, error, or exit', async () => {
    const stopHarness = createHarness()
    const stopAdapter = await startRunning(stopHarness)
    stopHarness.manager.stop('normal stop')
    expect(stopAdapter.process.dispose).toHaveBeenCalledTimes(1)

    const failHarness = createHarness()
    expect(failHarness.manager.start(createStartOptions()).status).toBe('started')
    await failHarness.adapters[0].resolve('initialize', {
      status: 'closed',
      reason: 'adapter closed before init'
    })
    expect(failHarness.adapters[0].process.dispose).toHaveBeenCalledTimes(1)

    const errorHarness = createHarness()
    const errorAdapter = await startRunning(errorHarness)
    errorAdapter.error('boom')
    expect(errorAdapter.process.dispose).toHaveBeenCalledTimes(1)

    const exitHarness = createHarness()
    const exitAdapter = await startRunning(exitHarness)
    exitAdapter.close('close', 0, null)
    expect(exitAdapter.process.dispose).toHaveBeenCalledTimes(1)
  })

  it('smokes the lifecycle through a real stdio mock adapter process', async () => {
    const manager = createDebugSessionManager({ startTimeoutMs: 1_000 })
    const running = waitForState(manager, 'running')

    expect(
      manager.start({
        adapterId: 'mock',
        adapterCommand: {
          name: 'Node mock DAP adapter',
          file: process.execPath,
          args: ['-e', MOCK_DAP_SESSION_ADAPTER_SCRIPT],
          cwd: process.cwd(),
          env: process.env
        },
        launchArguments: { program: 'main.js' }
      }).status
    ).toBe('started')

    await running
    expect(manager.getState()).toBe('running')

    manager.stop('smoke complete')
    expect(manager.getState()).toBe('idle')
  })
})

function waitForState(manager: DebugSessionManager, expected: DebugSessionState): Promise<void> {
  if (manager.getState() === expected) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`timed out waiting for debug session state: ${expected}`))
    }, 1_000)
    const unsubscribe = manager.onStateChange((state) => {
      if (state !== expected) {
        return
      }

      clearTimeout(timer)
      unsubscribe()
      resolve()
    })
  })
}

const MOCK_DAP_SESSION_ADAPTER_SCRIPT = String.raw`
let pending = Buffer.alloc(0)
let nextSeq = 1
const separator = '\r\n\r\n'

function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  process.stdout.write('Content-Length: ' + body.byteLength + separator)
  process.stdout.write(body)
}

process.stdin.on('data', (chunk) => {
  pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])

  for (;;) {
    const separatorAt = pending.indexOf(separator)

    if (separatorAt < 0) {
      return
    }

    const header = pending.subarray(0, separatorAt).toString('ascii')
    const match = /content-length:\s*(\d+)/i.exec(header)

    if (match === null) {
      process.exit(2)
    }

    const bodyAt = separatorAt + separator.length
    const bodyEnd = bodyAt + Number(match[1])

    if (pending.length < bodyEnd) {
      return
    }

    const request = JSON.parse(pending.subarray(bodyAt, bodyEnd).toString('utf8'))
    pending = pending.subarray(bodyEnd)

    if (request.command === 'initialize') {
      send({
        seq: nextSeq++,
        type: 'response',
        request_seq: request.seq,
        success: true,
        command: 'initialize',
        body: { supportsConfigurationDoneRequest: true }
      })
      continue
    }

    if (request.command === 'launch') {
      send({ seq: nextSeq++, type: 'event', event: 'initialized' })
      continue
    }

    send({
      seq: nextSeq++,
      type: 'response',
      request_seq: request.seq,
      success: true,
      command: request.command
    })
  }
})
`
