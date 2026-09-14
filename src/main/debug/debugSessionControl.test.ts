import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DebugControlOutcome, DebugSessionState } from '@shared/debug'
import type { DebugAdapterCommand } from './adapterCatalog'
import {
  startDebugAdapterProcess,
  type DebugAdapterProcess,
  type DebugAdapterProcessOptions
} from './adapterProcess'
import type { DapConnection, DapRequestOutcome } from './dapConnection'
import {
  createDebugSessionManager,
  type DebugSessionManager,
  type DebugSessionManagerOptions
} from './debugSessionManager'

/**
 * 実行制御と Stop（Session 6-4）。
 *
 * 状態機械そのもの（6-2）は debugSessionManager.test.ts、breakpoint の差し込み（6-3）は
 * debugSessionBreakpoints.test.ts が見ている。ここが見るのは6-4で足したものだけで、
 * 最後の1つだけが本物の子プロセス（stdio の mock adapter）を使う。
 */

const OK: DapRequestOutcome = { status: 'success', body: undefined }

/** 実行制御は await を何段か重ねるので、macrotask 1つぶん回して落ち着かせる。 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface PendingRequest {
  readonly command: string
  readonly args: unknown
  settled: boolean
  readonly resolve: (outcome: DapRequestOutcome) => void
}

interface AdapterHarness {
  readonly process: DebugAdapterProcess
  readonly options: DebugAdapterProcessOptions
  readonly requests: PendingRequest[]
  readonly commands: () => string[]
  readonly argsOf: (command: string) => unknown
  readonly respond: (command: string, outcome?: DapRequestOutcome) => Promise<void>
  readonly event: (event: string, body?: unknown) => void
  readonly error: (message: string) => void
  readonly close: () => void
}

interface HarnessOptions {
  /** dispose しても待っている要求を閉じない（dispose と応答の競合を作る）。 */
  readonly keepPendingOnDispose?: boolean
}

