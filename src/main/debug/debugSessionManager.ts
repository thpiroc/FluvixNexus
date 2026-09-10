import type { DebugAdapterCommand } from './adapterCatalog'
import {
  startDebugAdapterProcess,
  type DebugAdapterProcess,
  type DebugAdapterProcessCloseReason,
  type StartDebugAdapterProcessOutcome
} from './adapterProcess'
import type { DapRequestOutcome } from './dapConnection'
import type { DapSetBreakpointsArguments } from './dapBreakpoints'
import {
  applyDebugSessionTransition,
  type DebugSessionState,
  type DebugSessionTransition
} from './debugSessionState'

export interface DebugSessionStartOptions {
  readonly adapterId: string
  readonly adapterCommand: DebugAdapterCommand
  readonly launchArguments?: unknown
  readonly clientName?: string
  readonly clientVersion?: string
  readonly processId?: number
}

export type StartDebugSessionOutcome =
  | { readonly status: 'started'; readonly sessionId: string; readonly generation: number }
  | { readonly status: 'already-running'; readonly state: DebugSessionState }
  | { readonly status: 'spawn-failed'; readonly detail: string }

export type StopDebugSessionOutcome = { readonly status: 'stopped' } | { readonly status: 'idle' }

export type DebugSessionStateListener = (
  state: DebugSessionState,
  sessionId: string | null,
  generation: number
) => void

export const DEBUG_SESSION_START_TIMEOUT_MS = 60_000

/**
 * 動いている Debug Session へ breakpoint を送る口（Session 6-3）。
 *
 * ## なぜ「送れるもの」を1つに絞ってあるのか
 *
 * ここを `request(command, args)` の形にすると、**Main の中に任意の DAP method を
 * 送れる場所ができる。** Renderer からは届かないので Security boundary は破れないが、
 * 「口は機能ごとに分かれている」（docs/ARCHITECTURE.md §20.9）という決めは
 * Main の内側でも保つ ── 機能が増えるたびに、その機能の名前の付いた口を足す。
 *
 * ## 世代を持って渡す
 *
 * `generation` は発行時のセッションの世代で、受け取った側は**答えが返ってきた
 * 時点でまだ同じ世代か**を確かめる（main/debug/breakpoints.ts）。前のセッションへ
 * 送った `setBreakpoints` の応答が、新しいセッションの verified を書き換えないため。
 * LSP が版（`version`）で古い応答を捨てたのと同じ仕組みを、単位をセッションに
 * 変えて置いてある（§20.8）。
 */
export interface DebugSessionBreakpointChannel {
  readonly sessionId: string
  readonly generation: number
  readonly setBreakpoints: (args: DapSetBreakpointsArguments) => Promise<DapRequestOutcome>
}

/**
 * `initialized` の後、`configurationDone` の前に呼ばれる仕込み（Session 6-3）。
 *
 * DAP の lifecycle 上、breakpoint を送ってよいのは
 * **`initialized` を受けてから `configurationDone` を送るまで**の間になる
 * （docs/ARCHITECTURE.md §20.8）。その一点を外から差し込めるようにしてあるのが
 * この hook で、**`launch` の応答は待たない**という 6-2 の決めは動かない。
 *
 * 失敗しても Debug Session は続く。印が付かないことは、走らせられないことと同じでは
 * ないため ── 失敗は Main のログに残す。
 */
export type DebugSessionConfigurationHook = (
  channel: DebugSessionBreakpointChannel
) => Promise<void> | void

export type StartDebugAdapterProcess = typeof startDebugAdapterProcess

export interface DebugSessionManagerOptions {
  readonly startAdapterProcess?: StartDebugAdapterProcess
  readonly startTimeoutMs?: number
  readonly onLog?: (level: 'debug' | 'warn' | 'error', message: string) => void
  /** `initialized` の後、`configurationDone` の前に呼ばれる仕込み（Session 6-3）。 */
  readonly configurationHook?: DebugSessionConfigurationHook
}

