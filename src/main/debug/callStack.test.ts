import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceFolder } from '@shared/workspace'
import type { DapRequestOutcome } from './dapConnection'
import { createDebugCallStackStore, type DebugCallStackStoreDependencies } from './callStack'
import type {
  DebugSessionCallStackChannel,
  DebugSessionState,
  DebugSessionStoppedEvent,
  DebugSessionStoppedListener,
  DebugSessionThreadListener
} from './debugSessionManager'

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] }
}))

const WORKSPACE: WorkspaceFolder = {
  id: 'workspace-1',
  rootPath: 'D:\\proj',
  displayName: 'proj',
  openedAt: 1,
  exists: true
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })

  return { promise, resolve }
}

function success(body: unknown): DapRequestOutcome {
  return { status: 'success', body }
}

function createHarness() {
  let workspace: WorkspaceFolder | null = WORKSPACE
  let state: DebugSessionState = 'idle'
  let generation = 1
  let stopGeneration = 0
  let channel: DebugSessionCallStackChannel | null = null
  const workspaceListeners: ((next: WorkspaceFolder | null) => void)[] = []
  const stateListeners: ((state: DebugSessionState) => void)[] = []
  const stoppedListeners: DebugSessionStoppedListener[] = []
  const threadListeners: DebugSessionThreadListener[] = []
  const emitted: { readonly workspaceId: string; readonly snapshot: unknown }[] = []
  const logs: string[] = []

  const deps: DebugCallStackStoreDependencies = {
    getWorkspace: () => workspace,
    getDebugState: () => state,
    getDebugGeneration: () => generation,
    getDebugStopGeneration: () => stopGeneration,
    getChannel: () => channel,
    onDebugStateChange: (listener) => {
      stateListeners.push(listener)
      return () => {}
    },
    onDebugStopped: (listener) => {
      stoppedListeners.push(listener)
      return () => {}
    },
    onDebugThread: (listener) => {
      threadListeners.push(listener)
      return () => {}
    },
    emit: (workspaceId, snapshot) => {
      emitted.push({ workspaceId, snapshot })
    },
    log: (level, message) => {
      logs.push(`${level}: ${message}`)
    }
  }

  const store = createDebugCallStackStore(deps)
  store.start((listener) => {
    workspaceListeners.push(listener)
    return () => {}
  })

  function setWorkspace(next: WorkspaceFolder | null): void {
    workspace = next
    for (const listener of workspaceListeners) {
      listener(next)
    }
  }

  function setState(next: DebugSessionState): void {
    state = next
    for (const listener of stateListeners) {
      listener(next)
    }
  }

  function fireStopped(nextChannel: DebugSessionCallStackChannel): void {
    channel = nextChannel
    generation = nextChannel.generation
    stopGeneration = nextChannel.stopGeneration
    state = 'stopped'

    const event: DebugSessionStoppedEvent = {
      sessionId: nextChannel.sessionId,
      generation,
      stopGeneration,
      stoppedThreadId: nextChannel.stoppedThreadId,
      allThreadsStopped: true
    }

    for (const listener of stoppedListeners) {
      listener(event)
    }
  }

  function fireThread(): void {
    for (const listener of threadListeners) {
      listener({
        sessionId: channel?.sessionId ?? 'debug-session-1',
        generation,
        stopGeneration,
        threadId: 1,
        reason: 'started'
      })
    }
  }

  return {
    store,
    emitted,
    logs,
    setWorkspace,
    setState,
    fireStopped,
    fireThread,
    replaceSession: (nextGeneration: number) => {
      generation = nextGeneration
    },
    replaceStop: (nextStopGeneration: number) => {
      stopGeneration = nextStopGeneration
    }
  }
}

function channel(
  overrides: Partial<DebugSessionCallStackChannel> = {}
): DebugSessionCallStackChannel {
  return {
    sessionId: 'debug-session-1',
    generation: 1,
    stopGeneration: 1,
    stoppedThreadId: 1,
    requestThreads: vi.fn(async () => success({ threads: [{ id: 1, name: 'main' }] })),
    requestStackTrace: vi.fn(async () =>
      success({
        stackFrames: [
          {
            id: 11,
            name: 'main',
            source: { path: 'D:\\proj\\src\\app.ts' },
            line: 7,
            column: 3
          }
        ]
      })
    ),
    ...overrides
  }
}

