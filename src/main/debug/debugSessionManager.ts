import type {
  DebugControlFailure,
  DebugControlOutcome,
  DebugControlRejection,
  DebugExecutionControl
} from '@shared/debug'
import type { DebugAdapterCommand } from './adapterCatalog'
import {
  startDebugAdapterProcess,
  type DebugAdapterConnection,
  type DebugAdapterProcess,
  type DebugAdapterProcessCloseReason,
  type StartDebugAdapterProcessOutcome
} from './adapterProcess'
import type { DapConnection, DapRequestOutcome, DapStartDebuggingAnswer } from './dapConnection'
import {
  validateDapStartDebuggingArguments,
  type DebugChildSessionPolicy
} from './dapStartDebugging'
import type { DapSetBreakpointsArguments } from './dapBreakpoints'
import type { DapEvaluateArguments } from './dapEvaluate'
import { selectDapExceptionBreakpointFilters } from './dapExceptionBreakpoints'
import {
  parseDapStoppedEvent,
  readSupportsExceptionInfoRequest,
  type DapExceptionInfoArguments,
  type DapStoppedEventSummary
} from './stopInfo'
import type { DapStackTraceArguments } from './dapStackTrace'
import {
  readSupportsVariablePaging,
  type DapScopesArguments,
  type DapVariablesArguments
} from './dapVariables'
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
  /**
   * `launch` 応答を待ってから `setBreakpoints` / `setExceptionBreakpoints` /
   * `configurationDone` へ進む。
   *
   * 既定は false。多くの adapter は `configurationDone` 後まで `launch` 応答を返さないため。
   * netcoredbg は応答前の仕込みで debuggee が即終了することがあるため、C# だけ true にする。
   */
  readonly waitForLaunchResponseBeforeConfiguration?: boolean
  readonly clientName?: string
  readonly clientVersion?: string
  readonly processId?: number
  /**
   * `setExceptionBreakpoints` で頼みたい filter の id（Session 6-13）。
   *
   * 送るのは `initialize` で adapter が名乗ったものとの積だけで、空なら送らない
   * （送らなければ 6-12 までの lifecycle と1 tick も変わらない）。
   */
  readonly exceptionBreakpointFilters?: readonly string[]
  /**
   * `startDebugging` で子セッションを受ける（Session 6-15A）。省略は受けない。
   *
   * 受けるのは root の接続に届いた1本だけで、それが **primary child** になる
   * （下の「root / child」）。省略したセッション（debugpy / netcoredbg）は 6-14 までと同じく
   * 逆方向 request をすべて断り、lifecycle も1 tick も変わらない。
   */
  readonly childSessions?: DebugChildSessionPolicy
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

export interface DebugSessionStoppedEvent {
  readonly sessionId: string
  readonly generation: number
  readonly stopGeneration: number
  readonly stoppedThreadId: number | null
  readonly allThreadsStopped: boolean | null
  /** なぜ止まったか（Session 6-13。Main の中だけの形で、文字列はまだパスを伏せていない）。 */
  readonly stop: DapStoppedEventSummary
}

export interface DebugSessionThreadEvent {
  readonly sessionId: string
  readonly generation: number
  readonly stopGeneration: number
  readonly threadId: number | null
  readonly reason: 'started' | 'exited' | null
}

export interface DebugSessionOutputEvent {
  readonly sessionId: string
  readonly generation: number
  readonly body: unknown
}

export interface DebugSessionBreakpointEvent {
  readonly sessionId: string
  readonly generation: number
  readonly body: unknown
}

export type DebugSessionStoppedListener = (event: DebugSessionStoppedEvent) => void
export type DebugSessionThreadListener = (event: DebugSessionThreadEvent) => void
export type DebugSessionOutputListener = (event: DebugSessionOutputEvent) => void
export type DebugSessionBreakpointListener = (event: DebugSessionBreakpointEvent) => void

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
 * primary child が自分から終わった後、root の `terminated` / `exited` を待つ長さ（Session 6-15B）。
 *
 * vscode-js-debug では子の `terminated` はデバッグ対象の接続が切れた合図で、プロセスの終わりと
 * その最後の出力（捕まえられなかった例外のメッセージなど）は root の接続に**後から**届く
 * （実 1.117.0 で子の `terminated` の約 60ms 後）。待つ間は terminating で、Continue / Step は断る。
 * 過ぎたら root を待たずに片付ける ── 待つのはこの長さまで。
 */
export const DEBUG_CHILD_SESSION_COMPLETION_GRACE_MS = 2_000

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
  /**
   * どの DAP 接続へ送る口か（Session 6-15A。Main の中だけの不透明な文字列）。
   *
   * root だけのセッションでは常に root の id。子セッションを受けたセッションでは、
   * 子の設定の窓で渡す口と、子が ready になった後の口が子の id を持つ。
   */
  readonly connectionId: string
  readonly setBreakpoints: (args: DapSetBreakpointsArguments) => Promise<DapRequestOutcome>
}

export interface DebugSessionCallStackChannel {
  readonly sessionId: string
  readonly generation: number
  readonly stopGeneration: number
  /**
   * 口を作った時点の実行の接続（Session 6-15A）。
   *
   * frame id / thread id は接続ごとに adapter が振る数で、root と子で重なりうる。
   * handle はこの id を一緒に控え、今の口と食い違えば `stale` として断る。
   */
  readonly connectionId: string
  readonly stoppedThreadId: number | null
  /**
   * この停止の `stopped` event から読んだもの（Session 6-13）。
   *
   * 同じ停止の中の読み直し（`thread` event）でも理由を失わないよう、口に閉じ込めて渡す。
   */
  readonly stop: DapStoppedEventSummary | null
  readonly requestThreads: () => Promise<DapRequestOutcome>
  readonly requestStackTrace: (args: DapStackTraceArguments) => Promise<DapRequestOutcome>
}

