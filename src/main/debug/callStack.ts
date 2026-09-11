import {
  EMPTY_DEBUG_CALL_STACK,
  type DebugCallStackFrame,
  type DebugCallStackSnapshot,
  type DebugCallStackThread
} from '@shared/debug'
import { IPC_EVENT_CHANNELS } from '@shared/ipc'
import type { WorkspaceFolder } from '@shared/workspace'
import { emitIpcEvent } from '../ipc/events'
import { createLogger } from '../logger'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import { createStackTraceArguments, parseStackTraceResponse } from './dapStackTrace'
import { parseThreadsResponse, type DapThread } from './dapThreads'
import {
  getDebugSessionCallStackChannel,
  getDebugSessionGeneration,
  getDebugSessionState,
  getDebugSessionStopGeneration,
  onDebugSessionStateChange,
  onDebugSessionStopped,
  onDebugSessionThread,
  type DebugSessionCallStackChannel,
  type DebugSessionState,
  type DebugSessionStoppedEvent,
  type DebugSessionStoppedListener,
  type DebugSessionThreadListener
} from './debugSessionManager'

export interface DebugCallStackFrameHandle {
  readonly workspaceId: string
  readonly sessionGeneration: number
  readonly stopGeneration: number
  readonly threadId: number
  readonly frameId: number
}

export interface DebugCallStackStore {
  readonly list: () => DebugCallStackSnapshot
  readonly getFrameHandle: (rawFrameId: unknown) => DebugCallStackFrameHandle | null
  readonly start: (
    onWorkspaceChange: (listener: (next: WorkspaceFolder | null) => void) => () => void
  ) => void
}

export interface DebugCallStackStoreDependencies {
  readonly getWorkspace: () => WorkspaceFolder | null
  readonly getDebugState: () => DebugSessionState
  readonly getDebugGeneration: () => number
  readonly getDebugStopGeneration: () => number
  readonly getChannel: () => DebugSessionCallStackChannel | null
  readonly onDebugStateChange: (listener: (state: DebugSessionState) => void) => () => void
  readonly onDebugStopped: (listener: DebugSessionStoppedListener) => () => void
  readonly onDebugThread: (listener: DebugSessionThreadListener) => () => void
  readonly emit: (workspaceId: string, snapshot: DebugCallStackSnapshot) => void
  readonly log?: (level: 'warn' | 'debug', message: string) => void
}

/**
 * Call Stack の正本（Session 6-5）。
 *
 * DAP の `threads` / `stackTrace` は Main が取り、Renderer には safe snapshot だけを
 * 渡す。frame id は次の停止で再利用されうるため、現在の session generation /
 * stop generation / Workspace に属するものだけを後続機能（Session 6-6）へ渡す。
 */
export function createDebugCallStackStore(
  dependencies: DebugCallStackStoreDependencies
): DebugCallStackStore {
  let workspace: WorkspaceFolder | null = null
  let snapshot: DebugCallStackSnapshot = EMPTY_DEBUG_CALL_STACK
  let frames = new Map<number, DebugCallStackFrameHandle>()

  function list(): DebugCallStackSnapshot {
    ensureWorkspace()

    return snapshot
  }

  function getFrameHandle(rawFrameId: unknown): DebugCallStackFrameHandle | null {
    ensureWorkspace()

    if (typeof rawFrameId !== 'number' || !Number.isSafeInteger(rawFrameId) || rawFrameId <= 0) {
      return null
    }

    const current = workspace
    const handle = frames.get(rawFrameId)

    if (
      current === null ||
      handle === undefined ||
      handle.workspaceId !== current.id ||
      dependencies.getDebugState() !== 'stopped' ||
      dependencies.getDebugGeneration() !== handle.sessionGeneration ||
      dependencies.getDebugStopGeneration() !== handle.stopGeneration
    ) {
      return null
    }

    return handle
  }

  function start(
    onWorkspaceChange: (listener: (next: WorkspaceFolder | null) => void) => () => void
  ): void {
    onWorkspaceChange((next) => {
      workspace = next
      clearSnapshot()
      notify()
    })

    dependencies.onDebugStateChange((state) => {
      if (state === 'stopped') {
        return
      }

      if (snapshot !== EMPTY_DEBUG_CALL_STACK || frames.size > 0) {
        clearSnapshot()
        notify()
      }
    })

    dependencies.onDebugStopped((event) => {
      void refreshForStop(event)
    })

    dependencies.onDebugThread(() => {
      if (dependencies.getDebugState() !== 'stopped') {
        return
      }

      const channel = dependencies.getChannel()

      if (channel !== null) {
        void refreshWithChannel(channel)
      }
    })
  }

  async function refreshForStop(event: DebugSessionStoppedEvent): Promise<void> {
    const channel = dependencies.getChannel()

    if (
      channel === null ||
      channel.generation !== event.generation ||
      channel.stopGeneration !== event.stopGeneration
    ) {
      return
    }

    await refreshWithChannel(channel)
  }

  async function refreshWithChannel(channel: DebugSessionCallStackChannel): Promise<void> {
    ensureWorkspace()

    const current = workspace

    if (current === null) {
      clearSnapshot()
      notify()
      return
    }

    snapshot = { status: 'loading', activeThreadId: channel.stoppedThreadId, threads: [] }
    frames = new Map()
    notify()

    const threadsOutcome = await channel.requestThreads()

    if (!isCurrentStop(channel, current.id)) {
      return
    }

    if (threadsOutcome.status !== 'success') {
      log('warn', `threads request failed: ${describeRequestOutcome(threadsOutcome)}`)
      snapshot = { status: 'stopped', activeThreadId: null, threads: [] }
      frames = new Map()
      notify()
      return
    }

    const threads = parseThreadsResponse(threadsOutcome.body)

    if (threads === null) {
      log('warn', 'ignored a malformed threads response.')
      snapshot = { status: 'stopped', activeThreadId: null, threads: [] }
      frames = new Map()
      notify()
      return
    }

    const activeThreadId = selectActiveThreadId(threads, channel.stoppedThreadId)

    if (activeThreadId === null) {
      snapshot = { status: 'stopped', activeThreadId: null, threads: toSnapshotThreads(threads) }
      frames = new Map()
      notify()
      return
    }

    const stackOutcome = await channel.requestStackTrace(createStackTraceArguments(activeThreadId))

    if (!isCurrentStop(channel, current.id)) {
      return
    }

    const stackFrames =
      stackOutcome.status === 'success'
        ? parseStackTraceResponse(current.rootPath, stackOutcome.body)
        : null

    if (stackFrames === null) {
      log(
        'warn',
        stackOutcome.status === 'success'
          ? 'ignored a malformed stackTrace response.'
          : `stackTrace request failed: ${describeRequestOutcome(stackOutcome)}`
      )
    }

    const parsedFrames = stackFrames ?? []

    snapshot = {
      status: 'stopped',
      activeThreadId,
      threads: toSnapshotThreads(threads, activeThreadId, parsedFrames)
    }
    frames = collectFrameHandles(current.id, channel, activeThreadId, parsedFrames)
    notify()
  }

  function isCurrentStop(channel: DebugSessionCallStackChannel, workspaceId: string): boolean {
    return (
      workspace?.id === workspaceId &&
      dependencies.getDebugState() === 'stopped' &&
      dependencies.getDebugGeneration() === channel.generation &&
      dependencies.getDebugStopGeneration() === channel.stopGeneration
    )
  }

  function ensureWorkspace(): void {
    const current = dependencies.getWorkspace()

    if (current?.id === workspace?.id) {
      return
    }

    workspace = current
    clearSnapshot()
  }

  function clearSnapshot(): void {
    snapshot = EMPTY_DEBUG_CALL_STACK
    frames = new Map()
  }

  function notify(): void {
    dependencies.emit(workspace?.id ?? '', snapshot)
  }

  function log(level: 'warn' | 'debug', message: string): void {
    dependencies.log?.(level, message)
  }

  return { list, getFrameHandle, start }
}