function createAdapterHarness(
  options: DebugAdapterProcessOptions,
  harnessOptions: HarnessOptions
): AdapterHarness {
  const requests: PendingRequest[] = []
  let disposed = false

  const connection: DapConnection = {
    receive: vi.fn(),
    request: vi.fn((command: string, args?: unknown) => {
      if (disposed) {
        return Promise.resolve({ status: 'closed', reason: 'disposed' } satisfies DapRequestOutcome)
      }

      return new Promise<DapRequestOutcome>((resolve) => {
        const pending: PendingRequest = {
          command,
          args,
          settled: false,
          resolve: (outcome) => {
            pending.settled = true
            resolve(outcome)
          }
        }
        requests.push(pending)
      })
    }),
    dispose: vi.fn((reason: string) => {
      if (disposed) {
        return
      }

      disposed = true

      if (harnessOptions.keepPendingOnDispose === true) {
        return
      }

      for (const request of requests.filter((pending) => !pending.settled)) {
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

      connection.dispose(reason)
      options.onClose?.('dispose', null, null)
    })
  }

  return {
    process,
    options,
    requests,
    commands: () => requests.map((request) => request.command),
    argsOf: (command) => requests.find((request) => request.command === command)?.args,
    respond: async (command, outcome = OK) => {
      const pending = requests.find((request) => request.command === command && !request.settled)

      if (pending === undefined) {
        throw new Error(`no pending request: ${command}`)
      }

      pending.resolve(outcome)
      await settle()
    },
    event: (event, body) => {
      options.onEvent(event, body)
    },
    error: (message) => {
      options.onError?.(new Error(message))
    },
    close: () => {
      options.onClose?.('close', 0, null)
    }
  }
}

interface Harness {
  readonly manager: DebugSessionManager
  readonly adapters: AdapterHarness[]
  readonly states: DebugSessionState[]
  readonly logs: string[]
}

function createHarness(
  managerOptions: Partial<DebugSessionManagerOptions> = {},
  harnessOptions: HarnessOptions = {}
): Harness {
  const adapters: AdapterHarness[] = []
  const states: DebugSessionState[] = []
  const logs: string[] = []

  const manager = createDebugSessionManager({
    startTimeoutMs: 1_000,
    terminateGraceMs: 1_000,
    disconnectGraceMs: 1_000,
    controlTimeoutMs: 1_000,
    onLog: (level, message) => {
      logs.push(`${level}: ${message}`)
    },
    ...managerOptions,
    startAdapterProcess: (options) => {
      const adapter = createAdapterHarness(options, harnessOptions)
      adapters.push(adapter)

      return { status: 'started', process: adapter.process }
    }
  })

  manager.onStateChange((state) => {
    states.push(state)
  })

  return { manager, adapters, states, logs }
}

function createCommand(): DebugAdapterCommand {
  return { name: 'Mock Debug Adapter', file: 'C:\\Tools\\mock.exe', args: [], cwd: 'D:\\proj' }
}

async function startRunning(
  harness: Harness,
  capabilities: Record<string, boolean> = {}
): Promise<AdapterHarness> {
  expect(
    harness.manager.start({
      adapterId: 'mock',
      adapterCommand: createCommand(),
      launchArguments: { program: 'main.js' }
    }).status
  ).toBe('started')

  const adapter = harness.adapters[harness.adapters.length - 1]

  await adapter.respond('initialize', {
    status: 'success',
    body: { supportsConfigurationDoneRequest: true, ...capabilities }
  })
  adapter.event('initialized')
  await settle()
  await adapter.respond('configurationDone')

  expect(harness.manager.getState()).toBe('running')

  return adapter
}

async function startStopped(
  harness: Harness,
  capabilities: Record<string, boolean> = {}
): Promise<AdapterHarness> {
  const adapter = await startRunning(harness, capabilities)

  adapter.event('stopped', { reason: 'breakpoint', threadId: 1 })
  expect(harness.manager.getState()).toBe('stopped')

  return adapter
}

/** 起動の往復（initialize / launch / configurationDone）を除いた、6-4 で送ったもの。 */
function controlCommands(adapter: AdapterHarness): string[] {
  return adapter
    .commands()
    .filter((command) => !['initialize', 'launch', 'configurationDone'].includes(command))
}

describe('execution controls', () => {
  it('continues a stopped session with the stopped thread and moves to running', async () => {
    const harness = createHarness()
    const adapter = await startStopped(harness)

    const outcome = harness.manager.control('continue')
    await settle()

    expect(controlCommands(adapter)).toEqual(['continue'])
    expect(adapter.argsOf('continue')).toEqual({ threadId: 1 })
    expect(harness.manager.getState()).toBe('stopped')

    await adapter.respond('continue', { status: 'success', body: { allThreadsContinued: true } })

    await expect(outcome).resolves.toEqual({ status: 'accepted', state: 'running' })
    expect(harness.manager.getState()).toBe('running')
  })

  it.each([
    ['stepOver', 'next'],
    ['stepInto', 'stepIn'],
    ['stepOut', 'stepOut']
  ] as const)(
    '%s is sent as DAP "%s", runs, and stops again on the step event',
    async (control, dap) => {
      const harness = createHarness()
      const adapter = await startStopped(harness)

      const outcome = harness.manager.control(control)
      await settle()

      expect(controlCommands(adapter)).toEqual([dap])
      expect(adapter.argsOf(dap)).toEqual({ threadId: 1 })

      await adapter.respond(dap)
      await expect(outcome).resolves.toEqual({ status: 'accepted', state: 'running' })

      adapter.event('stopped', { reason: 'step', threadId: 1 })
      expect(harness.manager.getState()).toBe('stopped')
    }
  )

  it('pauses a running session on the first thread and waits for the stopped event', async () => {
    const harness = createHarness()
    const adapter = await startRunning(harness)

    const outcome = harness.manager.control('pause')
    await settle()

    expect(controlCommands(adapter)).toEqual(['threads'])
    await adapter.respond('threads', {
      status: 'success',
      body: { threads: [{ id: 5, name: 'main' }, { id: 6 }] }
    })

    expect(controlCommands(adapter)).toEqual(['threads', 'pause'])
    expect(adapter.argsOf('pause')).toEqual({ threadId: 5 })

    await adapter.respond('pause')
    await expect(outcome).resolves.toEqual({ status: 'accepted', state: 'running' })
    expect(harness.manager.getState()).toBe('running')

    adapter.event('stopped', { reason: 'pause', threadId: 5 })
    expect(harness.manager.getState()).toBe('stopped')
  })

  it('pauses a running session with the thread id learned from a thread event', async () => {
    const harness = createHarness()
    const adapter = await startRunning(harness)

    adapter.event('thread', { reason: 'started', threadId: 7 })

    const outcome = harness.manager.control('pause')
    await settle()

    expect(controlCommands(adapter)).toEqual(['pause'])
    expect(adapter.argsOf('pause')).toEqual({ threadId: 7 })

    await adapter.respond('pause')
    await expect(outcome).resolves.toEqual({ status: 'accepted', state: 'running' })
  })

  it('asks the adapter for a thread when the stopped event had none', async () => {
    const harness = createHarness()
    const adapter = await startRunning(harness)

    adapter.event('stopped', { reason: 'pause', allThreadsStopped: true })
    const outcome = harness.manager.control('stepOver')
    await settle()

    await adapter.respond('threads', { status: 'success', body: { threads: [{ id: 3 }] } })
    expect(adapter.argsOf('next')).toEqual({ threadId: 3 })

    await adapter.respond('next')
    await expect(outcome).resolves.toMatchObject({ status: 'accepted' })
  })

  it('fails with no-thread without sending the control when there is no thread', async () => {
    const harness = createHarness()
    const adapter = await startRunning(harness)

    const outcome = harness.manager.control('pause')
    await settle()
    await adapter.respond('threads', { status: 'success', body: { threads: [] } })

    await expect(outcome).resolves.toEqual({
      status: 'failed',
      reason: 'no-thread',
      state: 'running'
    })
    expect(controlCommands(adapter)).toEqual(['threads'])
  })
})

describe('allowed and rejected states', () => {
  it('rejects every control and stop in idle as no-session', async () => {
    const { manager } = createHarness()

    for (const control of ['continue', 'pause', 'stepOver', 'stepInto', 'stepOut'] as const) {
      await expect(manager.control(control)).resolves.toEqual({
        status: 'rejected',
        reason: 'no-session',
        state: 'idle'
      })
    }

    await expect(manager.requestStop()).resolves.toEqual({
      status: 'rejected',
      reason: 'no-session',
      state: 'idle'
    })
  })

  it('rejects every execution control while starting, without sending anything', async () => {
    const harness = createHarness()

    harness.manager.start({ adapterId: 'mock', adapterCommand: createCommand() })

    for (const control of ['continue', 'pause', 'stepOver', 'stepInto', 'stepOut'] as const) {
      await expect(harness.manager.control(control)).resolves.toEqual({
        status: 'rejected',
        reason: 'invalid-state',
        state: 'starting'
      })
    }

    expect(harness.adapters[0].commands()).toEqual(['initialize'])
  })

  it('rejects Continue / Step while running and Pause while stopped', async () => {
    const harness = createHarness()
    const adapter = await startRunning(harness)

    for (const control of ['continue', 'stepOver', 'stepInto', 'stepOut'] as const) {
      await expect(harness.manager.control(control)).resolves.toMatchObject({
        status: 'rejected',
        reason: 'invalid-state'
      })
    }

    adapter.event('stopped', { reason: 'breakpoint', threadId: 1 })

    await expect(harness.manager.control('pause')).resolves.toMatchObject({
      status: 'rejected',
      reason: 'invalid-state',
      state: 'stopped'
    })
    expect(controlCommands(adapter)).toEqual([])
  })

  it('rejects every execution control while terminating', async () => {
    const harness = createHarness()
    const adapter = await startStopped(harness)

    void harness.manager.requestStop()
    expect(harness.manager.getState()).toBe('terminating')

    for (const control of ['continue', 'pause', 'stepOver', 'stepInto', 'stepOut'] as const) {
      await expect(harness.manager.control(control)).resolves.toMatchObject({
        status: 'rejected',
        reason: 'invalid-state',
        state: 'terminating'
      })
    }

    expect(controlCommands(adapter)).toEqual(['disconnect'])
  })

  it('does not send a name outside the closed set', async () => {
    const harness = createHarness()
    const adapter = await startStopped(harness)

    await expect(harness.manager.control('evaluate' as never)).resolves.toMatchObject({
      status: 'rejected'
    })
    await expect(harness.manager.control('next' as never)).resolves.toMatchObject({
      status: 'rejected'
    })
    expect(controlCommands(adapter)).toEqual([])
  })
})

describe('pending controls', () => {
  it('answers busy while a control is waiting, then accepts again', async () => {
    const harness = createHarness()
    const adapter = await startStopped(harness)

    const first = harness.manager.control('stepOver')
    await settle()

    await expect(harness.manager.control('stepOver')).resolves.toEqual({
      status: 'rejected',
      reason: 'busy',
      state: 'stopped'
    })
    await expect(harness.manager.control('continue')).resolves.toMatchObject({ reason: 'busy' })

    adapter.event('stopped', { reason: 'step', threadId: 1 })
    await adapter.respond('next')
    await first

    const second = harness.manager.control('stepOver')
    await settle()
    expect(controlCommands(adapter)).toEqual(['next', 'next'])

    await adapter.respond('next')
    await expect(second).resolves.toMatchObject({ status: 'accepted' })
  })

  it('stays stopped when the next stopped event overtakes the step response', async () => {
    const harness = createHarness()
    const adapter = await startStopped(harness)

    const outcome = harness.manager.control('stepOver')
    await settle()

    adapter.event('stopped', { reason: 'step', threadId: 1 })
    await adapter.respond('next')

    await expect(outcome).resolves.toEqual({ status: 'accepted', state: 'stopped' })
    expect(harness.manager.getState()).toBe('stopped')
  })

  it('does not double-transition when continued arrives before the continue response', async () => {
    const harness = createHarness()
    const adapter = await startStopped(harness)

    const outcome = harness.manager.control('continue')
    await settle()

    adapter.event('continued', { threadId: 1 })
    await adapter.respond('continue')

    await expect(outcome).resolves.toEqual({ status: 'accepted', state: 'running' })
    expect(harness.states.filter((state) => state === 'running')).toHaveLength(2)
  })

  it('keeps the state and hides the adapter message when the adapter refuses', async () => {
    const harness = createHarness()
    const adapter = await startStopped(harness)

    const outcome = harness.manager.control('stepInto')
    await settle()
    await adapter.respond('stepIn', {
      status: 'failure',
      message: 'cannot step in D:\\secret\\path\\app.js',
      body: undefined
    })

    const result = await outcome

    expect(result).toEqual({ status: 'failed', reason: 'adapter-rejected', state: 'stopped' })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(harness.logs.some((line) => line.includes('D:\\secret'))).toBe(true)
  })

  it('times out, accepts the next control, and still applies a late response', async () => {
    const harness = createHarness({ controlTimeoutMs: 20 })
    const adapter = await startStopped(harness)

    const outcome = harness.manager.control('continue')
    await sleep(40)

    await expect(outcome).resolves.toEqual({
      status: 'failed',
      reason: 'timeout',
      state: 'stopped'
    })

    await adapter.respond('continue')
    expect(harness.manager.getState()).toBe('running')

    const pause = harness.manager.control('pause')
    await settle()
    expect(controlCommands(adapter)).toEqual(['continue', 'pause'])

    await adapter.respond('pause')
    await expect(pause).resolves.toMatchObject({ status: 'accepted' })
  })

  it('closes a pending control as session-ended when the session is stopped', async () => {
    const harness = createHarness()
    const adapter = await startStopped(harness)

    const outcome = harness.manager.control('stepOut')
    await settle()

    harness.manager.stop('workspace changed')

    await expect(outcome).resolves.toEqual({
      status: 'failed',
      reason: 'session-ended',
      state: 'idle'
    })
    expect(adapter.process.dispose).toHaveBeenCalledTimes(1)
  })
})

describe('stale generation', () => {
  it('does not let a late response from the previous session move the new one', async () => {
    const harness = createHarness({}, { keepPendingOnDispose: true })
    const oldAdapter = await startStopped(harness)

    const oldControl = harness.manager.control('continue')
    await settle()

    harness.manager.stop('replace session')
    const newAdapter = await startStopped(harness)
    expect(newAdapter).not.toBe(oldAdapter)

    await oldAdapter.respond('continue')
    oldAdapter.event('continued')
    oldAdapter.event('terminated')

    await expect(oldControl).resolves.toEqual({
      status: 'failed',
      reason: 'session-ended',
      state: 'stopped'
    })
    expect(harness.manager.getState()).toBe('stopped')
    expect(newAdapter.process.dispose).not.toHaveBeenCalled()
  })

  it('does not reuse the previous session thread in the new session', async () => {
    const harness = createHarness()
    await startStopped(harness)
    harness.manager.stop('replace session')

    const adapter = await startRunning(harness)
    adapter.event('stopped', { reason: 'breakpoint' })

    const outcome = harness.manager.control('continue')
    await settle()

    expect(controlCommands(adapter)).toEqual(['threads'])
    await adapter.respond('threads', { status: 'success', body: { threads: [{ id: 77 }] } })
    expect(adapter.argsOf('continue')).toEqual({ threadId: 77 })

    await adapter.respond('continue')
    await outcome
  })
})

describe('stop', () => {
  it('disconnects directly when the adapter does not support terminate', async () => {
    const harness = createHarness()
    const adapter = await startRunning(harness)

    const stop = harness.manager.requestStop()
    expect(harness.manager.getState()).toBe('terminating')
    expect(controlCommands(adapter)).toEqual(['disconnect'])
    expect(adapter.argsOf('disconnect')).toEqual({ restart: false })

    await adapter.respond('disconnect')

    await expect(stop).resolves.toEqual({ status: 'accepted', state: 'idle' })
    expect(adapter.process.dispose).toHaveBeenCalledTimes(1)
    // idle は6-2 から2度通知される（遷移と、セッションを手放したとき）ので畳んで見る。
    const transitions = harness.states.filter((state, index, all) => state !== all[index - 1])
    expect(transitions).toEqual(['starting', 'running', 'terminating', 'idle'])
  })

  it('terminates first, then disconnects after the terminated event', async () => {
    const harness = createHarness()
    const adapter = await startStopped(harness, { supportsTerminateRequest: true })

    const stop = harness.manager.requestStop()
    expect(controlCommands(adapter)).toEqual(['terminate'])
    expect(adapter.argsOf('terminate')).toBeUndefined()

    await adapter.respond('terminate')
    expect(harness.manager.getState()).toBe('terminating')
    expect(controlCommands(adapter)).toEqual(['terminate'])

    adapter.event('exited', { exitCode: 0 })
    adapter.event('terminated')
    expect(controlCommands(adapter)).toEqual(['terminate', 'disconnect'])

    await adapter.respond('disconnect')
    await expect(stop).resolves.toEqual({ status: 'accepted', state: 'idle' })
    expect(adapter.process.dispose).toHaveBeenCalledTimes(1)
  })

  it('escalates a repeated stop from terminate to disconnect and answers both', async () => {
    const harness = createHarness()
    const adapter = await startRunning(harness, { supportsTerminateRequest: true })

    const first = harness.manager.requestStop()
    const second = harness.manager.requestStop()
    expect(controlCommands(adapter)).toEqual(['terminate', 'disconnect'])

    const third = harness.manager.requestStop()
    expect(controlCommands(adapter)).toEqual(['terminate', 'disconnect'])

    await adapter.respond('disconnect')

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      { status: 'accepted', state: 'idle' },
      { status: 'accepted', state: 'idle' },
      { status: 'accepted', state: 'idle' }
    ])
    expect(adapter.process.dispose).toHaveBeenCalledTimes(1)
  })

  it('disconnects when the adapter refuses terminate', async () => {
    const harness = createHarness()
    const adapter = await startRunning(harness, { supportsTerminateRequest: true })

    const stop = harness.manager.requestStop()
    await adapter.respond('terminate', { status: 'failure', message: 'no', body: undefined })

    expect(controlCommands(adapter)).toEqual(['terminate', 'disconnect'])
    await adapter.respond('disconnect')
    await expect(stop).resolves.toMatchObject({ state: 'idle' })
  })

  it('disconnects when the debuggee vetoes terminate past the grace period', async () => {
    const harness = createHarness({ terminateGraceMs: 20 })
    const adapter = await startRunning(harness, { supportsTerminateRequest: true })

    const stop = harness.manager.requestStop()
    await adapter.respond('terminate')
    await sleep(40)

    expect(controlCommands(adapter)).toEqual(['terminate', 'disconnect'])
    await adapter.respond('disconnect')
    await expect(stop).resolves.toMatchObject({ state: 'idle' })
  })

  it('kills the adapter when disconnect is never answered', async () => {
    const harness = createHarness({ disconnectGraceMs: 20 })
    const adapter = await startRunning(harness)

    const stop = harness.manager.requestStop()
    await sleep(40)

    await expect(stop).resolves.toEqual({ status: 'accepted', state: 'idle' })
    expect(adapter.process.dispose).toHaveBeenCalledWith(
      'the debug adapter did not answer disconnect in time.'
    )
  })

  it('treats the adapter closing itself after disconnect as a normal end', async () => {
    const harness = createHarness()
    const adapter = await startRunning(harness)

    const stop = harness.manager.requestStop()
    adapter.close()

    await expect(stop).resolves.toMatchObject({ state: 'idle' })
    expect(harness.logs.filter((line) => line.startsWith('error:'))).toEqual([])
  })

  it('ends cleanly when the adapter fails while stopping', async () => {
    const harness = createHarness()
    const adapter = await startRunning(harness, { supportsTerminateRequest: true })

    const stop = harness.manager.requestStop()
    adapter.error('boom')

    await expect(stop).resolves.toMatchObject({ state: 'idle' })
    expect(adapter.process.dispose).toHaveBeenCalledTimes(1)
  })

  it('sends terminateDebuggee only to an adapter that honors it', async () => {
    const harness = createHarness()
    const adapter = await startRunning(harness, { supportTerminateDebuggee: true })

    const stop = harness.manager.requestStop()
    expect(adapter.argsOf('disconnect')).toEqual({ restart: false, terminateDebuggee: true })

    await adapter.respond('disconnect')
    await stop
  })

  it('stops a session that is still starting without configuring it', async () => {
    const harness = createHarness()
    harness.manager.start({ adapterId: 'mock', adapterCommand: createCommand() })
    const adapter = harness.adapters[0]

    const stop = harness.manager.requestStop()
    expect(harness.manager.getState()).toBe('terminating')

    await adapter.respond('initialize', {
      status: 'success',
      body: { supportsConfigurationDoneRequest: true, supportsTerminateRequest: true }
    })
    adapter.event('initialized')
    await settle()

    expect(adapter.commands()).toEqual(['initialize', 'disconnect'])

    await adapter.respond('disconnect')
    await expect(stop).resolves.toMatchObject({ state: 'idle' })
  })

  it('does not report a stop in progress as a launch failure', async () => {
    const harness = createHarness()
    const adapter = await startRunning(harness)

    const stop = harness.manager.requestStop()
    await adapter.respond('launch', { status: 'failure', message: 'killed', body: undefined })
    await adapter.respond('disconnect')

    await expect(stop).resolves.toMatchObject({ state: 'idle' })
    expect(harness.logs.filter((line) => line.startsWith('error:'))).toEqual([])
  })
})