/**
 * 止まっているセッションへ `exceptionInfo` を送る口（Session 6-13）。
 *
 * **adapter が `supportsExceptionInfoRequest` を名乗り、stopped のときだけ返る。** 名乗らない
 * adapter へは送らない（`Unhandled method` を返させない。`configurationDone` と同じ判断）。
 *
 * Call Stack の口に相乗りさせない ── 送れるのは `exceptionInfo` の1つだけで、
 * 「口は機能ごとに分かれている」（§20.9）を Main の内側でも保つ（Session 6-7 と同じ線）。
 */
export interface DebugSessionExceptionInfoChannel {
  readonly sessionId: string
  readonly generation: number
  readonly stopGeneration: number
  readonly connectionId: string
  readonly requestExceptionInfo: (args: DapExceptionInfoArguments) => Promise<DapRequestOutcome>
}

/**
 * 止まっているセッションへ `scopes` / `variables` を送る口（Session 6-6）。
 *
 * Call Stack の口と同じく、取得した時点の session generation / stop generation を
 * 閉じ込め、送る時点でまだ同じ停止かを確かめる。送れるのはこの2つだけで、
 * `setVariable` / `readMemory` を送る口は作らない（`evaluate` は Session 6-7 で
 * **別の口**として足した ── 下記）。
 */
export interface DebugSessionVariablesChannel {
  readonly sessionId: string
  readonly generation: number
  readonly stopGeneration: number
  /** 口を作った時点の実行の接続（Session 6-15A。`variablesReference` も接続ごとの数）。 */
  readonly connectionId: string
  /** `initialize` の応答で adapter が `supportsVariablePaging` を名乗ったか。 */
  readonly supportsVariablePaging: boolean
  readonly requestScopes: (args: DapScopesArguments) => Promise<DapRequestOutcome>
  readonly requestVariables: (args: DapVariablesArguments) => Promise<DapRequestOutcome>
}

/**
 * 止まっているセッションへ `evaluate` を送る口（Session 6-7）。
 *
 * **Variables の口に相乗りさせない。** `requestEvaluate` を
 * `DebugSessionVariablesChannel` へ足せば1行で済むが、そうすると
 * 「Variables を読む口」が「式を評価する口」も兼ねることになる ── 機能が増えるたびに
 * その機能の名前の付いた口を足す、という決め（§20.9）は Main の内側でも保つ。
 * Session 6-6 の口が「送れるのは scopes / variables の2つだけ」と書いてある意味も、
 * 相乗りさせた時点で消える。
 *
 * `supportsEvaluateForHovers` は読まない ── 6-7 に hover 評価は無く、
 * `repl` / `watch` の evaluate はどの adapter も必須で備える（DAP の仕様）。
 */
export interface DebugSessionEvaluateChannel {
  readonly sessionId: string
  readonly generation: number
  readonly stopGeneration: number
  readonly connectionId: string
  readonly requestEvaluate: (args: DapEvaluateArguments) => Promise<DapRequestOutcome>
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
  /** Session 6-15B。既定は `DEBUG_CHILD_SESSION_COMPLETION_GRACE_MS`。 */
  readonly childCompletionGraceMs?: number
}

interface RunningDebugSession {
  readonly sessionId: string
  readonly generation: number
  readonly adapterId: string
  readonly adapterCommand: DebugAdapterCommand
  readonly launchArguments: unknown
  readonly waitForLaunchResponseBeforeConfiguration: boolean
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
  /** `initialize` の応答で `supportsVariablePaging` を名乗ったか（Session 6-6）。 */
  supportsVariablePaging: boolean
  /** 最後の `stopped` event が名指したスレッド（無ければ null）。 */
  stoppedThreadId: number | null
  /** `thread` event か `stopped` event から最後に見えたスレッド。Pause の宛先に使う。 */
  activeThreadId: number | null
  /** 以下3つは Session 6-13（例外停止）。 */
  /** 最後の `stopped` event から読んだ理由（まだ止まっていなければ null）。 */
  lastStop: DapStoppedEventSummary | null
  /** `initialize` の応答で `supportsExceptionInfoRequest` を名乗ったか。 */
  supportsExceptionInfoRequest: boolean
  /** `setExceptionBreakpoints` で頼みたい filter の id（start options のまま）。 */
  readonly exceptionBreakpointFilters: readonly string[]
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
  /** 以下は Session 6-15A（root / child）。 */
  /** root の DAP 接続の id（`<sessionId>/root`）。 */
  readonly rootConnectionId: string
  /** 子セッションを受けるか（start options のまま）。null なら `startDebugging` を断る。 */
  readonly childSessions: DebugChildSessionPolicy | null
  /** 受けた子（v1 は1本だけ）。一度受けたら、終わるまで次の子は受けない。 */
  primaryChild: ChildDebugConnection | null
  /** 子の id の通し番号。 */
  childCount: number
  /** root が `starting → running` へ進んだ（または終わった）とき解決する。子の切り替えはこれを待つ。 */
  readonly rootStarted: Deferred<void>
  /**
   * primary child が自分から終わり、root の終わりを待っている（Session 6-15B）。
   * 立っている間の子の接続の close と adapter の close は、失敗ではなく終わり方として扱う。
   */
  childCompleted: boolean
}

/**
 * root から `startDebugging` で受けた子の DAP 接続（Session 6-15A）。
 *
 * ```
 * configuring … initialize → launch → initialized → breakpoint → exception filter → configurationDone
 *               ここまでの stopped / thread / continued / breakpoint は溜めておく
 * ready       … 実行の接続がこの子へ移る（Continue / Step / Call Stack / Variables / Evaluate）
 * closed      … 片付けた / adapter 側から閉じた
 * ```
 */
interface ChildDebugConnection {
  readonly connectionId: string
  readonly link: DebugAdapterConnection
  readonly launchArguments: Readonly<Record<string, unknown>>
  readonly initialized: Deferred<void>
  phase: 'configuring' | 'ready' | 'closed'
  stopCapabilities: DebugAdapterStopCapabilities
  supportsVariablePaging: boolean
  supportsExceptionInfoRequest: boolean
  readonly bufferedEvents: { readonly event: string; readonly body: unknown }[]
}