interface RunningDebugSession {
  readonly sessionId: string
  readonly generation: number
  readonly adapterId: string
  readonly adapterCommand: DebugAdapterCommand
  readonly launchArguments: unknown
  readonly initialized: Deferred<void>
  readonly clientName: string
  readonly clientVersion: string
  readonly processId: number
  process: DebugAdapterProcess | null
  state: DebugSessionState
  cleanupStarted: boolean
  terminationRequested: boolean
}

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

export interface DebugSessionManager {
  readonly getState: () => DebugSessionState
  readonly getSessionId: () => string | null
  readonly getGeneration: () => number
  readonly onStateChange: (listener: DebugSessionStateListener) => () => void
  readonly start: (options: DebugSessionStartOptions) => StartDebugSessionOutcome
  readonly stop: (reason: string) => StopDebugSessionOutcome
  readonly dispose: (reason: string) => void
  /**
   * `initialized` → `configurationDone` の間に差し込む仕込みを差し替える（Session 6-3）。
   *
   * 既定のマネージャは module の読み込み時に作られるため、options では渡せない。
   * 登録するのは main/debug/breakpoints.ts 1箇所だけになる。
   */
  readonly setConfigurationHook: (hook: DebugSessionConfigurationHook | null) => void
  /**
   * 動いているセッションへ breakpoint を送る口（Session 6-3）。
   *
   * **`running` / `stopped` のときだけ返る。** `starting` の間に返してしまうと、
   * 仕込み（`configurationHook`）が走っている最中に別経路の送信が割り込み、
   * 同じファイルへ2通の `setBreakpoints` が前後して届きうる。
   * 起動中の同期は仕込みの側が引き受ける。
   */
  readonly getBreakpointChannel: () => DebugSessionBreakpointChannel | null
}

