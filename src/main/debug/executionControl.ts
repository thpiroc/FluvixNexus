import type { DebugControlRejection, DebugExecutionControl, DebugSessionState } from '@shared/debug'

/**
 * 実行制御の判断と、DAP への翻訳（Session 6-4。純粋・テスト対象）。
 *
 * Renderer が頼めるのは app-domain の名前（`stepOver` など）だけで、それを
 * DAP の request へ翻訳するのはこのファイル1つになる。**翻訳先は閉じた表**で、
 * 表に無い command を組み立てる経路は無い（docs/ARCHITECTURE.md §20.9）。
 *
 * ```
 * continue → continue   stopped のときだけ
 * pause    → pause      running のときだけ
 * stepOver → next       stopped のときだけ
 * stepInto → stepIn     stopped のときだけ
 * stepOut  → stepOut    stopped のときだけ
 * ```
 *
 * Stop はここでは「どう終わらせるか」の計画だけを決める（`planDebugStop`）。
 * 送る・待つ・片付けるは debugSessionManager.ts の仕事になる。
 */

/** 実行制御が翻訳される先の DAP request（閉じた集合）。 */
export type DapExecutionCommand = 'continue' | 'pause' | 'next' | 'stepIn' | 'stepOut'

const DAP_COMMANDS: Readonly<Record<DebugExecutionControl, DapExecutionCommand>> = {
  continue: 'continue',
  pause: 'pause',
  stepOver: 'next',
  stepInto: 'stepIn',
  stepOut: 'stepOut'
}

/**
 * その実行制御に意味がある状態。
 *
 * - **Pause は running のときだけ。** 止まっているものを止めることはできない
 * - **Continue / Step は stopped のときだけ。** 走っているものを進めることはできない
 * - **starting では何も通さない。** `configurationDone` を送り終える前に進めると、
 *   breakpoint の仕込み（Session 6-3）を追い越してプログラムが走り出しうる
 * - **terminating では何も通さない。** 終わらせている最中のセッションを動かさない
 */
const REQUIRED_STATE: Readonly<Record<DebugExecutionControl, 'running' | 'stopped'>> = {
  continue: 'stopped',
  pause: 'running',
  stepOver: 'stopped',
  stepInto: 'stopped',
  stepOut: 'stopped'
}

export type DebugExecutionControlCheck =
  | { readonly status: 'allowed' }
  | { readonly status: 'rejected'; readonly reason: Exclude<DebugControlRejection, 'busy'> }

export function checkDebugExecutionControl(
  state: DebugSessionState,
  control: DebugExecutionControl
): DebugExecutionControlCheck {
  if (state === 'idle') {
    return { status: 'rejected', reason: 'no-session' }
  }

  return state === REQUIRED_STATE[control]
    ? { status: 'allowed' }
    : { status: 'rejected', reason: 'invalid-state' }
}

/**
 * 実行を再開させる制御か（Pause 以外の4つ）。
 *
 * これらは**応答が返った時点で running へ進める。** DAP は `continue` などの
 * 応答に対して `continued` event を送らなくてよいと定めているため、event を
 * 待つといつまでも stopped のままになる。
 */
export function isResumingDebugControl(control: DebugExecutionControl): boolean {
  return control !== 'pause'
}

export interface DapExecutionRequest {
  readonly command: DapExecutionCommand
  readonly arguments: { readonly threadId: number }
}

/**
 * DAP の request を組み立てる。
 *
 * 載せるのは `threadId` だけで、`singleThread` / `granularity` / `targetId` は送らない
 * ── どれも adapter の capability を要し、v1 の画面に選ぶ手段が無い。省けば DAP の既定
 * （全スレッドを動かす・文単位で進める）になる。
 */
export function createDapExecutionRequest(
  control: DebugExecutionControl,
  threadId: number
): DapExecutionRequest {
  return { command: DAP_COMMANDS[control], arguments: { threadId } }
}

/** `stopped` event の `threadId`（省略されうる。DAP の仕様上 optional）。 */
export function readStoppedThreadId(body: unknown): number | null {
  if (typeof body !== 'object' || body === null || !('threadId' in body)) {
    return null
  }

  const threadId = (body as { readonly threadId?: unknown }).threadId

  return isThreadId(threadId) ? threadId : null
}

/**
 * `threads` 応答の最初のスレッド。
 *
 * 止まったスレッドが分からない（`stopped` に `threadId` が無かった / まだ一度も
 * 止まっていない）ときの行き先に使う。**v1 のスレッド選択はここまで** ──
 * 利用者がスレッドを選ぶのは Call Stack（Session 6-5）の仕事になる。
 */
