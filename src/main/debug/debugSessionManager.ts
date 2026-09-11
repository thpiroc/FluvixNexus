import type {
  DebugControlFailure,
  DebugControlOutcome,
  DebugControlRejection,
  DebugExecutionControl
} from '@shared/debug'
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
import {
  NO_DEBUG_ADAPTER_STOP_CAPABILITIES,
  checkDebugExecutionControl,
  createDapDisconnectArguments,
  createDapExecutionRequest,
  isResumingDebugControl,
  planDebugStop,
  readDebugAdapterStopCapabilities,
  readFirstThreadId,
  readStoppedThreadId,
  type DebugAdapterStopCapabilities,
  type DebugStopPhase
} from './executionControl'

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
 * `terminate` を送ってから、debuggee が終わるのを待つ長さ（Session 6-4）。
 *
 * debuggee は terminate を**拒める**（DAP の仕様）。拒まれたままだとセッションは
 * terminating に留まり続けるので、これを過ぎたら `disconnect` へ進める。
 */
export const DEBUG_SESSION_TERMINATE_GRACE_MS = 3_000

/**
 * `disconnect` を送ってから、adapter が答えるか閉じるのを待つ長さ（Session 6-4）。
 *
 * これを過ぎたら adapter のプロセスを kill する。**Stop を押したセッションは、
 * この2つの和を上限に必ず idle へ戻る** ── orphan process を残さないための上限にあたる。
 */
export const DEBUG_SESSION_DISCONNECT_GRACE_MS = 2_000

/**
 * 実行制御（Continue / Pause / Step）の答えを待つ長さ（Session 6-4）。
 *
 * 過ぎたら `timeout` として返し、次の操作を受け付ける。**遅れて届いた答えは
 * 捨てずに当てる** ── 状態は adapter の事実に合わせるべきで、待つのをやめたのは
 * Renderer への返事だけにすぎない。
 */