export function createDebugSessionManager(
  options: DebugSessionManagerOptions = {}
): DebugSessionManager {
  const startAdapterProcess = options.startAdapterProcess ?? startDebugAdapterProcess
  const listeners = new Set<DebugSessionStateListener>()
  let generation = 0
  let current: RunningDebugSession | null = null
  let configurationHook: DebugSessionConfigurationHook | null = options.configurationHook ?? null

  function getState(): DebugSessionState {
    return current?.state ?? 'idle'
  }

  function getSessionId(): string | null {
    return current?.sessionId ?? null
  }

  function notify(record: RunningDebugSession | null): void {
    const state = record?.state ?? 'idle'
    const sessionId = record?.sessionId ?? null
    const eventGeneration = record?.generation ?? generation

    for (const listener of listeners) {
      try {
        listener(state, sessionId, eventGeneration)
      } catch (cause) {
        log('error', `a debug session state listener failed: ${describeError(cause)}`)
      }
    }
  }

  function transition(record: RunningDebugSession, event: DebugSessionTransition): boolean {
    try {
      record.state = applyDebugSessionTransition(record.state, event)
      notify(record)
      return true
    } catch (cause) {
      log('warn', describeError(cause))
      return false
    }
  }

  function start(startOptions: DebugSessionStartOptions): StartDebugSessionOutcome {
    if (current !== null) {
      return { status: 'already-running', state: current.state }
    }

    generation += 1
    const record: RunningDebugSession = {
      sessionId: `debug-session-${generation}`,
      generation,
      adapterId: startOptions.adapterId,
      adapterCommand: startOptions.adapterCommand,
      launchArguments: startOptions.launchArguments,
      initialized: createDeferred(),
      clientName: startOptions.clientName ?? 'Fluvix Nexus',
      clientVersion: startOptions.clientVersion ?? '0.0.1',
      processId: startOptions.processId ?? process.pid,
      process: null,
      state: 'idle',
      cleanupStarted: false,
      terminationRequested: false
    }

    current = record
    transition(record, 'start')

    const adapter = startAdapterProcess({
      command: record.adapterCommand,
      onEvent: (event, body) => {
        handleAdapterEvent(record.generation, event, body)
      },
      onAdapterRequest: (command) => {
        log('warn', `${record.adapterCommand.name}: rejected reverse DAP request "${command}".`)
      },
      onBrokenStream: (reason) => {
        handleAdapterFailure(record.generation, `the DAP message stream is broken: ${reason}`)
      },
      onError: (error) => {
        handleAdapterFailure(
          record.generation,
          `the debug adapter process failed: ${error.message}`
        )
      },
      onClose: (reason, code, signal) => {
        handleAdapterClose(record.generation, reason, code, signal)
      },
      onProtocolWarning: (reason) => {
        log('warn', `${record.adapterCommand.name}: ${reason}`)
      },
      onStderr: (chunk) => {
        log('debug', `${record.adapterCommand.name} [stderr] ${chunk}`)
      }
    })

    if (adapter.status === 'spawn-failed') {
      terminateRecord(record, 'spawn failed before the debug session started.', false)
      return { status: 'spawn-failed', detail: adapter.detail }
    }

    record.process = adapter.process
    void runStartLifecycle(record)

    return { status: 'started', sessionId: record.sessionId, generation: record.generation }
  }

  function stop(reason: string): StopDebugSessionOutcome {
    if (current === null) {
      return { status: 'idle' }
    }

    terminateRecord(current, reason, true)
    return { status: 'stopped' }
  }

  function dispose(reason: string): void {
    stop(reason)
  }

  async function runStartLifecycle(record: RunningDebugSession): Promise<void> {
    const timer = setTimeout(() => {
      if (isCurrent(record) && record.state === 'starting') {
        failStartingRecord(record, 'debug session start timed out.')
      }
    }, options.startTimeoutMs ?? DEBUG_SESSION_START_TIMEOUT_MS)

    timer.unref?.()

    const initialize = await request(record, 'initialize', createInitializeArguments(record))

    try {
      if (!isCurrent(record)) {
        return
      }

      if (initialize.status !== 'success') {
        failStartingRecord(record, describeRequestFailure('initialize', initialize))
        return
      }

      const supportsConfigurationDone = supportsConfigurationDoneRequest(initialize.body)

      const launch = request(record, 'launch', record.launchArguments)
      void launch.then((outcome) => {
        if (!isCurrent(record) || record.terminationRequested) {
          return
        }

        if (outcome.status !== 'success') {
          failActiveRecord(record, describeRequestFailure('launch', outcome))
        }
      })

      await record.initialized.promise

      if (!isCurrent(record)) {
        return
      }

      /*
        Breakpoint を送るのはここになる（Session 6-3）。

        `initialized` を受けた後、`configurationDone` を送る前 ── DAP が
        「設定を送ってよい」と定めている唯一の窓にあたる（§20.8）。
        **`launch` の応答は依然として待っていない。**

        仕込みが登録されていなければ `await` そのものを踏まない。踏むと、
        仕込みが何もしない場合でも `configurationDone` の送信が1 tick 遅れる
        ── Session 6-2 の lifecycle を、6-3 の有無で変えないための形にあたる。
      */
      if (configurationHook !== null) {
        await runConfigurationHook(record)

        if (!isCurrent(record)) {
          return
        }
      }

      if (supportsConfigurationDone) {
        const configurationDone = await request(record, 'configurationDone')

        if (!isCurrent(record)) {
          return
        }

        if (configurationDone.status !== 'success') {
          failStartingRecord(record, describeRequestFailure('configurationDone', configurationDone))
          return
        }
      }

      if (record.state === 'starting') {
        transition(record, 'started')
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 仕込みを走らせる（Session 6-3）。
   *
   * **仕込みが失敗しても Debug Session は止めない。** breakpoint が付かないことと、
   * プログラムを走らせられないことは別のことにほかならない ── 止めてしまうと、
   * 印の同期に失敗しただけでデバッグそのものが始まらなくなる。
   */
  async function runConfigurationHook(record: RunningDebugSession): Promise<void> {
    if (configurationHook === null) {
      return
    }

    try {
      await configurationHook(createBreakpointChannel(record))
    } catch (cause) {
      log('warn', `the debug session configuration hook failed: ${describeError(cause)}`)
    }
  }

  function createBreakpointChannel(record: RunningDebugSession): DebugSessionBreakpointChannel {
    return {
      sessionId: record.sessionId,
      generation: record.generation,
      setBreakpoints: (args) =>
        isCurrent(record)
          ? request(record, 'setBreakpoints', args)
          : Promise.resolve({
              status: 'closed' as const,
              reason: 'the debug session has already ended.'
            })
    }
  }

  function getBreakpointChannel(): DebugSessionBreakpointChannel | null {
    if (current === null || (current.state !== 'running' && current.state !== 'stopped')) {
      return null
    }

    return createBreakpointChannel(current)
  }

  function handleAdapterEvent(generation: number, event: string, body: unknown): void {
    const record = current

    if (record === null || record.generation !== generation) {
      return
    }

    switch (event) {
      case 'initialized':
        record.initialized.resolve()
        return

      case 'stopped':
        if (record.state === 'running') {
          transition(record, 'stopped')
        }
        return

      case 'continued':
        if (record.state === 'stopped') {
          transition(record, 'continued')
        }
        return

      case 'terminated':
      case 'exited':
        terminateRecord(record, `the debug adapter sent "${event}".`, false)
        return

      default:
        log('debug', `${record.adapterCommand.name}: unhandled DAP event "${event}".`)
        void body
        return
    }
  }

  function handleAdapterFailure(generation: number, reason: string): void {
    const record = current

    if (record === null || record.generation !== generation) {
      return
    }

    if (record.state === 'starting') {
      failStartingRecord(record, reason)
      return
    }

    failActiveRecord(record, reason)
  }

  function handleAdapterClose(
    generation: number,
    reason: DebugAdapterProcessCloseReason,
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    const record = current

    if (record === null || record.generation !== generation) {
      return
    }

    if (record.cleanupStarted) {
      completeCleanup(record, `the debug adapter process closed during cleanup: ${reason}.`)
      return
    }

    const how = signal === null ? `code=${code ?? -1}` : `signal=${signal}`
    handleAdapterFailure(generation, `the debug adapter process closed unexpectedly (${how}).`)
  }

  function failStartingRecord(record: RunningDebugSession, reason: string): void {
    log('error', `${record.adapterCommand.name}: debug session start failed: ${reason}`)
    terminateRecord(record, reason, false)
  }

  function failActiveRecord(record: RunningDebugSession, reason: string): void {
    log('error', `${record.adapterCommand.name}: debug session stopped: ${reason}`)
    terminateRecord(record, reason, false)
  }

  function terminateRecord(
    record: RunningDebugSession,
    reason: string,
    requestDisconnect: boolean
  ): void {
    if (!isCurrent(record)) {
      return
    }

    record.terminationRequested = true
    record.initialized.resolve()

    if (record.state !== 'terminating') {
      transition(record, 'terminate')
    }

    if (!record.cleanupStarted) {
      record.cleanupStarted = true

      if (requestDisconnect && record.process !== null) {
        void record.process.connection.request('disconnect', {
          restart: false,
          terminateDebuggee: true
        })
      }

      record.process?.dispose(reason)
    }

    completeCleanup(record, reason)
  }

  function completeCleanup(record: RunningDebugSession, reason: string): void {
    if (!isCurrent(record)) {
      return
    }

    if (record.state === 'terminating') {
      transition(record, 'cleanup')
    } else if (record.state !== 'idle') {
      log('warn', `debug session cleanup from unexpected state "${record.state}": ${reason}`)
    }

    current = null
    notify(null)
  }

  function request(
    record: RunningDebugSession,
    command: string,
    args?: unknown
  ): Promise<DapRequestOutcome> {
    const adapter = record.process

    if (adapter === null) {
      return Promise.resolve({ status: 'closed', reason: 'the debug adapter is not running.' })
    }

    return adapter.connection.request(command, args)
  }

  function isCurrent(record: RunningDebugSession): boolean {
    return current === record && current.generation === record.generation
  }

  function log(level: 'debug' | 'warn' | 'error', message: string): void {
    options.onLog?.(level, message)
  }

  return {
    getState,
    getSessionId,
    getGeneration: () => generation,
    onStateChange: (listener) => {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    start,
    stop,
    dispose,
    setConfigurationHook: (hook) => {
      configurationHook = hook
    },
    getBreakpointChannel
  }
}

const defaultManager = createDebugSessionManager()

export function getDebugSessionState(): DebugSessionState {
  return defaultManager.getState()
}

/**
 * 最後に発行されたセッションの世代（Session 6-3）。
 *
 * 非同期に返ってきた応答が、まだ同じセッションのものかを確かめるのに使う。
 * 状態（`getDebugSessionState()`）と**対で見る**こと ── 世代だけでは
 * 「終わった後に、新しいセッションがまだ始まっていない」を区別できない。
 */
export function getDebugSessionGeneration(): number {
  return defaultManager.getGeneration()
}

export function startDebugSession(options: DebugSessionStartOptions): StartDebugSessionOutcome {
  return defaultManager.start(options)
}

export function stopDebugSession(reason: string): StopDebugSessionOutcome {
  return defaultManager.stop(reason)
}

export function disposeDebugSession(reason: string): void {
  defaultManager.dispose(reason)
}

export function onDebugSessionStateChange(listener: DebugSessionStateListener): () => void {
  return defaultManager.onStateChange(listener)
}

/**
 * `initialized` → `configurationDone` の間に差し込む仕込みを登録する（Session 6-3）。
 *
 * 呼ぶのは main/debug/breakpoints.ts 1箇所だけになる。
 */
export function setDebugSessionConfigurationHook(hook: DebugSessionConfigurationHook | null): void {
  defaultManager.setConfigurationHook(hook)
}

/**
 * 動いているセッションへ breakpoint を送る口（Session 6-3）。
 *
 * 動いていない（`idle` / `starting` / `terminating`）なら null。
 */
export function getDebugSessionBreakpointChannel(): DebugSessionBreakpointChannel | null {
  return defaultManager.getBreakpointChannel()
}

export function startDebugSessionHosting(
  onWorkspaceChange: (listener: (workspace: unknown) => void) => () => void
): void {
  onWorkspaceChange(() => {
    disposeDebugSession('the workspace folder changed.')
  })
}

function createInitializeArguments(record: RunningDebugSession): Readonly<Record<string, unknown>> {
  return {
    adapterID: record.adapterId,
    clientID: 'fluvix-nexus',
    clientName: record.clientName,
    clientVersion: record.clientVersion,
    processId: record.processId,
    supportsRunInTerminalRequest: false
  }
}

function supportsConfigurationDoneRequest(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || !('supportsConfigurationDoneRequest' in body)) {
    return false
  }

  return (
    (body as { readonly supportsConfigurationDoneRequest?: unknown })
      .supportsConfigurationDoneRequest === true
  )
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}

  const promise = new Promise<T>((settle) => {
    resolve = settle
  })

  return { promise, resolve }
}

function describeRequestFailure(command: string, outcome: DapRequestOutcome): string {
  switch (outcome.status) {
    case 'success':
      return `${command} succeeded.`

    case 'failure':
      return outcome.message ?? `${command} failed.`

    case 'closed':
      return `${command} was not completed: ${outcome.reason}`
  }
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export type { DebugSessionState } from './debugSessionState'
export type { StartDebugAdapterProcessOutcome }