/** DAP を送る先（Session 6-15A）。`connection` が null なら送らずに `closed` を返す。 */
interface DebugConnectionTarget {
  readonly connectionId: string
  readonly connection: DapConnection | null
}

/** 子が ready になる前に溜めておく event の上限（Session 6-15A）。 */
export const DEBUG_CHILD_SESSION_MAX_BUFFERED_EVENTS = 64

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

export interface DebugSessionManager {
  readonly getState: () => DebugSessionState
  readonly getSessionId: () => string | null
  readonly getGeneration: () => number
  readonly onStateChange: (listener: DebugSessionStateListener) => () => void
  readonly onStopped: (listener: DebugSessionStoppedListener) => () => void
  readonly onThread: (listener: DebugSessionThreadListener) => () => void
  readonly onOutput: (listener: DebugSessionOutputListener) => () => void
  readonly onBreakpoint: (listener: DebugSessionBreakpointListener) => () => void
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
  readonly getCallStackChannel: () => DebugSessionCallStackChannel | null
  /** `scopes` / `variables` を送る口（Session 6-6）。**stopped のときだけ返る。** */
  readonly getVariablesChannel: () => DebugSessionVariablesChannel | null
  /** `evaluate` を送る口（Session 6-7）。**stopped のときだけ返る。** */
  readonly getEvaluateChannel: () => DebugSessionEvaluateChannel | null
  /**
   * `exceptionInfo` を送る口（Session 6-13）。**stopped で、adapter が
   * `supportsExceptionInfoRequest` を名乗ったときだけ返る。**
   */
  readonly getExceptionInfoChannel: () => DebugSessionExceptionInfoChannel | null
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
  const stoppedListeners = new Set<DebugSessionStoppedListener>()
  const threadListeners = new Set<DebugSessionThreadListener>()
  const outputListeners = new Set<DebugSessionOutputListener>()
  const breakpointListeners = new Set<DebugSessionBreakpointListener>()
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

  function notifyStopped(record: RunningDebugSession, body: unknown): void {
    const event: DebugSessionStoppedEvent = {
      sessionId: record.sessionId,
      generation: record.generation,
      stopGeneration: record.stopEpoch,
      stoppedThreadId: record.stoppedThreadId,
      allThreadsStopped: readAllThreadsStopped(body),
      stop: record.lastStop ?? parseDapStoppedEvent(body)
    }

    for (const listener of stoppedListeners) {
      try {
        listener(event)
      } catch (cause) {
        log('error', `a debug session stopped listener failed: ${describeError(cause)}`)
      }
    }
  }

  function notifyThread(record: RunningDebugSession, body: unknown): void {
    const event: DebugSessionThreadEvent = {
      sessionId: record.sessionId,
      generation: record.generation,
      stopGeneration: record.stopEpoch,
      threadId: readThreadEventId(body),
      reason: readThreadEventReason(body)
    }

    for (const listener of threadListeners) {
      try {
        listener(event)
      } catch (cause) {
        log('error', `a debug session thread listener failed: ${describeError(cause)}`)
      }
    }
  }

  function notifyOutput(record: RunningDebugSession, body: unknown): void {
    const event: DebugSessionOutputEvent = {
      sessionId: record.sessionId,
      generation: record.generation,
      body
    }

    for (const listener of outputListeners) {
      try {
        listener(event)
      } catch (cause) {
        log('error', `a debug session output listener failed: ${describeError(cause)}`)
      }
    }
  }