const log = createLogger('debug-call-stack')

const defaultStore = createDebugCallStackStore({
  getWorkspace: getCurrentWorkspaceFolder,
  getDebugState: getDebugSessionState,
  getDebugGeneration: getDebugSessionGeneration,
  getDebugStopGeneration: getDebugSessionStopGeneration,
  getChannel: getDebugSessionCallStackChannel,
  onDebugStateChange: onDebugSessionStateChange,
  onDebugStopped: onDebugSessionStopped,
  onDebugThread: onDebugSessionThread,
  emit: (workspaceId, callStack) => {
    emitIpcEvent(IPC_EVENT_CHANNELS.DEBUG_CALL_STACK_CHANGED, { workspaceId, callStack })
  },
  log: (level, message) => {
    if (level === 'warn') {
      log.warn(message)
    } else {
      log.debug(message)
    }
  }
})

export function listDebugCallStack(): DebugCallStackSnapshot {
  return defaultStore.list()
}

export function getDebugCallStackFrameHandle(
  rawFrameId: unknown
): DebugCallStackFrameHandle | null {
  return defaultStore.getFrameHandle(rawFrameId)
}

export function startDebugCallStackHosting(
  onWorkspaceChange: (listener: (next: WorkspaceFolder | null) => void) => () => void
): void {
  defaultStore.start(onWorkspaceChange)
}

function toSnapshotThreads(
  threads: readonly DapThread[],
  activeThreadId: number | null = null,
  activeFrames: readonly DebugCallStackFrame[] = []
): readonly DebugCallStackThread[] {
  return threads.map((thread) => ({
    id: thread.id,
    name: thread.name,
    stopped: activeThreadId === null ? false : thread.id === activeThreadId,
    frames: thread.id === activeThreadId ? activeFrames : []
  }))
}

function collectFrameHandles(
  workspaceId: string,
  channel: DebugSessionCallStackChannel,
  threadId: number,
  stackFrames: readonly DebugCallStackFrame[]
): Map<number, DebugCallStackFrameHandle> {
  const next = new Map<number, DebugCallStackFrameHandle>()

  for (const frame of stackFrames) {
    next.set(frame.id, {
      workspaceId,
      sessionGeneration: channel.generation,
      stopGeneration: channel.stopGeneration,
      threadId,
      frameId: frame.id
    })
  }

  return next
}

function selectActiveThreadId(
  threads: readonly DapThread[],
  stoppedThreadId: number | null
): number | null {
  if (stoppedThreadId !== null && threads.some((thread) => thread.id === stoppedThreadId)) {
    return stoppedThreadId
  }

  return threads[0]?.id ?? null
}

function describeRequestOutcome(outcome: { readonly status: 'failure' | 'closed' }): string {
  switch (outcome.status) {
    case 'failure':
      return 'adapter rejected the request.'
    case 'closed':
      return 'the debug session moved on before the request completed.'
  }
}