describe('cleanup races', () => {
  it('lets the workspace switch / quit path finish a graceful stop immediately', async () => {
    const harness = createHarness({ terminateGraceMs: 20, disconnectGraceMs: 20 })
    const adapter = await startRunning(harness, { supportsTerminateRequest: true })

    const stop = harness.manager.requestStop()
    harness.manager.dispose('the application is quitting.')

    expect(harness.manager.getState()).toBe('idle')
    await expect(stop).resolves.toEqual({ status: 'accepted', state: 'idle' })

    await sleep(60)

    expect(adapter.process.dispose).toHaveBeenCalledTimes(1)
    expect(adapter.process.dispose).toHaveBeenCalledWith('the application is quitting.')
    expect(adapter.commands().filter((command) => command === 'disconnect')).toHaveLength(1)
  })

  it('does not send a second disconnect when a forced stop follows a graceful one', async () => {
    const harness = createHarness()
    const adapter = await startRunning(harness)

    const stop = harness.manager.requestStop()
    harness.manager.stop('the workspace folder changed.')

    await stop
    expect(adapter.commands().filter((command) => command === 'disconnect')).toHaveLength(1)
  })

  it('does not fire stop timers into a session started after the stopped one', async () => {
    const harness = createHarness({ terminateGraceMs: 20, disconnectGraceMs: 20 })
    const oldAdapter = await startRunning(harness, { supportsTerminateRequest: true })

    const stop = harness.manager.requestStop()
    oldAdapter.close()
    await stop

    const newAdapter = await startRunning(harness)
    await sleep(60)

    expect(harness.manager.getState()).toBe('running')
    expect(controlCommands(newAdapter)).toEqual([])
    expect(newAdapter.process.dispose).not.toHaveBeenCalled()
  })

  it('keeps the 6-2 cleanup for an adapter that ends by itself', async () => {
    const harness = createHarness()
    const adapter = await startRunning(harness)

    adapter.event('terminated')

    expect(harness.manager.getState()).toBe('idle')
    expect(controlCommands(adapter)).toEqual([])
    expect(adapter.process.dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps the breakpoint channel closed while terminating', async () => {
    const harness = createHarness()
    const adapter = await startStopped(harness)

    expect(harness.manager.getBreakpointChannel()).not.toBeNull()

    const stop = harness.manager.requestStop()
    expect(harness.manager.getBreakpointChannel()).toBeNull()

    await adapter.respond('disconnect')
    await stop
    expect(harness.manager.getBreakpointChannel()).toBeNull()
  })
})

describe('real stdio mock adapter', () => {
  let workDir: string | null = null

  afterEach(() => {
    if (workDir !== null) {
      rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
      workDir = null
    }
  })

  it('moves between running and stopped and ends with terminate → disconnect', async () => {
    workDir = mkdtempSync(join(tmpdir(), 'fluvix-dap-control-'))
    const requestLog = join(workDir, 'requests.log')
    const pids: number[] = []

    const manager = createDebugSessionManager({
      startTimeoutMs: 5_000,
      startAdapterProcess: (options) => {
        const outcome = startDebugAdapterProcess(options)

        if (outcome.status === 'started' && outcome.process.pid !== undefined) {
          pids.push(outcome.process.pid)
        }

        return outcome
      }
    })

    const running = waitForState(manager, 'running')

    manager.start({
      adapterId: 'mock',
      adapterCommand: {
        name: 'Node mock DAP adapter',
        file: process.execPath,
        args: ['-e', MOCK_CONTROL_ADAPTER_SCRIPT, requestLog],
        // 記録先のフォルダを cwd にしない（Windows では消すときに掴まれたままになる）。
        cwd: tmpdir(),
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      },
      launchArguments: { program: 'main.js' }
    })

    await running

    const expectState = async (
      outcome: Promise<DebugControlOutcome>,
      next: DebugSessionState
    ): Promise<void> => {
      const reached = waitForState(manager, next)
      expect((await outcome).status).toBe('accepted')
      await reached
    }

    await expectState(manager.control('pause'), 'stopped')
    await expectState(manager.control('stepOver'), 'stopped')
    await expectState(manager.control('stepInto'), 'stopped')
    await expectState(manager.control('stepOut'), 'stopped')
    await expectState(manager.control('continue'), 'running')

    expect((await manager.control('stepOver')).status).toBe('rejected')

    await expectState(manager.control('pause'), 'stopped')
    await expect(manager.requestStop()).resolves.toEqual({ status: 'accepted', state: 'idle' })

    const commands = readFileSync(requestLog, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { command: string; arguments?: unknown })

    expect(commands.map((request) => request.command)).toEqual([
      'initialize',
      'launch',
      'configurationDone',
      'threads',
      'pause',
      'next',
      'stepIn',
      'stepOut',
      'continue',
      'pause',
      'terminate',
      'disconnect'
    ])
    expect(commands.find((request) => request.command === 'next')?.arguments).toEqual({
      threadId: 1
    })

    expect(pids).toHaveLength(1)
    await waitForExit(pids[0])
  })
})

function waitForState(manager: DebugSessionManager, expected: DebugSessionState): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`timed out waiting for debug session state: ${expected}`))
    }, 5_000)
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

