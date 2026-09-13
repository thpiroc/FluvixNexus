import {
  EMPTY_DEBUG_CALL_STACK,
  type DebugCallStackFrame,
  type DebugCallStackSnapshot,
  type DebugCallStackThread,
  type DebugStopInfo
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
  getDebugSessionExceptionInfoChannel,
  getDebugSessionGeneration,
  getDebugSessionState,
  getDebugSessionStopGeneration,
  onDebugSessionStateChange,
  onDebugSessionStopped,
  onDebugSessionThread,
  type DebugSessionCallStackChannel,
  type DebugSessionExceptionInfoChannel,
  type DebugSessionState,
  type DebugSessionStoppedEvent,
  type DebugSessionStoppedListener,
  type DebugSessionThreadListener
} from './debugSessionManager'
import {
  UNKNOWN_DAP_STOPPED_EVENT,
  createExceptionInfoArguments,
  parseDapExceptionInfoResponse,
  toDebugStopInfo,
  type DapExceptionInfoSummary
} from './stopInfo'

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
  /**
   * snapshot が差し替わった（Session 6-6）。
   *
   * Variables は frame から辿った handle を持つため、snapshot が変わった時点で
   * 手元の handle を捨てる ── 同じ停止の中の読み直し（`thread` event）でも捨てる。
   */
  readonly onChange: (listener: () => void) => () => void
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
  /**
   * `exceptionInfo` の口（Session 6-13）。adapter が名乗らなければ null が返る。
   * 省略すると一度も送らない（stopped event の `text` / `description` だけで例外を出す）。
   */
  readonly getExceptionInfoChannel?: () => DebugSessionExceptionInfoChannel | null
  readonly onDebugStateChange: (listener: (state: DebugSessionState) => void) => () => void
  readonly onDebugStopped: (listener: DebugSessionStoppedListener) => () => void
  readonly onDebugThread: (listener: DebugSessionThreadListener) => () => void
  readonly emit: (workspaceId: string, snapshot: DebugCallStackSnapshot) => void
  readonly log?: (level: 'warn' | 'debug', message: string) => void
}

/**
 * この停止について作った「なぜ止まったか」の控え（Session 6-13）。
 *
 * 同じ停止の中の読み直し（`thread` event）で `sequence` を進めないため、そして
 * `exceptionInfo` を1つの停止につき1回しか送らないために持つ。
 */
interface StopRecord {
  readonly workspaceId: string
  readonly generation: number
  readonly stopGeneration: number
  readonly info: DebugStopInfo
  /** `exceptionInfo` を読みに行き終えたか（成功でも失敗でも、送らない場合も true）。 */
  readonly settled: boolean
}

/**
 * Call Stack の正本（Session 6-5）。
 *
 * DAP の `threads` / `stackTrace` は Main が取り、Renderer には safe snapshot だけを
 * 渡す。frame id は次の停止で再利用されうるため、現在の session generation /
 * stop generation / Workspace に属するものだけを後続機能（Session 6-6）へ渡す。
 *
 * Session 6-13 で「なぜ止まったか」（`snapshot.stop`）も同じ snapshot に載せた。
 * 例外で止まったときだけ、stackTrace の後に `exceptionInfo` を1回読む。
 */
