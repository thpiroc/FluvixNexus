import type { DebugCallStackSource } from './callStack'
import type { DebugVariableHandle } from './variables'

/**
 * Debug Console の Renderer-safe domain model（Session 6-8）。
 *
 * DAP の `output` event をそのまま渡さない。Main が category / output / source を
 * 必要な範囲だけに畳み、Renderer はこの形を表示するだけになる。
 */

export type DebugConsoleEntryKind =
  'input' | 'result' | 'stdout' | 'stderr' | 'console' | 'error' | 'system'

export interface DebugConsoleSourceLocation {
  readonly source: DebugCallStackSource
  readonly line: number | null
  readonly column: number | null
}

export interface DebugConsoleEntry {
  readonly id: string
  readonly kind: DebugConsoleEntryKind
  readonly text: string
  readonly timestamp: number
  readonly source: DebugConsoleSourceLocation | null
  /** 将来 output event の variablesReference を安全に載せるための欄。v1 では常に null。 */
  readonly handle: DebugVariableHandle | null
}

export const DEBUG_CONSOLE_TEXT_MAX_LENGTH = 10_000
