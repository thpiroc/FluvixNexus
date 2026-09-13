import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { DebugSessionState } from '@shared/debug'
import type { WorkspaceFolder } from '@shared/workspace'
import { describe, expect, it, vi } from 'vitest'
import type { DebugAdapterCommand } from './adapterCatalog'
import {
  startDebugAdapterProcess,
  type DebugAdapterProcess,
  type DebugAdapterProcessOptions
} from './adapterProcess'
import type { DapConnection, DapRequestOutcome } from './dapConnection'
import { createDebugCallStackStore } from './callStack'
import { createDebugSessionManager } from './debugSessionManager'

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
  return new Promise((resolve) => setTimeout(resolve, 0))
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

      return new Promise<DapRequestOutcome>((resolve) => {
        requests.push({ command, args, resolve })
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
  const stopped: unknown[] = []
  const threads: unknown[] = []
  const manager = createDebugSessionManager({
    startTimeoutMs: 1_000,
    startAdapterProcess: (options) => {
      const adapter = createAdapterHarness(options)
      adapters.push(adapter)

      return { status: 'started', process: adapter.process }
    }
  })

  manager.onStopped((event) => stopped.push(event))
  manager.onThread((event) => threads.push(event))

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

  return { manager, adapter, stopped, threads }
}

describe('debug session call stack channel', () => {
  it('opens only while stopped and sends threads / stackTrace through the feature channel', async () => {
    const { manager, adapter, stopped } = await startRunning()

    expect(manager.getCallStackChannel()).toBeNull()

    adapter.event('stopped', { reason: 'breakpoint', threadId: 3, allThreadsStopped: true })
    const channel = manager.getCallStackChannel()

    expect(channel).toMatchObject({
      sessionId: 'debug-session-1',
      generation: 1,
      stopGeneration: 1,
      stoppedThreadId: 3
    })
    expect(stopped).toEqual([
      {
        sessionId: 'debug-session-1',
        generation: 1,
        stopGeneration: 1,
        stoppedThreadId: 3,
        allThreadsStopped: true,
        stop: { reason: 'breakpoint', description: null, text: null }
      }
    ])

    const threads = channel?.requestThreads()
    const stack = channel?.requestStackTrace({ threadId: 3, startFrame: 0, levels: 50 })
    await settle()

    expect(adapter.requests.map((request) => request.command)).toContain('threads')
    expect(adapter.requests.find((request) => request.command === 'stackTrace')?.args).toEqual({
      threadId: 3,
      startFrame: 0,
      levels: 50
    })

    await adapter.resolve('threads', { status: 'success', body: { threads: [] } })
    await adapter.resolve('stackTrace', { status: 'success', body: { stackFrames: [] } })
    await expect(threads).resolves.toMatchObject({ status: 'success' })
    await expect(stack).resolves.toMatchObject({ status: 'success' })
  })

  it('closes old call stack channels after continued, a new stop, or cleanup', async () => {
    const { manager, adapter } = await startRunning()

    adapter.event('stopped', { reason: 'breakpoint', threadId: 1 })
    const first = manager.getCallStackChannel()
    expect(first).not.toBeNull()

    adapter.event('stopped', { reason: 'step', threadId: 1 })
    await expect(first?.requestThreads()).resolves.toMatchObject({ status: 'closed' })

    const second = manager.getCallStackChannel()
    expect(second?.stopGeneration).toBe(2)

    adapter.event('continued', { threadId: 1 })
    expect(manager.getCallStackChannel()).toBeNull()
    await expect(
      second?.requestStackTrace({ threadId: 1, startFrame: 0, levels: 50 })
    ).resolves.toMatchObject({
      status: 'closed'
    })

    manager.stop('workspace changed')
    expect(manager.getCallStackChannel()).toBeNull()
  })

  it('reports thread events with the current stop generation', async () => {
    const { adapter, threads } = await startRunning()

    adapter.event('stopped', { reason: 'breakpoint', threadId: 1 })
    adapter.event('thread', { reason: 'started', threadId: 2 })

    expect(threads).toEqual([
      {
        sessionId: 'debug-session-1',
        generation: 1,
        stopGeneration: 1,
        threadId: 2,
        reason: 'started'
      }
    ])
  })
})

describe('real stdio mock adapter with call stack store', () => {
  it('loads call stack from stopped, then clears it on continue', async () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'fluvix-dap-stack-'))
    const sourcePath = resolve(rootPath, 'src/app.ts')

    try {
      const manager = createDebugSessionManager({
        startTimeoutMs: 5_000,
        startAdapterProcess: startDebugAdapterProcess
      })
      const workspace: WorkspaceFolder = {
        id: 'workspace-stack',
        rootPath,
        displayName: 'workspace-stack',
        openedAt: 1,
        exists: true
      }
      const emitted: unknown[] = []
      const store = createDebugCallStackStore({
        getWorkspace: () => workspace,
        getDebugState: manager.getState,
        getDebugGeneration: manager.getGeneration,
        getDebugStopGeneration: () => manager.getCallStackChannel()?.stopGeneration ?? 0,
        getChannel: manager.getCallStackChannel,
        onDebugStateChange: (listener) => manager.onStateChange((state) => listener(state)),
        onDebugStopped: manager.onStopped,
        onDebugThread: manager.onThread,
        emit: (_workspaceId, snapshot) => {
          emitted.push(snapshot)
        }
      })

      store.start(() => () => {})

      const running = waitForState(manager, 'running')

      expect(
        manager.start({
          adapterId: 'mock',
          adapterCommand: {
            name: 'Node mock DAP adapter',
            file: process.execPath,
            args: ['-e', MOCK_CALL_STACK_ADAPTER_SCRIPT, sourcePath],
            cwd: tmpdir(),
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
          },
          launchArguments: { program: 'main.js' }
        }).status
      ).toBe('started')

      await running
      const stopped = waitForState(manager, 'stopped')
      await expect(manager.control('pause')).resolves.toMatchObject({ status: 'accepted' })
      await stopped
      await waitFor(() => store.list().status === 'stopped')

      const snapshot = store.list()

      expect(snapshot.status).toBe('stopped')
      expect(snapshot.activeThreadId).toBe(1)
      expect(snapshot.threads).toHaveLength(2)
      expect(snapshot.threads[0]).toMatchObject({ id: 1, stopped: true })
      expect(snapshot.threads[0]?.frames[0]).toMatchObject({
        id: 101,
        source: { kind: 'workspace', relativePath: 'src/app.ts', name: 'app.ts' },
        line: 9
      })
      expect(snapshot.threads[0]?.frames[1]).toMatchObject({
        id: 102,
        source: { kind: 'unavailable', reason: 'outside-workspace' }
      })
      expect(JSON.stringify(snapshot)).not.toContain(rootPath)
      expect(JSON.stringify(snapshot)).not.toContain('D:\\secret')

      await expect(manager.control('continue')).resolves.toMatchObject({ status: 'accepted' })
      expect(store.list()).toEqual({
        status: 'idle',
        activeThreadId: null,
        threads: [],
        stop: null
      })
      expect(emitted.length).toBeGreaterThan(0)

      await expect(manager.requestStop()).resolves.toMatchObject({ state: 'idle' })
    } finally {
      rmSync(rootPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })
})

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 20))
  }

  throw new Error('timed out waiting for condition')
}

