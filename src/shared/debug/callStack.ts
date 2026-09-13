/**
 * Call Stack の Renderer-safe domain model（Session 6-5）。
 *
 * DAP の StackFrame / Source をそのまま渡さない。特に `source.path` は絶対パスや
 * file URI になりうるため、Main が Workspace 内だけを `relativePath` に落としてから
 * この形へ入れる。`sourceReference` は公開しない。
 */

import type { DebugStopInfo } from './stop'

export type DebugCallStackSource =
  | {
      readonly kind: 'workspace'
      /** Workspace root からの相対位置。区切りは `/`。 */
      readonly relativePath: string
      /** 表示と Editor opener に使うファイル名。 */
      readonly name: string
    }
  | {
      readonly kind: 'unavailable'
      /** 絶対パスを含まない安全な表示名。 */
      readonly name: string
      readonly reason: 'missing' | 'outside-workspace' | 'malformed'
    }

export type DebugCallStackSourceUnavailableReason = Extract<
  DebugCallStackSource,
  { readonly kind: 'unavailable' }
>['reason']

export interface DebugCallStackFrame {
  /** DAP の frame id。Main は現在の停止世代のものだけを後続機能に許す。 */
  readonly id: number
  readonly name: string
  /** DAP の行・桁。読めないものは null にする。 */
  readonly line: number | null
  readonly column: number | null
  readonly source: DebugCallStackSource
}

export interface DebugCallStackThread {
  /** DAP の thread id。opaque な数値としてのみ扱う。 */
  readonly id: number
  readonly name: string
  readonly stopped: boolean
  readonly frames: readonly DebugCallStackFrame[]
}

export type DebugCallStackStatus = 'idle' | 'loading' | 'stopped'

export interface DebugCallStackSnapshot {
  readonly status: DebugCallStackStatus
  readonly activeThreadId: number | null
  readonly threads: readonly DebugCallStackThread[]
  /**
   * なぜ止まったか（Session 6-13）。`loading` / `stopped` のときに入り、`idle` では null。
   *
   * 別の通知にせず snapshot に載せてある ── 「どこで止まったか」（frames）と「なぜ止まったか」が
   * 同じ版で届き、古い停止の理由だけが残ることが無い。clear の条件も Call Stack と同じになる。
   */
  readonly stop: DebugStopInfo | null
}

export const EMPTY_DEBUG_CALL_STACK: DebugCallStackSnapshot = {
  status: 'idle',
  activeThreadId: null,
  threads: [],
  stop: null
}
