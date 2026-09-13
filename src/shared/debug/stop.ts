/**
 * 「なぜ止まったか」の Renderer-safe domain model（Session 6-13）。
 *
 * DAP の `stopped` event と `exceptionInfo` 応答をそのまま渡さない。Main が閉じた集合の
 * 理由へ畳み、例外の型名とメッセージだけを**表示用の文字列**として載せる。
 *
 * ## 載せないもの
 *
 * ```
 * stopped event の body そのもの / threadId / hitBreakpointIds / preserveFocusHint
 * exceptionInfo の details.stackTrace（絶対パスを含む）/ details.source / evaluateName
 * details.fullTypeName / innerException / adapter が返した失敗の文言
 * ```
 *
 * `threadId` は Call Stack snapshot の `activeThreadId` が既に運んでいるため、ここで重ねない。
 * 型名とメッセージは Main が絶対パス・file URI を伏せてから入れる（main/debug/stopInfo.ts）。
 */

/**
 * 止まった理由（閉じた集合）。
 *
 * DAP の `reason` は `step` / `breakpoint` / `exception` / `pause` / `entry` / `goto` /
 * `function breakpoint` / `data breakpoint` / `instruction breakpoint` と**任意の文字列**を
 * 許す。Renderer が知るのはこの6語だけで、breakpoint の種類違いは `breakpoint` に、
 * それ以外の知らない理由は `unknown` に畳む。
 */
export const DEBUG_STOP_REASONS = [
  'breakpoint',
  'step',
  'pause',
  'entry',
  'exception',
  'unknown'
] as const

export type DebugStopReason = (typeof DEBUG_STOP_REASONS)[number]

/** DAP `ExceptionBreakMode`（仕様で閉じた4語）。 */
export const DEBUG_EXCEPTION_BREAK_MODES = [
  'always',
  'unhandled',
  'userUnhandled',
  'never'
] as const

export type DebugExceptionBreakMode = (typeof DEBUG_EXCEPTION_BREAK_MODES)[number]

/** 型名 / メッセージの表示の上限。巨大な文字列を IPC に載せない。 */
export const DEBUG_STOP_TEXT_MAX_LENGTH = 500

export interface DebugExceptionStop {
  /** 例外の型名（例: `ValueError`）。読めなければ null。 */
  readonly typeName: string | null
  /** 例外のメッセージ（1行に畳んだもの）。読めなければ null。 */
  readonly message: string | null
  /** adapter が止まった条件。`exceptionInfo` を読めなかった adapter では null。 */
  readonly breakMode: DebugExceptionBreakMode | null
}

export interface DebugStopInfo {
  /**
   * Main が停止ごとに発行する通し番号。
   *
   * DAP の値ではない。同じ停止の中で snapshot が読み直されても（`thread` event）変わらず、
   * 次の停止では必ず変わる ── Renderer が「新しく止まったか」を見分けるためだけに使う
   * （停止ごとに1回だけ Editor をその位置へ動かす。renderer/src/debug/executionLocation.ts）。
   */
  readonly sequence: number
  readonly reason: DebugStopReason
  /** `reason === 'exception'` のときだけ入る。 */
  readonly exception: DebugExceptionStop | null
}

export function isDebugStopReason(value: unknown): value is DebugStopReason {
  return typeof value === 'string' && (DEBUG_STOP_REASONS as readonly string[]).includes(value)
}

export function isDebugExceptionBreakMode(value: unknown): value is DebugExceptionBreakMode {
  return (
    typeof value === 'string' && (DEBUG_EXCEPTION_BREAK_MODES as readonly string[]).includes(value)
  )
}