function waitForState(
  manager: ReturnType<typeof createDebugSessionManager>,
  expected: DebugSessionState
): Promise<void> {
  if (manager.getState() === expected) {
    return Promise.resolve()
  }

  return new Promise((resolveWait, reject) => {
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
      resolveWait()
    })
  })
}

const MOCK_CALL_STACK_ADAPTER_SCRIPT = String.raw`
const sourcePath = process.argv[1]
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
  switch (request.command) {
    case 'initialize':
      respond(request, { supportsConfigurationDoneRequest: true })
      return
    case 'launch':
      send({ type: 'event', event: 'initialized' })
      return
    case 'configurationDone':
      respond(request)
      return
    case 'threads':
      respond(request, { threads: [{ id: 1, name: 'main' }, { id: 2, name: 'worker' }] })
      return
    case 'pause':
      respond(request)
      send({ type: 'event', event: 'stopped', body: { reason: 'pause', threadId: 1, allThreadsStopped: true } })
      return
    case 'stackTrace':
      respond(request, {
        stackFrames: [
          { id: 101, name: 'run', source: { path: sourcePath, sourceReference: 99 }, line: 9, column: 5 },
          { id: 102, name: 'external', source: { path: 'D:\\secret\\lib.ts' }, line: 2, column: 1 }
        ]
      })
      return
    case 'continue':
      respond(request, { allThreadsContinued: true })
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