export function createDebugCallStackStore(
  dependencies: DebugCallStackStoreDependencies
): DebugCallStackStore {
  let workspace: WorkspaceFolder | null = null
  let snapshot: DebugCallStackSnapshot = EMPTY_DEBUG_CALL_STACK
  let frames = new Map<number, DebugCallStackFrameHandle>()
  let stopRecord: StopRecord | null = null
  /** 停止ごとに進む通し番号（`DebugStopInfo.sequence`）。戻さない。 */
  let stopSequence = 0
  const changeListeners = new Set<() => void>()

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

    const stop = recordStop(channel, current)

    snapshot = {
      status: 'loading',
      activeThreadId: channel.stoppedThreadId,
      threads: [],
      stop: stop.info
    }
    frames = new Map()
    notify()

    const threadsOutcome = await channel.requestThreads()

    if (!isCurrentStop(channel, current.id)) {
      return
    }

    if (threadsOutcome.status !== 'success') {
      log('warn', `threads request failed: ${describeRequestOutcome(threadsOutcome)}`)
      snapshot = { status: 'stopped', activeThreadId: null, threads: [], stop: stop.info }
      frames = new Map()
      notify()
      return
    }

    const threads = parseThreadsResponse(threadsOutcome.body)

    if (threads === null) {
      log('warn', 'ignored a malformed threads response.')
      snapshot = { status: 'stopped', activeThreadId: null, threads: [], stop: stop.info }
      frames = new Map()
      notify()
      return
    }

    const activeThreadId = selectActiveThreadId(threads, channel.stoppedThreadId)

    if (activeThreadId === null) {
      snapshot = {
        status: 'stopped',
        activeThreadId: null,
        threads: toSnapshotThreads(threads),
        stop: stop.info
      }
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

    const settledStop = await settleExceptionInfo(channel, current, activeThreadId)

    if (settledStop === null) {
      return
    }

    const parsedFrames = stackFrames ?? []

    snapshot = {
      status: 'stopped',
      activeThreadId,
      threads: toSnapshotThreads(threads, activeThreadId, parsedFrames),
      stop: settledStop.info
    }
    frames = collectFrameHandles(current.id, channel, activeThreadId, parsedFrames)
    notify()
  }

  /**
   * この停止の「なぜ止まったか」を控えから取り出すか、新しく作る（Session 6-13）。
   *
   * 同じ Workspace・同じ session / stop generation なら控えをそのまま使う ──
   * `thread` event による読み直しで `sequence` が進むと、Renderer が「新しく止まった」と
   * 読んで Editor を動かし直すことになる。
   */
  function recordStop(channel: DebugSessionCallStackChannel, current: WorkspaceFolder): StopRecord {
    if (
      stopRecord !== null &&
      stopRecord.workspaceId === current.id &&
      stopRecord.generation === channel.generation &&
      stopRecord.stopGeneration === channel.stopGeneration
    ) {
      return stopRecord
    }

    stopSequence += 1

    const stopped = channel.stop ?? UNKNOWN_DAP_STOPPED_EVENT

    stopRecord = {
      workspaceId: current.id,
      generation: channel.generation,
      stopGeneration: channel.stopGeneration,
      info: toDebugStopInfo({
        rootPath: current.rootPath,
        sequence: stopSequence,
        stopped,
        exceptionInfo: null
      }),
      /* 例外で止まったのでなければ、読みに行くものは無い。 */
      settled: stopped.reason !== 'exception'
    }

    return stopRecord
  }

  /**
   * 例外で止まったときだけ `exceptionInfo` を1回読む（Session 6-13）。
   *
   * adapter が名乗らない・口が別の停止のもの・断られた・壊れていた、のどれでも
   * stopped event の `text` / `description` から作った形のまま進む（読みに行ったことは控える）。
   * 答えを待つ間に停止が変わっていたら null ── 古い停止の snapshot を publish しない。
   */
  async function settleExceptionInfo(
    channel: DebugSessionCallStackChannel,
    current: WorkspaceFolder,
    threadId: number
  ): Promise<StopRecord | null> {
    const record = recordStop(channel, current)

    if (record.settled) {
      return record
    }

    const exceptionChannel = dependencies.getExceptionInfoChannel?.() ?? null
    let exceptionInfo: DapExceptionInfoSummary | null = null

    if (
      exceptionChannel !== null &&
      exceptionChannel.generation === channel.generation &&
      exceptionChannel.stopGeneration === channel.stopGeneration
    ) {
      const outcome = await exceptionChannel.requestExceptionInfo(
        createExceptionInfoArguments(threadId)
      )

      if (!isCurrentStop(channel, current.id)) {
        return null
      }

      exceptionInfo =
        outcome.status === 'success' ? parseDapExceptionInfoResponse(outcome.body) : null

      if (exceptionInfo === null) {
        log(
          'warn',
          outcome.status === 'success'
            ? 'ignored a malformed exceptionInfo response.'
            : `exceptionInfo request failed: ${describeRequestOutcome(outcome)}`
        )
      }
    }

    /*
      読みに行っている間に、同じ停止の読み直しが先に控えを確定させていることがある。
      その場合は先に確定したほうを使う（`sequence` はどちらも同じ）。
    */
    if (stopRecord !== record) {
      return stopRecord !== null && stopRecord.settled ? stopRecord : record
    }

    stopRecord = {
      ...record,
      info: toDebugStopInfo({
        rootPath: current.rootPath,
        sequence: record.info.sequence,
        stopped: channel.stop ?? UNKNOWN_DAP_STOPPED_EVENT,
        exceptionInfo
      }),
      settled: true
    }

    return stopRecord
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
    stopRecord = null
  }

  function notify(): void {
    for (const listener of changeListeners) {
      try {
        listener()
      } catch (cause) {
        log('warn', `a call stack change listener failed: ${String(cause)}`)
      }
    }

    dependencies.emit(workspace?.id ?? '', snapshot)
  }

  function onChange(listener: () => void): () => void {
    changeListeners.add(listener)

    return () => {
      changeListeners.delete(listener)
    }
  }

  function log(level: 'warn' | 'debug', message: string): void {
    dependencies.log?.(level, message)
  }

  return { list, getFrameHandle, onChange, start }
}

const log = createLogger('debug-call-stack')

const defaultStore = createDebugCallStackStore({
  getWorkspace: getCurrentWorkspaceFolder,
  getDebugState: getDebugSessionState,
  getDebugGeneration: getDebugSessionGeneration,
  getDebugStopGeneration: getDebugSessionStopGeneration,
  getChannel: getDebugSessionCallStackChannel,
  getExceptionInfoChannel: getDebugSessionExceptionInfoChannel,
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

/** Call Stack snapshot が差し替わった（Session 6-6。Variables が handle を捨てる合図）。 */
export function onDebugCallStackChange(listener: () => void): () => void {
  return defaultStore.onChange(listener)
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