  function notifyBreakpoint(record: RunningDebugSession, body: unknown): void {
    const event: DebugSessionBreakpointEvent = {
      sessionId: record.sessionId,
      generation: record.generation,
      body
    }

    for (const listener of breakpointListeners) {
      try {
        listener(event)
      } catch (cause) {
        log('error', `a debug session breakpoint listener failed: ${describeError(cause)}`)
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
      waitForLaunchResponseBeforeConfiguration:
        startOptions.waitForLaunchResponseBeforeConfiguration ?? false,
      initialized: createDeferred(),
      clientName: startOptions.clientName ?? 'Fluvix Nexus',
      clientVersion: startOptions.clientVersion ?? '0.0.1',
      processId: startOptions.processId ?? process.pid,
      process: null,
      state: 'idle',
      cleanupStarted: false,
      terminationRequested: false,
      stopCapabilities: NO_DEBUG_ADAPTER_STOP_CAPABILITIES,
      supportsVariablePaging: false,
      stoppedThreadId: null,
      activeThreadId: null,
      lastStop: null,
      supportsExceptionInfoRequest: false,
      exceptionBreakpointFilters: startOptions.exceptionBreakpointFilters ?? [],
      stopEpoch: 0,
      pendingControl: null,
      stopPhase: 'none',
      stopTimer: null,
      disconnectSent: false,
      ended: createDeferred(),
      rootConnectionId: `debug-session-${generation}/root`,
      childSessions: startOptions.childSessions ?? null,
      primaryChild: null,
      childCount: 0,
      rootStarted: createDeferred(),
      childCompleted: false
    }

    current = record
    transition(record, 'start')

    const adapter = startAdapterProcess({
      command: record.adapterCommand,
      onEvent: (event, body) => {
        handleAdapterEvent(record.generation, record.rootConnectionId, event, body)
      },
      onAdapterRequest: (command) => {
        log('warn', `${record.adapterCommand.name}: rejected reverse DAP request "${command}".`)
      },
      /*
        子セッションを受けないセッションには答える口そのものを渡さない（Session 6-15A）。
        `startDebugging` も 6-14 までと同じ経路（dapConnection の一律の断り）を通る。
      */
      ...(record.childSessions === null
        ? {}
        : {
            onStartDebugging: (args: unknown) => handleStartDebugging(record.generation, args)
          }),
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
      },
      onStdout: (chunk) => {
        log('debug', `${record.adapterCommand.name} [stdout] ${chunk}`)
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

    /*
      起動の lifecycle は常に root の接続へ送る（Session 6-15A）。子が先に ready になることは
      無い（子の切り替えは root の `started` を待つ）が、宛先を実行の接続に任せない。
    */
    const root = rootTarget(record)
    const initialize = await requestOn(root, 'initialize', createInitializeArguments(record))

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
      record.supportsVariablePaging = readSupportsVariablePaging(initialize.body)
      record.supportsExceptionInfoRequest = readSupportsExceptionInfoRequest(initialize.body)

      const supportsConfigurationDone = supportsConfigurationDoneRequest(initialize.body)
      const exceptionBreakpoints = selectDapExceptionBreakpointFilters(
        initialize.body,
        record.exceptionBreakpointFilters
      )

      const launch = requestOn(root, 'launch', record.launchArguments)

      if (record.waitForLaunchResponseBeforeConfiguration) {
        const outcome = await launch

        if (!isActive(record)) {
          return
        }

        if (outcome.status !== 'success') {
          failStartingRecord(record, describeRequestFailure('launch', outcome))
          return
        }
      } else {
        void launch.then((outcome) => {
          if (!isCurrent(record) || record.terminationRequested) {
            return
          }

          if (outcome.status !== 'success') {
            failActiveRecord(record, describeRequestFailure('launch', outcome))
          }
        })
      }

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
        await runConfigurationHook(record, createBreakpointChannel(record, root))

        if (!isActive(record)) {
          return
        }
      }

      /*
        例外で止まる条件を送る（Session 6-13）。breakpoint と同じ「設定を送ってよい窓」の中。

        送るのは言語ごとの表と adapter が名乗った filter の積だけ
        （main/dapExceptionBreakpoints.ts）で、積が空なら `await` そのものを踏まない
        ── 6-12 までの lifecycle を、例外 filter を持たない adapter で1 tick も変えない。
        断られても Debug Session は続ける（例外で止まらないだけで、走らせることはできる）。
      */
      if (exceptionBreakpoints !== null) {
        const outcome = await requestOn(root, 'setExceptionBreakpoints', exceptionBreakpoints)

        if (!isActive(record)) {
          return
        }

        if (outcome.status !== 'success') {
          log(
            'warn',
            `${record.adapterCommand.name}: setExceptionBreakpoints was not applied: ${describeRequestFailure('setExceptionBreakpoints', outcome)}`
          )
        }
      }

      if (supportsConfigurationDone) {
        const configurationDone = await requestOn(root, 'configurationDone')

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

      record.rootStarted.resolve()
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
  async function runConfigurationHook(
    record: RunningDebugSession,
    channel: DebugSessionBreakpointChannel
  ): Promise<void> {
    if (configurationHook === null) {
      return
    }

    try {
      await configurationHook(channel)
    } catch (cause) {
      log('warn', `the debug session configuration hook failed: ${describeError(cause)}`)
    }
  }

  function createBreakpointChannel(
    record: RunningDebugSession,
    target: DebugConnectionTarget
  ): DebugSessionBreakpointChannel {
    return {
      sessionId: record.sessionId,
      generation: record.generation,
      connectionId: target.connectionId,
      setBreakpoints: (args) =>
        isCurrent(record) && isLiveTarget(record, target)
          ? requestOn(target, 'setBreakpoints', args)
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

    /*
      子が設定の窓の中にいる間は返さない（Session 6-15A）。`starting` の間に返さないのと
      同じ理由で、子への仕込み（configurationHook）と別経路の送信が前後して届かないようにする。
    */
    if (current.primaryChild?.phase === 'configuring') {
      return null
    }

    return createBreakpointChannel(current, executionTarget(current))
  }

  function createCallStackChannel(record: RunningDebugSession): DebugSessionCallStackChannel {
    const stopGeneration = record.stopEpoch
    const target = executionTarget(record)

    return {
      sessionId: record.sessionId,
      generation: record.generation,
      stopGeneration,
      connectionId: target.connectionId,
      stoppedThreadId: record.stoppedThreadId,
      stop: record.lastStop,
      requestThreads: () =>
        isCurrentStoppedOn(record, stopGeneration, target)
          ? requestOn(target, 'threads')
          : Promise.resolve({
              status: 'closed' as const,
              reason: 'the stopped debug session has already moved on.'
            }),
      requestStackTrace: (args) =>
        isCurrentStoppedOn(record, stopGeneration, target)
          ? requestOn(target, 'stackTrace', args)
          : Promise.resolve({
              status: 'closed' as const,
              reason: 'the stopped debug session has already moved on.'
            })
    }
  }

  function getCallStackChannel(): DebugSessionCallStackChannel | null {
    if (current === null || current.state !== 'stopped') {
      return null
    }

    return createCallStackChannel(current)
  }

  function createVariablesChannel(record: RunningDebugSession): DebugSessionVariablesChannel {
    const stopGeneration = record.stopEpoch
    const target = executionTarget(record)
    const moved = (): Promise<DapRequestOutcome> =>
      Promise.resolve({
        status: 'closed' as const,
        reason: 'the stopped debug session has already moved on.'
      })

    return {
      sessionId: record.sessionId,
      generation: record.generation,
      stopGeneration,
      connectionId: target.connectionId,
      supportsVariablePaging: record.supportsVariablePaging,
      requestScopes: (args) =>
        isCurrentStoppedOn(record, stopGeneration, target)
          ? requestOn(target, 'scopes', args)
          : moved(),
      requestVariables: (args) =>
        isCurrentStoppedOn(record, stopGeneration, target)
          ? requestOn(target, 'variables', args)
          : moved()
    }
  }

  function getVariablesChannel(): DebugSessionVariablesChannel | null {
    if (current === null || current.state !== 'stopped') {
      return null
    }

    return createVariablesChannel(current)
  }

  function getEvaluateChannel(): DebugSessionEvaluateChannel | null {
    if (current === null || current.state !== 'stopped') {
      return null
    }

    const record = current
    const stopGeneration = record.stopEpoch
    const target = executionTarget(record)

    return {
      sessionId: record.sessionId,
      generation: record.generation,
      stopGeneration,
      connectionId: target.connectionId,
      requestEvaluate: (args) =>
        isCurrentStoppedOn(record, stopGeneration, target)
          ? requestOn(target, 'evaluate', args)
          : Promise.resolve({
              status: 'closed' as const,
              reason: 'the stopped debug session has already moved on.'
            })
    }
  }

  function getExceptionInfoChannel(): DebugSessionExceptionInfoChannel | null {
    if (current === null || current.state !== 'stopped' || !current.supportsExceptionInfoRequest) {
      return null
    }

    const record = current
    const stopGeneration = record.stopEpoch
    const target = executionTarget(record)

    return {
      sessionId: record.sessionId,
      generation: record.generation,
      stopGeneration,
      connectionId: target.connectionId,
      requestExceptionInfo: (args) =>
        isCurrentStoppedOn(record, stopGeneration, target)
          ? requestOn(target, 'exceptionInfo', args)
          : Promise.resolve({
              status: 'closed' as const,
              reason: 'the stopped debug session has already moved on.'
            })
    }
  }

  /**
   * DAP の接続から届いた event の振り分け（Session 6-15A で接続を見るようにした）。
   *
   * ```
   * root だけ（debugpy / netcoredbg）   → 6-14 までと同じ（dispatchSessionEvent）
   * 子が configuring                     → root の event は従来どおり。子の event は溜める
   * 子が ready                           → 実行の event（stopped / thread / continued /
   *                                        breakpoint）は子からだけ。root からは output /
   *                                        terminated / exited だけを受ける
   * 閉じた子 / 前の世代の接続             → 捨てる
   * ```
   */
  function handleAdapterEvent(
    generation: number,
    connectionId: string,
    event: string,
    body: unknown
  ): void {
    const record = current

    if (record === null || record.generation !== generation) {
      return
    }

    const child = record.primaryChild

    if (child !== null && child.connectionId === connectionId) {
      if (child.phase !== 'closed') {
        handleChildEvent(record, child, event, body)
      }
      return
    }

    if (connectionId !== record.rootConnectionId) {
      log('debug', `${record.adapterCommand.name}: ignored "${event}" from a closed connection.`)
      return
    }

    /*
      root の `output` を category で絞る（Session 6-15B）。表が名乗るときだけで、子が来る前から効く
      ── vscode-js-debug は子を頼む前に、起動したコマンドライン（runtime の絶対パス入り）を
      root へ `console` で書く。DAP の既定の category は `console`。
    */
    if (event === 'output' && !isRootOutputAllowed(record.childSessions, body)) {
      log(
        'debug',
        `${record.adapterCommand.name}: dropped a root output outside the allowed categories.`
      )
      return
    }

    if (
      child !== null &&
      child.phase === 'ready' &&
      event !== 'output' &&
      event !== 'terminated' &&
      event !== 'exited'
    ) {
      log('debug', `${record.adapterCommand.name}: ignored root "${event}" (child is primary).`)
      return
    }

    dispatchSessionEvent(record, event, body)
  }

  function handleChildEvent(
    record: RunningDebugSession,
    child: ChildDebugConnection,
    event: string,
    body: unknown
  ): void {
    if (event === 'initialized') {
      child.initialized.resolve()
      return
    }

    if (event === 'terminated' || event === 'exited') {
      handleChildCompletion(record, child, event, body)
      return
    }

    if (event === 'output') {
      dispatchSessionEvent(record, event, body)
      return
    }

    if (child.phase === 'configuring') {
      if (child.bufferedEvents.length >= DEBUG_CHILD_SESSION_MAX_BUFFERED_EVENTS) {
        log('warn', `${record.adapterCommand.name}: dropped child "${event}" before it was ready.`)
        return
      }

      child.bufferedEvents.push({ event, body })
      return
    }

    dispatchSessionEvent(record, event, body)
  }

  /**
   * root の接続に届いた `startDebugging`（Session 6-15A）。
   *
   * ## primary child
   *
   * **最初に受けた1本が primary child になり、それ以降は受けない**（v1）。子が ready に
   * なった時点で実行の接続が子へ移り、Continue / Pause / Step・Call Stack・Variables・
   * Evaluate・breakpoint の変更はすべて子へ送る。root に残るのは起動と片付けだけ。
   *
   * 断る順番: 前の世代 → 子を受けないセッション → 終わらせている途中 → 既に子がある →
   * 接続を足せない transport（stdio）→ 構成の検証（dapStartDebugging.ts）→ 接続が張れない。
   *
   * 断りの文言は adapter へ返るだけで、Renderer へは出ない。パスも載せない。
   */
  function handleStartDebugging(generation: number, args: unknown): DapStartDebuggingAnswer {
    const record = current

    if (record === null || record.generation !== generation) {
      return declineStartDebugging('the debug session has already ended.')
    }

    const name = record.adapterCommand.name
    const policy = record.childSessions

    if (policy === null) {
      log('warn', `${name}: rejected "startDebugging" (child sessions are not supported).`)
      return declineStartDebugging('child debug sessions are not supported.')
    }

    if (!isActive(record) || record.cleanupStarted) {
      return declineStartDebugging('the debug session is ending.')
    }

    if (record.primaryChild !== null) {
      log('warn', `${name}: rejected "startDebugging" (a child session is already attached).`)
      return declineStartDebugging('a child debug session is already attached.')
    }

    const openConnection = record.process?.openConnection

    if (openConnection === undefined) {
      log('warn', `${name}: rejected "startDebugging" (the transport has one connection).`)
      return declineStartDebugging('this debug adapter cannot open another connection.')
    }

    const validation = validateDapStartDebuggingArguments(args, policy)

    if (validation.status === 'rejected') {
      log('warn', `${name}: rejected "startDebugging" (${validation.reason}).`)
      return declineStartDebugging('the client does not start this debug session.')
    }

    const connectionId = `${record.sessionId}/child-${String(record.childCount + 1)}`
    const link = openConnection({
      onEvent: (event, body) => {
        handleAdapterEvent(record.generation, connectionId, event, body)
      },
      onAdapterRequest: (command) => {
        log('warn', `${name}: rejected reverse DAP request "${command}" on a child connection.`)
      },
      onProtocolWarning: (reason) => {
        log('warn', `${name} [child]: ${reason}`)
      },
      onClosed: (reason) => {
        handleChildClosed(record.generation, connectionId, reason)
      }
    })

    if (link === null) {
      log('warn', `${name}: rejected "startDebugging" (no connection could be opened).`)
      return declineStartDebugging('the client could not open another debug connection.')
    }

    record.childCount += 1
    const child: ChildDebugConnection = {
      connectionId,
      link,
      launchArguments: validation.configuration,
      initialized: createDeferred(),
      phase: 'configuring',
      stopCapabilities: NO_DEBUG_ADAPTER_STOP_CAPABILITIES,
      supportsVariablePaging: false,
      supportsExceptionInfoRequest: false,
      bufferedEvents: []
    }

    record.primaryChild = child
    log(
      'debug',
      `${name}: accepted a child debug session (${String(validation.droppedFieldCount)} fields dropped).`
    )
    void runChildLifecycle(record, child)

    return { accepted: true }
  }

  /**
   * 子の設定の窓（Session 6-15A）。root の lifecycle（`runStartLifecycle`）と同じ順序を、
   * 子の接続に対してもう一度踏む。
   *
   * ```
   * initialize → launch（作り直した構成）→ initialized
   *   → breakpoint（configurationHook。子へ全件を送り直す）
   *   → setExceptionBreakpoints（子が名乗った filter との積）
   *   → configurationDone（子が名乗れば）
   *   → root の running を待つ → 実行の接続を子へ切り替える
   * ```
   *
   * どこで失敗しても Debug Session ごと終わらせる ── v1 の primary child は debug 対象そのもので、
   * 子が繋がらないまま root だけ残しても止める・読むの相手がいない。
   */
  async function runChildLifecycle(
    record: RunningDebugSession,
    child: ChildDebugConnection
  ): Promise<void> {
    const target = childTarget(child)
    const timer = setTimeout(() => {
      if (isConfiguringChild(record, child)) {
        failActiveRecord(record, 'the child debug session did not finish configuration in time.')
      }
    }, options.startTimeoutMs ?? DEBUG_SESSION_START_TIMEOUT_MS)

    timer.unref?.()

    try {
      const initialize = await requestOn(target, 'initialize', createInitializeArguments(record))

      if (!isConfiguringChild(record, child)) {
        return
      }

      if (initialize.status !== 'success') {
        failActiveRecord(record, `child ${describeRequestFailure('initialize', initialize)}`)
        return
      }

      child.stopCapabilities = readDebugAdapterStopCapabilities(initialize.body)
      child.supportsVariablePaging = readSupportsVariablePaging(initialize.body)
      child.supportsExceptionInfoRequest = readSupportsExceptionInfoRequest(initialize.body)

      const supportsConfigurationDone = supportsConfigurationDoneRequest(initialize.body)
      const exceptionBreakpoints = selectDapExceptionBreakpointFilters(
        initialize.body,
        record.exceptionBreakpointFilters
      )
      const launch = requestOn(target, 'launch', child.launchArguments)

      if (record.waitForLaunchResponseBeforeConfiguration) {
        const outcome = await launch

        if (!isConfiguringChild(record, child)) {
          return
        }

        if (outcome.status !== 'success') {
          failActiveRecord(record, `child ${describeRequestFailure('launch', outcome)}`)
          return
        }
      } else {
        void launch.then((outcome) => {
          if (
            isActive(record) &&
            record.primaryChild === child &&
            child.phase !== 'closed' &&
            outcome.status !== 'success'
          ) {
            failActiveRecord(record, `child ${describeRequestFailure('launch', outcome)}`)
          }
        })
      }

      await child.initialized.promise

      if (!isConfiguringChild(record, child)) {
        return
      }

      /*
        root がまだ starting なら running へ進むのを待ってから、子の設定の窓に入る。

        - root と子の仕込み（configurationHook）を重ねない ── breakpoint の同期（breakpoints.ts）は
          「今どのファイルを送ったか」を1組しか持たず、2本が交互に進むと控えが食い違う
        - 子の stopped を starting のまま当てると、状態が running を飛ばせない
          （debugSessionState.ts の許可遷移）。それまで届いた実行の event は溜めておく
      */
      await record.rootStarted.promise

      if (!isConfiguringChild(record, child)) {
        return
      }

      if (configurationHook !== null) {
        await runConfigurationHook(record, createBreakpointChannel(record, target))

        if (!isConfiguringChild(record, child)) {
          return
        }
      }

      if (exceptionBreakpoints !== null) {
        const outcome = await requestOn(target, 'setExceptionBreakpoints', exceptionBreakpoints)

        if (!isConfiguringChild(record, child)) {
          return
        }

        if (outcome.status !== 'success') {
          log(
            'warn',
            `${record.adapterCommand.name}: child setExceptionBreakpoints was not applied: ${describeRequestFailure('setExceptionBreakpoints', outcome)}`
          )
        }
      }

      if (supportsConfigurationDone) {
        const configurationDone = await requestOn(target, 'configurationDone')

        if (!isConfiguringChild(record, child)) {
          return
        }

        if (configurationDone.status !== 'success') {
          failActiveRecord(
            record,
            `child ${describeRequestFailure('configurationDone', configurationDone)}`
          )
          return
        }
      }

      switchExecutionConnection(record, child)
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 実行の接続を子へ移す（Session 6-15A）。
   *
   * **stop generation を進める。** root の停止で作った口・frame・`variablesReference` の handle は
   * 接続が違うので使えない ── 世代で古くしておけば、Call Stack / Variables / Evaluate の既存の
   * 照合（6-5 〜 6-7）がそのまま `stale` にする。`connectionId` の照合はその上の二重の守り。
   */
  function switchExecutionConnection(
    record: RunningDebugSession,
    child: ChildDebugConnection
  ): void {
    child.phase = 'ready'
    record.stopCapabilities = child.stopCapabilities
    record.supportsVariablePaging = child.supportsVariablePaging
    record.supportsExceptionInfoRequest = child.supportsExceptionInfoRequest
    record.stopEpoch += 1
    record.stoppedThreadId = null
    record.activeThreadId = null
    record.lastStop = null

    log('debug', `${record.adapterCommand.name}: the child debug session is now primary.`)

    if (record.state === 'stopped') {
      transition(record, 'continued')
    }

    for (const buffered of child.bufferedEvents.splice(0)) {
      if (!isCurrent(record) || record.primaryChild !== child || child.phase !== 'ready') {
        return
      }

      dispatchSessionEvent(record, buffered.event, buffered.body)
    }
  }

  /**
   * primary child の `terminated` / `exited`（Session 6-15B）。
   *
   * ```
   * Stop の途中 / 片付けの途中 / 子がまだ設定中 … 6-15A のまま（dispatchSessionEvent がその場で終わらせる）
   * ready の子が自分から終わった               … terminating へ進め、root の終わりを待つ
   *                                              （root の terminated / exited / 接続の close / 猶予切れ）
   * ```
   *
   * root の接続が残っている間に届く `output` はそのまま Debug Console へ流れる。
   */
  function handleChildCompletion(
    record: RunningDebugSession,
    child: ChildDebugConnection,
    event: string,
    body: unknown
  ): void {
    if (record.childCompleted) {
      return
    }

    if (record.stopPhase !== 'none' || record.cleanupStarted || child.phase !== 'ready') {
      dispatchSessionEvent(record, event, body)
      return
    }

    record.childCompleted = true
    log('debug', `${record.adapterCommand.name}: the child sent "${event}"; waiting for the root.`)
    beginStopping(record)

    armStopTimer(
      record,
      options.childCompletionGraceMs ?? DEBUG_CHILD_SESSION_COMPLETION_GRACE_MS,
      () => {
        terminateRecord(record, 'the root debug session did not end after the child ended.', false)
      }
    )
  }

  function handleChildClosed(generation: number, connectionId: string, reason: string): void {
    const record = current

    if (record === null || record.generation !== generation || record.cleanupStarted) {
      return
    }

    const child = record.primaryChild

    if (child === null || child.connectionId !== connectionId || child.phase === 'closed') {
      return
    }

    child.phase = 'closed'
    child.initialized.resolve()

    if (record.childCompleted) {
      log(
        'debug',
        `${record.adapterCommand.name}: the child debug connection closed after it ended.`
      )
      return
    }

    if (record.stopPhase !== 'none') {
      log('debug', `${record.adapterCommand.name}: the child debug connection closed after stop.`)
      terminateRecord(record, 'the child debug connection closed after stop.', false)
      return
    }

    failActiveRecord(record, `the child debug connection closed: ${reason}`)
  }

  function isConfiguringChild(record: RunningDebugSession, child: ChildDebugConnection): boolean {
    return isActive(record) && record.primaryChild === child && child.phase === 'configuring'
  }

  /** 実行の event を状態へ当てる（6-14 までの `handleAdapterEvent` の本体）。 */
  function dispatchSessionEvent(record: RunningDebugSession, event: string, body: unknown): void {
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
        if (record.stoppedThreadId !== null) {
          record.activeThreadId = record.stoppedThreadId
        }
        /* なぜ止まったか（Session 6-13）。壊れた body は `unknown` に畳む。 */
        record.lastStop = parseDapStoppedEvent(body)

        if (record.state === 'running') {
          transition(record, 'stopped')
        }
        notifyStopped(record, body)
        return

      case 'thread':
        updateActiveThread(record, body)
        notifyThread(record, body)
        return

      case 'output':
        notifyOutput(record, body)
        return

      case 'breakpoint':
        notifyBreakpoint(record, body)
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

    /* 子が終わって root を待っている間に adapter が閉じた（Session 6-15B）── 終わり方の1つ。 */
    if (record.childCompleted) {
      log('debug', `${record.adapterCommand.name}: the adapter ended after the child: ${reason}`)
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
    record.rootStarted.resolve()
    record.primaryChild?.initialized.resolve()
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

      /*
        子の接続を先に閉じ、root と adapter のプロセスを後に閉じる（Session 6-15A）。
        socket の adapter では process の dispose も全接続を閉じるが、子の控えを
        `closed` にするのはここだけ ── 閉じた後に遅れて届いた event を捨てられるように。
      */
      const child = record.primaryChild

      if (child !== null) {
        child.phase = 'closed'
        child.link.dispose(reason)
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

    if (kind === 'pause' && record.activeThreadId !== null) {
      return record.activeThreadId
    }

    const threads = await request(record, 'threads')

    return threads.status === 'success' ? readFirstThreadId(threads.body) : null
  }

  function updateActiveThread(record: RunningDebugSession, body: unknown): void {
    const threadId = readThreadEventId(body)
    const reason = readThreadEventReason(body)

    if (threadId === null || reason === null) {
      return
    }

    if (reason === 'started') {
      record.activeThreadId = threadId
      return
    }

    if (record.activeThreadId === threadId) {
      record.activeThreadId = null
    }
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
    record.rootStarted.resolve()
    record.primaryChild?.initialized.resolve()

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

  /**
   * 実行の接続へ送る（Continue / Pause / Step・`threads`・Stop の `terminate` / `disconnect`）。
   *
   * root だけのセッションでは root の接続そのもの（6-14 までと同じ）。子が ready なら子の接続。
   */
  function request(
    record: RunningDebugSession,
    command: string,
    args?: unknown
  ): Promise<DapRequestOutcome> {
    return requestOn(executionTarget(record), command, args)
  }

  function requestOn(
    target: DebugConnectionTarget,
    command: string,
    args?: unknown
  ): Promise<DapRequestOutcome> {
    if (target.connection === null) {
      return Promise.resolve({ status: 'closed', reason: 'the debug adapter is not running.' })
    }

    return target.connection.request(command, args)
  }

  function rootTarget(record: RunningDebugSession): DebugConnectionTarget {
    return { connectionId: record.rootConnectionId, connection: record.process?.connection ?? null }
  }

  function childTarget(child: ChildDebugConnection): DebugConnectionTarget {
    return { connectionId: child.connectionId, connection: child.link.connection }
  }

  /** 実行の接続。子が ready なら子、それ以外は root（Session 6-15A）。 */
  function executionTarget(record: RunningDebugSession): DebugConnectionTarget {
    const child = record.primaryChild

    return child !== null && child.phase === 'ready' ? childTarget(child) : rootTarget(record)
  }

  /** その送り先がまだ閉じていないか（root は片付けの前、子は `closed` の前）。 */
  function isLiveTarget(record: RunningDebugSession, target: DebugConnectionTarget): boolean {
    if (target.connectionId === record.rootConnectionId) {
      return !record.cleanupStarted
    }

    const child = record.primaryChild

    return child !== null && child.connectionId === target.connectionId && child.phase !== 'closed'
  }

  function isCurrent(record: RunningDebugSession): boolean {
    return current === record && current.generation === record.generation
  }

  function isCurrentStopped(record: RunningDebugSession, stopGeneration: number): boolean {
    return isActive(record) && record.state === 'stopped' && record.stopEpoch === stopGeneration
  }

  /** 同じ停止のまま、実行の接続もまだ口を作った時と同じか（Session 6-15A）。 */
  function isCurrentStoppedOn(
    record: RunningDebugSession,
    stopGeneration: number,
    target: DebugConnectionTarget
  ): boolean {
    return (
      isCurrentStopped(record, stopGeneration) &&
      executionTarget(record).connectionId === target.connectionId
    )
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
    onStopped: (listener) => {
      stoppedListeners.add(listener)

      return () => {
        stoppedListeners.delete(listener)
      }
    },
    onThread: (listener) => {
      threadListeners.add(listener)

      return () => {
        threadListeners.delete(listener)
      }
    },
    onOutput: (listener) => {
      outputListeners.add(listener)

      return () => {
        outputListeners.delete(listener)
      }
    },
    onBreakpoint: (listener) => {
      breakpointListeners.add(listener)

      return () => {
        breakpointListeners.delete(listener)
      }
    },
    start,
    stop,
    dispose,
    setConfigurationHook: (hook) => {
      configurationHook = hook
    },
    getBreakpointChannel,
    getCallStackChannel,
    getVariablesChannel,
    getEvaluateChannel,
    getExceptionInfoChannel,
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

export function getDebugSessionStopGeneration(): number {
  return defaultManager.getCallStackChannel()?.stopGeneration ?? 0
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

export function onDebugSessionStopped(listener: DebugSessionStoppedListener): () => void {
  return defaultManager.onStopped(listener)
}

export function onDebugSessionThread(listener: DebugSessionThreadListener): () => void {
  return defaultManager.onThread(listener)
}

export function onDebugSessionOutput(listener: DebugSessionOutputListener): () => void {
  return defaultManager.onOutput(listener)
}

export function onDebugSessionBreakpoint(listener: DebugSessionBreakpointListener): () => void {
  return defaultManager.onBreakpoint(listener)
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

export function getDebugSessionCallStackChannel(): DebugSessionCallStackChannel | null {
  return defaultManager.getCallStackChannel()
}

/** `scopes` / `variables` を送る口（Session 6-6）。stopped でなければ null。 */
export function getDebugSessionVariablesChannel(): DebugSessionVariablesChannel | null {
  return defaultManager.getVariablesChannel()
}

/** `evaluate` を送る口（Session 6-7）。stopped でなければ null。 */
export function getDebugSessionEvaluateChannel(): DebugSessionEvaluateChannel | null {
  return defaultManager.getEvaluateChannel()
}

/**
 * `exceptionInfo` を送る口（Session 6-13）。stopped で、adapter が
 * `supportsExceptionInfoRequest` を名乗ったときだけ返る。呼ぶのは main/debug/callStack.ts だけ。
 */
export function getDebugSessionExceptionInfoChannel(): DebugSessionExceptionInfoChannel | null {
  return defaultManager.getExceptionInfoChannel()
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

function readAllThreadsStopped(body: unknown): boolean | null {
  if (typeof body !== 'object' || body === null || !('allThreadsStopped' in body)) {
    return null
  }

  const value = (body as { readonly allThreadsStopped?: unknown }).allThreadsStopped

  return typeof value === 'boolean' ? value : null
}

function readThreadEventId(body: unknown): number | null {
  if (typeof body !== 'object' || body === null || !('threadId' in body)) {
    return null
  }

  const threadId = (body as { readonly threadId?: unknown }).threadId

  // 0 を含む（vscode-js-debug のスレッドは 0。Session 6-15B）。
  return typeof threadId === 'number' && Number.isSafeInteger(threadId) && threadId >= 0
    ? threadId
    : null
}

function readThreadEventReason(body: unknown): 'started' | 'exited' | null {
  if (typeof body !== 'object' || body === null || !('reason' in body)) {
    return null
  }

  const reason = (body as { readonly reason?: unknown }).reason

  return reason === 'started' || reason === 'exited' ? reason : null
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}

  const promise = new Promise<T>((settle) => {
    resolve = settle
  })

  return { promise, resolve }
}

/**
 * root の `output` を Debug Console へ通してよいか（Session 6-15B）。
 *
 * 子セッションの表が `rootOutputCategories` を名乗らなければ、6-15A のまま全部通す。
 * category が無い / 文字列でない output は DAP の既定どおり `console` として比べる。
 */
function isRootOutputAllowed(policy: DebugChildSessionPolicy | null, body: unknown): boolean {
  const allowed = policy?.rootOutputCategories

  if (allowed === undefined) {
    return true
  }

  const category =
    typeof body === 'object' && body !== null && 'category' in body
      ? (body as { readonly category?: unknown }).category
      : undefined

  return allowed.includes(typeof category === 'string' ? category : 'console')
}

function declineStartDebugging(message: string): DapStartDebuggingAnswer {
  return { accepted: false, message }
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
