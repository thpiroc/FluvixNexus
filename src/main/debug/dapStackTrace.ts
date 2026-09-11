import type { DebugCallStackFrame } from '@shared/debug'
import { isDapHandle, sanitizeLabel } from './dapThreads'
import { normalizeStackFrameSource } from './stackFrameSource'

/**
 * DAP `stackTrace` request / response（Session 6-5）。
 *
 * DAP の StackFrame は Main 内で safe domain model へ変換する。`Source.path` や
 * `sourceReference` は外へ出さない。
 */

export const DAP_STACK_TRACE_LEVELS = 50

export interface DapStackTraceArguments {
  readonly threadId: number
  readonly startFrame: 0
  readonly levels: number
}

export function createStackTraceArguments(threadId: number): DapStackTraceArguments {
  return { threadId, startFrame: 0, levels: DAP_STACK_TRACE_LEVELS }
}

export function parseStackTraceResponse(
  rootPath: string,
  body: unknown
): readonly DebugCallStackFrame[] | null {
  if (typeof body !== 'object' || body === null || !('stackFrames' in body)) {
    return null
  }

  const rawFrames = (body as { readonly stackFrames?: unknown }).stackFrames

  if (!Array.isArray(rawFrames)) {
    return null
  }

  return rawFrames.flatMap((frame) => {
    const parsed = parseStackFrame(rootPath, frame)

    return parsed === null ? [] : [parsed]
  })
}

function parseStackFrame(rootPath: string, value: unknown): DebugCallStackFrame | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  const record = value as {
    readonly id?: unknown
    readonly name?: unknown
    readonly line?: unknown
    readonly column?: unknown
    readonly source?: unknown
  }

  if (!isDapHandle(record.id)) {
    return null
  }

  return {
    id: record.id,
    name: sanitizeLabel(record.name, '(anonymous)'),
    line: toPositiveInteger(record.line),
    column: toPositiveInteger(record.column),
    source: normalizeStackFrameSource(rootPath, record.source)
  }
}

function toPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}