describe('debug call stack store', () => {
  it('loads threads and the stopped thread stackTrace after a stopped event', async () => {
    const harness = createHarness()
    const activeChannel = channel()

    harness.fireStopped(activeChannel)
    await settle()

    expect(activeChannel.requestThreads).toHaveBeenCalledTimes(1)
    expect(activeChannel.requestStackTrace).toHaveBeenCalledWith({
      threadId: 1,
      startFrame: 0,
      levels: 50
    })
    expect(harness.store.list()).toEqual({
      status: 'stopped',
      activeThreadId: 1,
      threads: [
        {
          id: 1,
          name: 'main',
          stopped: true,
          frames: [
            {
              id: 11,
              name: 'main',
              source: { kind: 'workspace', relativePath: 'src/app.ts', name: 'app.ts' },
              line: 7,
              column: 3
            }
          ]
        }
      ]
    })
    expect(harness.store.getFrameHandle(11)).toEqual({
      workspaceId: 'workspace-1',
      sessionGeneration: 1,
      stopGeneration: 1,
      threadId: 1,
      frameId: 11
    })
  })

  it('keeps multiple threads and loads frames only for the stopped thread', async () => {
    const harness = createHarness()
    const activeChannel = channel({
      stoppedThreadId: 2,
      requestThreads: vi.fn(async () =>
        success({
          threads: [
            { id: 1, name: 'worker' },
            { id: 2, name: 'main' }
          ]
        })
      )
    })

    harness.fireStopped(activeChannel)
    await settle()

    expect(activeChannel.requestStackTrace).toHaveBeenCalledWith({
      threadId: 2,
      startFrame: 0,
      levels: 50
    })
    expect(harness.store.list().threads.map((thread) => [thread.id, thread.stopped])).toEqual([
      [1, false],
      [2, true]
    ])
  })

  it('falls back to the first thread when stopped did not name one', async () => {
    const harness = createHarness()
    const activeChannel = channel({
      stoppedThreadId: null,
      requestThreads: vi.fn(async () => success({ threads: [{ id: 7, name: 'first' }] }))
    })

    harness.fireStopped(activeChannel)
    await settle()

    expect(activeChannel.requestStackTrace).toHaveBeenCalledWith({
      threadId: 7,
      startFrame: 0,
      levels: 50
    })
  })

  it('handles malformed threads and stackTrace responses without leaking adapter details', async () => {
    const threadsHarness = createHarness()
    threadsHarness.fireStopped(
      channel({
        requestThreads: vi.fn(async () => success({ threads: 'nope' }))
      })
    )
    await settle()

    expect(threadsHarness.store.list()).toEqual({
      status: 'stopped',
      activeThreadId: null,
      threads: []
    })
    expect(threadsHarness.logs).toContain('warn: ignored a malformed threads response.')

    const stackHarness = createHarness()
    stackHarness.fireStopped(
      channel({
        requestStackTrace: vi.fn(async () => success({ stackFrames: 'nope' }))
      })
    )
    await settle()

    expect(stackHarness.store.list().threads[0]?.frames).toEqual([])
    expect(stackHarness.logs).toContain('warn: ignored a malformed stackTrace response.')
  })

  it('drops stale session generation and stop generation responses', async () => {
    const sessionHarness = createHarness()
    const waitingThreads = deferred<DapRequestOutcome>()
    sessionHarness.fireStopped(
      channel({
        requestThreads: vi.fn(() => waitingThreads.promise)
      })
    )
    sessionHarness.replaceSession(2)
    waitingThreads.resolve({ status: 'success', body: { threads: [{ id: 1, name: 'old' }] } })
    await settle()

    expect(sessionHarness.store.list()).toEqual({
      status: 'loading',
      activeThreadId: 1,
      threads: []
    })
    expect(sessionHarness.store.getFrameHandle(11)).toBeNull()

    const stopHarness = createHarness()
    const waitingStack = deferred<DapRequestOutcome>()
    stopHarness.fireStopped(
      channel({
        requestStackTrace: vi.fn(() => waitingStack.promise)
      })
    )
    await settle()
    stopHarness.replaceStop(2)
    waitingStack.resolve({
      status: 'success',
      body: {
        stackFrames: [{ id: 11, name: 'old', source: { path: 'D:\\proj\\src\\old.ts' }, line: 1 }]
      }
    })
    await settle()

    expect(stopHarness.store.list()).toEqual({ status: 'loading', activeThreadId: 1, threads: [] })
    expect(stopHarness.store.getFrameHandle(11)).toBeNull()
  })

  it('clears on continued/execution-control state changes, adapter end, and workspace switch', async () => {
    const harness = createHarness()
    harness.fireStopped(channel())
    await settle()
    expect(harness.store.list().status).toBe('stopped')

    for (const state of ['running', 'terminating', 'idle'] as const) {
      harness.setState(state)
      expect(harness.store.list()).toEqual({ status: 'idle', activeThreadId: null, threads: [] })
    }

    harness.fireStopped(channel({ stopGeneration: 2 }))
    await settle()
    expect(harness.store.list().status).toBe('stopped')

    harness.setWorkspace(null)
    expect(harness.store.list()).toEqual({ status: 'idle', activeThreadId: null, threads: [] })
    expect(harness.store.getFrameHandle(11)).toBeNull()
  })

  it('refreshes while stopped when a thread event arrives', async () => {
    const harness = createHarness()
    const activeChannel = channel()

    harness.fireStopped(activeChannel)
    await settle()
    harness.fireThread()
    await settle()

    expect(activeChannel.requestThreads).toHaveBeenCalledTimes(2)
  })
})