export function readFirstThreadId(body: unknown): number | null {
  if (typeof body !== 'object' || body === null || !('threads' in body)) {
    return null
  }

  const threads = (body as { readonly threads?: unknown }).threads

  if (!Array.isArray(threads)) {
    return null
  }

  for (const thread of threads) {
    if (typeof thread === 'object' && thread !== null && 'id' in thread) {
      const id = (thread as { readonly id?: unknown }).id

      if (isThreadId(id)) {
        return id
      }
    }
  }

  return null
}

/**
 * 終わらせ方を決めるのに要る capability（`initialize` の応答から読む）。
 *
 * `initialize` の答えが来る前は両方 false として扱う ── 名乗っていないものは
 * 使わない（§20.8 の `configurationDone` と同じ考え方）。
 */
export interface DebugAdapterStopCapabilities {
  /** `terminate` request に応じるか。 */
  readonly supportsTerminateRequest: boolean
  /** `disconnect` の `terminateDebuggee` を読むか。 */
  readonly supportTerminateDebuggee: boolean
}

export const NO_DEBUG_ADAPTER_STOP_CAPABILITIES: DebugAdapterStopCapabilities = {
  supportsTerminateRequest: false,
  supportTerminateDebuggee: false
}

export function readDebugAdapterStopCapabilities(body: unknown): DebugAdapterStopCapabilities {
  if (typeof body !== 'object' || body === null) {
    return NO_DEBUG_ADAPTER_STOP_CAPABILITIES
  }

  const capabilities = body as {
    readonly supportsTerminateRequest?: unknown
    readonly supportTerminateDebuggee?: unknown
  }

  return {
    supportsTerminateRequest: capabilities.supportsTerminateRequest === true,
    supportTerminateDebuggee: capabilities.supportTerminateDebuggee === true
  }
}

/**
 * `disconnect` の引数。
 *
 * **`terminateDebuggee` は名乗っている adapter にだけ載せる。** DAP の仕様書が
 * 「capability が true のときだけ読まれる」と定めている欄で、名乗らない adapter でも
 * launch で立てた debuggee は `disconnect` で終わらせる決まりになっている
 * ── 載せなくても、残らない。
 */
export function createDapDisconnectArguments(
  capabilities: DebugAdapterStopCapabilities
): Readonly<Record<string, boolean>> {
  return capabilities.supportTerminateDebuggee
    ? { restart: false, terminateDebuggee: true }
    : { restart: false }
}

/**
 * Stop がどこまで進んでいるか。
 *
 * ```
 * none       … まだ Stop を頼まれていない
 * terminate  … `terminate` を送り、debuggee が自分で終わるのを待っている
 * disconnect … `disconnect` を送り、adapter が答えるか閉じるのを待っている
 * ```
 */
export type DebugStopPhase = 'none' | 'terminate' | 'disconnect'

/**
 * Stop を頼まれたときに、次に何をするか。
 *
 * ```
 * no-session … セッションが無い
 * terminate  … 穏やかに終わらせる（debuggee に後片付けの機会を与える）
 * disconnect … 無条件に終わらせる（adapter が debuggee ごと終わらせる）
 * wait       … もう disconnect を送ってある。同じ終わりを待つだけ
 * ```
 *
 * DAP の仕様書（Overview の "Debug session end"）どおりの2段にしてある:
 *
 * - `terminate` を名乗る adapter には**まず `terminate`**。debuggee は拒めるので、
 *   これだけではセッションが終わるとは限らない
 * - **2回目の Stop は `disconnect`**（terminate の最中にもう一度押された）
 * - `terminate` を名乗らない adapter と、まだ `starting` のセッションは**最初から
 *   `disconnect`** ── 起動の途中では terminate の capability がまだ分からない
 *
 * **両方を同時には送らない。** terminate の答えを待たずに disconnect を投げると、
 * debuggee の後片付けを打ち切ることになり、terminate を送る意味が無くなる。
 */
export type DebugStopPlan = 'no-session' | 'terminate' | 'disconnect' | 'wait'

export function planDebugStop(
  state: DebugSessionState,
  phase: DebugStopPhase,
  capabilities: DebugAdapterStopCapabilities
): DebugStopPlan {
  if (state === 'idle') {
    return 'no-session'
  }

  switch (phase) {
    case 'disconnect':
      return 'wait'

    case 'terminate':
      return 'disconnect'

    case 'none':
      break
  }

  switch (state) {
    case 'starting':
      return 'disconnect'

    case 'running':
    case 'stopped':
      return capabilities.supportsTerminateRequest ? 'terminate' : 'disconnect'

    case 'terminating':
      /*
        Stop を頼まれずに terminating に居る ── Main 自身の片付け（Workspace の切り替え
        など）の途中にあたる。その片付けは同期で idle まで進むので実際には観測されないが、
        観測されたとしても重ねて送るものは無い。
      */
      return 'wait'
  }
}

function isThreadId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}