async function waitForExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }

    await sleep(50)
  }

  throw new Error(`the adapter process ${pid} is still alive.`)
}

/**
 * 実行制御を話す最小の DAP adapter（stdio / Content-Length）。
 *
 * - 受けた request を1行ずつ argv[1] のファイルへ書く（何が送られたかを外から数える）
 * - pause / next / stepIn / stepOut は**応答の後に** `stopped` を送る（DAP の順序どおり）
 * - terminate は応答の後に `exited` / `terminated` を送る
 * - disconnect は応答してから自分で終わる
 */
const MOCK_CONTROL_ADAPTER_SCRIPT = String.raw`
const fs = require('fs')
const logPath = process.argv[1]
let pending = Buffer.alloc(0)
let nextSeq = 1
const separator = '\r\n\r\n'

function send(message) {
  const body = Buffer.from(JSON.stringify({ seq: nextSeq++, ...message }), 'utf8')
  process.stdout.write('Content-Length: ' + body.byteLength + separator)
  process.stdout.write(body)
}

function respond(request, body) {
  send({ type: 'response', request_seq: request.seq, success: true, command: request.command, body })
}

function handle(request) {
  fs.appendFileSync(logPath, JSON.stringify({ command: request.command, arguments: request.arguments }) + '\n')

  switch (request.command) {
    case 'initialize':
      respond(request, { supportsConfigurationDoneRequest: true, supportsTerminateRequest: true })
      return
    case 'launch':
      send({ type: 'event', event: 'initialized' })
      return
    case 'threads':
      respond(request, { threads: [{ id: 1, name: 'main' }] })
      return
    case 'pause':
      respond(request)
      send({ type: 'event', event: 'stopped', body: { reason: 'pause', threadId: 1 } })
      return
    case 'next':
    case 'stepIn':
    case 'stepOut':
      respond(request)
      setTimeout(() => send({ type: 'event', event: 'stopped', body: { reason: 'step', threadId: 1 } }), 10)
      return
    case 'continue':
      respond(request, { allThreadsContinued: true })
      return
    case 'terminate':
      respond(request)
      send({ type: 'event', event: 'exited', body: { exitCode: 0 } })
      send({ type: 'event', event: 'terminated' })
      return
    case 'disconnect':
      respond(request)
      setTimeout(() => process.exit(0), 10)
      return
    default:
      respond(request)
  }
}

process.stdin.on('data', (chunk) => {
  pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])

  for (;;) {
    const separatorAt = pending.indexOf(separator)
    if (separatorAt < 0) return

    const header = pending.subarray(0, separatorAt).toString('ascii')
    const match = /content-length:\s*(\d+)/i.exec(header)
    if (match === null) process.exit(2)

    const bodyAt = separatorAt + separator.length
    const bodyEnd = bodyAt + Number(match[1])
    if (pending.length < bodyEnd) return

    const request = JSON.parse(pending.subarray(bodyAt, bodyEnd).toString('utf8'))
    pending = pending.subarray(bodyEnd)
    handle(request)
  }
})
`
