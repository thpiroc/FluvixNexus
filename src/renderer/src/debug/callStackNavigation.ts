import type { DebugCallStackFrame } from '@shared/debug'

export interface CallStackFrameOpener {
  readonly openFileAt: (input: {
    readonly relativePath: string
    readonly name: string
    readonly line: number
    readonly column: number
  }) => void
}

export function openCallStackFrame(
  frame: DebugCallStackFrame,
  opener: CallStackFrameOpener
): boolean {
  if (frame.source.kind !== 'workspace' || frame.line === null) {
    return false
  }

  opener.openFileAt({
    relativePath: frame.source.relativePath,
    name: frame.source.name,
    line: frame.line,
    column: frame.column ?? 1
  })

  return true
}