export const DEBUG_SESSION_CONTROL_TIMEOUT_MS = 10_000

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
  /** 以下3つは Session 6-4。既定は上の定数で、テストが短くするためにある。 */
  readonly terminateGraceMs?: number
  readonly disconnectGraceMs?: number
  readonly controlTimeoutMs?: number
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
  /** 以下は Session 6-4（実行制御と Stop）。 */
  /** `initialize` の応答から読んだ、終わらせ方に関わる capability。 */
  stopCapabilities: DebugAdapterStopCapabilities
  /** 最後の `stopped` event が名指したスレッド（無ければ null）。 */
  stoppedThreadId: number | null
  /**
   * `stopped` event を受けた回数。再開の応答を当ててよいかを決めるのに使う ──
   * 応答より先に次の `stopped` が届いていたら、もう running へ戻してはいけない。
   */
  stopEpoch: number
  /** 答えを待っている実行制御（同時に1つだけ）。 */
  pendingControl: DebugExecutionControl | null
  stopPhase: DebugStopPhase
  stopTimer: ReturnType<typeof setTimeout> | null
  /** `disconnect` を送ったか（Stop と Main の片付けで2通送らないため）。 */
  disconnectSent: boolean
  /** idle へ戻り終えたとき解決する（Stop の返事はこれを待つ）。 */
  readonly ended: Deferred<void>
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
  /**
   * **その場で**終わらせる（Session 6-2）。Workspace の切り替え・アプリの終了・
   * adapter の異常で Main 自身が使う経路で、`disconnect` を書いてすぐ kill する。
   * 利用者の Stop は `requestStop()`（Session 6-4）を通り、こちらを使わない。
   */
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
  /**
   * 実行制御（Session 6-4）。Continue / Pause / Step Over / Step Into / Step Out。
   *
   * 受け取るのは閉じた集合の名前だけで、DAP の command 名は受け取らない
   * （翻訳は main/debug/executionControl.ts）。今の状態で意味が無ければ adapter へ
   * 何も送らずに断る。
   */
  readonly control: (control: DebugExecutionControl) => Promise<DebugControlOutcome>
  /**
   * 利用者の Stop（Session 6-4）。`terminate` → `disconnect` → kill の段を踏み、
   * **idle へ戻り終えてから**答える。
   *
   * `stop(reason)` とは別のもの ── あちらは Workspace の切り替え / アプリの終了 /
   * adapter の異常で Main 自身が使う**その場で終わらせる**経路で、6-2 のまま動かしていない。
   */
  readonly requestStop: () => Promise<DebugControlOutcome>
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
      terminationRequested: false,
      stopCapabilities: NO_DEBUG_ADAPTER_STOP_CAPABILITIES,
      stoppedThreadId: null,
      stopEpoch: 0,
      pendingControl: null,
      stopPhase: 'none',
      stopTimer: null,
      disconnectSent: false,
      ended: createDeferred()
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

    /*
      以下の `isActive` は、6-2 の `isCurrent` に「Stop を頼まれていない」を足したもの
      （Session 6-4）。起動の途中で Stop が押されたら、仕込みも `configurationDone` も
      送らずにここで降りる ── 終わらせている adapter へ設定を送り続けない。
      Stop が無い限り `isCurrent` と同じ答えになるので、6-2 の順序は変わらない。
    */
    try {
      if (!isActive(record)) {
        return
      }

      if (initialize.status !== 'success') {
        failStartingRecord(record, describeRequestFailure('initialize', initialize))
        return
      }

      record.stopCapabilities = readDebugAdapterStopCapabilities(initialize.body)

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

      if (!isActive(record)) {
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

        if (!isActive(record)) {
          return
        }
      }

      if (supportsConfigurationDone) {
        const configurationDone = await request(record, 'configurationDone')

        if (!isActive(record)) {
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
        /*
          止まった回数と、止まったスレッドは状態に関係なく控える（Session 6-4）。
          stopped のまま次の `stopped` が届くこともある ── Step の応答より先に
          「Step が終わって止まった」が届いた場合がそれで、その後に届いた応答で
          running へ戻してはいけない（`applyControlOutcome`）。
        */
        record.stopEpoch += 1
        record.stoppedThreadId = readStoppedThreadId(body)

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
        /*
          Stop の `terminate` に debuggee が応じた（Session 6-4）。DAP の仕様では、
          この後に client が `disconnect` を送って adapter 自身を閉じさせる
          ── いきなり kill せず、その段へ進める。
          `disconnect` を送った後に届いたものは、その答えを待つだけでよい。
        */
        if (record.stopPhase === 'terminate') {
          beginDisconnect(record, `the debug adapter sent "${event}" after terminate.`)
          return
        }

        if (record.stopPhase === 'disconnect') {
          return
        }

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

    /*
      Stop の途中で adapter が落ちた / 流れが壊れた（Session 6-4）。終わらせようと
      していたものが先に終わっただけなので、失敗としては扱わずに片付けを終える。
    */
    if (record.stopPhase !== 'none') {
      log('warn', `${record.adapterCommand.name}: failed while stopping: ${reason}`)
      terminateRecord(record, reason, false)
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

    /*
      `disconnect` を受けた adapter が自分から閉じた ── Stop の正常な終わり方
      （Session 6-4）。「予期せず閉じた」として error に残さない。
    */
    if (record.stopPhase !== 'none') {
      log('debug', `${record.adapterCommand.name}: the debug adapter closed after stop.`)
      terminateRecord(record, 'the debug adapter closed after stop.', false)
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
    clearStopTimer(record)

    if (record.state !== 'terminating') {
      transition(record, 'terminate')
    }

    if (!record.cleanupStarted) {
      record.cleanupStarted = true

      /*
        Stop の段で既に `disconnect` を送ってあれば、重ねて送らない（Session 6-4）。
        引数は capability を見て組み立てる（`terminateDebuggee` は名乗る adapter にだけ）。
      */
      if (requestDisconnect && record.process !== null && !record.disconnectSent) {
        record.disconnectSent = true
        void record.process.connection.request(
          'disconnect',
          createDapDisconnectArguments(record.stopCapabilities)
        )
      }

      record.process?.dispose(reason)
    }

    completeCleanup(record, reason)
  }

  function completeCleanup(record: RunningDebugSession, reason: string): void {
    if (!isCurrent(record)) {
      return
    }

    clearStopTimer(record)

    if (record.state === 'terminating') {
      transition(record, 'cleanup')
    } else if (record.state !== 'idle') {
      log('warn', `debug session cleanup from unexpected state "${record.state}": ${reason}`)
    }

    current = null
    notify(null)
    record.ended.resolve()
  }

  /**
   * 実行制御（Session 6-4）。
   *
   * ## 断る順番
   *
   * ```
   * idle                       → no-session
   * 状態が合わない              → invalid-state（adapter へは何も送らない）
   * 前の制御の答えを待っている  → busy
   * ```
   *
   * **同時に待つ制御は1つだけ。** Step Over を連打したとき、2通目は1通目が
   * 進めた先で意味を持つかどうか分からない（1通目の応答の時点ではまだ stopped の
   * ことすらある）── 答えが返るまで次を受けない。Stop はこの制限を受けない。
   */
  async function control(kind: DebugExecutionControl): Promise<DebugControlOutcome> {
    const record = current
    const check = checkDebugExecutionControl(getState(), kind)

    if (check.status === 'rejected' || record === null) {
      return rejected(check.status === 'rejected' ? check.reason : 'no-session')
    }

    if (record.pendingControl !== null) {
      return rejected('busy')
    }

    record.pendingControl = kind

    try {
      const outcome = await withTimeout(
        runControl(record, kind),
        options.controlTimeoutMs ?? DEBUG_SESSION_CONTROL_TIMEOUT_MS
      )

      if (outcome === null) {
        log('warn', `${record.adapterCommand.name}: "${kind}" did not answer in time.`)
        return failed('timeout')
      }

      return outcome
    } finally {
      if (record.pendingControl === kind) {
        record.pendingControl = null
      }
    }
  }

  async function runControl(
    record: RunningDebugSession,
    kind: DebugExecutionControl
  ): Promise<DebugControlOutcome> {
    const threadId = await resolveControlThreadId(record, kind)

    if (!isActive(record)) {
      return failed('session-ended')
    }

    /*
      スレッドを問い合わせている間に状態が変わりうる（`continued` が届いた・
      自分で止まった）。送る直前にもう一度確かめる。
    */
    const check = checkDebugExecutionControl(record.state, kind)

    if (check.status === 'rejected') {
      return rejected(check.reason)
    }

    if (threadId === null) {
      log('warn', `${record.adapterCommand.name}: no thread to "${kind}".`)
      return failed('no-thread')
    }

    const epoch = record.stopEpoch
    const dapRequest = createDapExecutionRequest(kind, threadId)
    const outcome = await request(record, dapRequest.command, dapRequest.arguments)

    applyControlOutcome(record, kind, epoch, outcome)

    if (!isCurrent(record)) {
      return failed('session-ended')
    }

    switch (outcome.status) {
      case 'success':
        return { status: 'accepted', state: record.state }

      case 'failure':
        /*
          adapter の文言は Main のログにだけ残す。絶対パスを含みうるため、
          Renderer へは理由の分類だけを返す（shared/debug/session.ts）。
        */
        log(
          'warn',
          `${record.adapterCommand.name}: "${dapRequest.command}" failed: ${outcome.message ?? ''}`
        )
        return failed('adapter-rejected')

      case 'closed':
        return failed('session-ended')
    }
  }

  /**
   * 応答を状態へ当てる（Session 6-4）。
   *
   * 再開の制御（Continue / Step）が受け付けられたら stopped → running。
   * **`continued` event は待たない** ── DAP は `continue` などの応答に対して
   * それを送らなくてよいと定めている。当てない場合が3つある:
   *
   * - 世代が違う / Stop の途中（前のセッションの答えで今のセッションを動かさない）
   * - もう stopped でない（`continued` が先に届いた）
   * - **応答より先に次の `stopped` が届いていた**（`stopEpoch` が進んでいる）
   *   ── Step がすぐ終わる adapter では「終わって止まった」が応答を追い越しうる。
   *   そこで running に戻すと、止まっているのに走っていることになる
   *
   * Pause は応答では何も動かさない。止まったことは `stopped` event が伝える。
   */
  function applyControlOutcome(
    record: RunningDebugSession,
    kind: DebugExecutionControl,
    epoch: number,
    outcome: DapRequestOutcome
  ): void {
    if (
      outcome.status !== 'success' ||
      !isResumingDebugControl(kind) ||
      !isActive(record) ||
      record.state !== 'stopped' ||
      record.stopEpoch !== epoch
    ) {
      return
    }

    transition(record, 'continued')
  }

  /**
   * 制御の相手のスレッド。
   *
   * Continue / Step は**止まったスレッド**（最後の `stopped` event が名指したもの）。
   * Pause と、`stopped` が `threadId` を省いていた場合は `threads` を問い合わせて
   * 最初のスレッドにする。どのスレッドを選ぶかを利用者が決めるのは Call Stack
   * （Session 6-5）で、ここでは Renderer から `threadId` を受け取らない。
   */
  async function resolveControlThreadId(
    record: RunningDebugSession,
    kind: DebugExecutionControl
  ): Promise<number | null> {
    if (kind !== 'pause' && record.stoppedThreadId !== null) {
      return record.stoppedThreadId
    }

    const threads = await request(record, 'threads')

    return threads.status === 'success' ? readFirstThreadId(threads.body) : null
  }

  /**
   * 利用者の Stop（Session 6-4）。
   *
   * ```
   * running / stopped ─(terminate を名乗る)─→ terminate ─┬─ terminated / exited ─→ disconnect
   *        │                                             ├─ 失敗の応答 ──────────→ disconnect
   *        │                                             ├─ 猶予切れ ────────────→ disconnect
   *        │                                             └─ もう一度 Stop ───────→ disconnect
   *        └─(名乗らない)──────────────────────────────────────────────────────→ disconnect
   * starting ──────────────────────────────────────────────────────────────────→ disconnect
   *
   * disconnect ─┬─ 応答 / adapter が閉じた ─→ kill → idle
   *             └─ 猶予切れ ────────────────→ kill → idle
   * ```
   *
   * 押した時点で terminating へ進め、以降の Continue / Step は断る。
   * **答えるのは idle へ戻り終えてから**で、何度押しても同じ終わりを待つ。
   */
  function requestStop(): Promise<DebugControlOutcome> {
    const record = current

    if (record === null) {
      return Promise.resolve(rejected('no-session'))
    }

    switch (planDebugStop(record.state, record.stopPhase, record.stopCapabilities)) {
      case 'no-session':
        return Promise.resolve(rejected('no-session'))

      case 'terminate':
        beginTerminate(record)
        break

      case 'disconnect':
        beginDisconnect(
          record,
          record.stopPhase === 'terminate'
            ? 'stop was requested again while terminating.'
            : 'stop was requested.'
        )
        break

      case 'wait':
        break
    }

    return record.ended.promise.then(() => ({ status: 'accepted', state: getState() }) as const)
  }

  function beginStopping(record: RunningDebugSession): void {
    record.terminationRequested = true
    record.initialized.resolve()

    if (record.state !== 'terminating') {
      transition(record, 'terminate')
    }
  }

  function beginTerminate(record: RunningDebugSession): void {
    beginStopping(record)
    record.stopPhase = 'terminate'

    armStopTimer(record, options.terminateGraceMs ?? DEBUG_SESSION_TERMINATE_GRACE_MS, () => {
      beginDisconnect(record, 'the debuggee did not terminate in time.')
    })

    void request(record, 'terminate').then((outcome) => {
      if (isCurrent(record) && record.stopPhase === 'terminate' && outcome.status !== 'success') {
        beginDisconnect(record, describeRequestFailure('terminate', outcome))
      }
    })
  }

  function beginDisconnect(record: RunningDebugSession, reason: string): void {
    if (!isCurrent(record) || record.stopPhase === 'disconnect' || record.cleanupStarted) {
      return
    }

    log('debug', `${record.adapterCommand.name}: disconnecting: ${reason}`)
    beginStopping(record)
    record.stopPhase = 'disconnect'

    armStopTimer(record, options.disconnectGraceMs ?? DEBUG_SESSION_DISCONNECT_GRACE_MS, () => {
      terminateRecord(record, 'the debug adapter did not answer disconnect in time.', false)
    })

    record.disconnectSent = true
    void request(record, 'disconnect', createDapDisconnectArguments(record.stopCapabilities)).then(
      () => {
        /*
          答えが成功でも失敗でも、ここで adapter を閉じる。disconnect は
          「debuggee を終わらせてから答える」決まりで、答えた後に残す理由が無い。
        */
        terminateRecord(record, 'the debug session was stopped.', false)
      }
    )
  }

  function armStopTimer(record: RunningDebugSession, ms: number, onElapsed: () => void): void {
    clearStopTimer(record)

    record.stopTimer = setTimeout(() => {
      record.stopTimer = null

      if (isCurrent(record)) {
        onElapsed()
      }
    }, ms)
    record.stopTimer.unref?.()
  }

  function clearStopTimer(record: RunningDebugSession): void {
    if (record.stopTimer !== null) {
      clearTimeout(record.stopTimer)
      record.stopTimer = null
    }
  }

  function rejected(reason: DebugControlRejection): DebugControlOutcome {
    return { status: 'rejected', reason, state: getState() }
  }

  function failed(reason: DebugControlFailure): DebugControlOutcome {
    return { status: 'failed', reason, state: getState() }
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

  /** 今のセッションで、まだ Stop を頼まれていない（Session 6-4）。 */
  function isActive(record: RunningDebugSession): boolean {
    return isCurrent(record) && !record.terminationRequested
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
    getBreakpointChannel,
    control,
    requestStop
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

/** 実行制御（Session 6-4）。呼ぶのは main/ipc/handlers/debug.ts だけになる。 */
export function controlDebugSession(control: DebugExecutionControl): Promise<DebugControlOutcome> {
  return defaultManager.control(control)
}

/**
 * 利用者の Stop（Session 6-4）。`stopDebugSession(reason)` とは別の経路で、
 * terminate → disconnect → kill の段を踏んでから答える。
 */
export function requestDebugSessionStop(): Promise<DebugControlOutcome> {
  return defaultManager.requestStop()
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

/** 待ちきれなければ null（元の promise は捨てずに走らせたままにする）。 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => {
      resolve(null)
    }, ms)
    timer.unref?.()

    void promise.then((value) => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export type { DebugSessionState } from './debugSessionState'
export type { StartDebugAdapterProcessOutcome }
