import {
  DEBUG_CONSOLE_TEXT_MAX_LENGTH,
  type DebugConsoleEntry,
  type DebugConsoleEntryKind,
  type DebugConsoleSourceLocation
} from '@shared/debug'
import type { WorkspaceFolder } from '@shared/workspace'
import { IPC_EVENT_CHANNELS } from '@shared/ipc'
import { emitIpcEvent } from '../ipc/events'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import { normalizeStackFrameSource } from './stackFrameSource'
import {
  onDebugSessionOutput,
  onDebugSessionStateChange,
  type DebugSessionOutputEvent,
  type DebugSessionState
} from './debugSessionManager'

/**
 * Debug Console の Main 側（Session 6-8）。
 *
 * DAP `output` event を Renderer-safe な `DebugConsoleEntry` に畳む。raw event body、
 * raw `variablesReference`、adapter data は渡さない。出力文字列そのものは利用者の
 * プログラムの出力なので、表示用テキストとしてだけ通す。
 */

export interface DebugConsoleHost {
  readonly start: (
    onWorkspaceChange: (listener: (next: WorkspaceFolder | null) => void) => () => void
  ) => void
}

export interface DebugConsoleHostDependencies {
  readonly getWorkspace: () => WorkspaceFolder | null
  readonly onOutput: (listener: (event: DebugSessionOutputEvent) => void) => () => void
  readonly onStateChange: (
    listener: (state: DebugSessionState, sessionId: string | null, generation: number) => void
  ) => () => void
  readonly emit: (workspaceId: string, entry: DebugConsoleEntry) => void
  readonly now?: () => number
}

export function createDebugConsoleHost(
  dependencies: DebugConsoleHostDependencies
): DebugConsoleHost {
  const now = dependencies.now ?? Date.now
  let workspace: WorkspaceFolder | null = null
  let nextEntry = 0
  let previousState: DebugSessionState = 'idle'

  function start(
    onWorkspaceChange: (listener: (next: WorkspaceFolder | null) => void) => () => void
  ): void {
    workspace = dependencies.getWorkspace()

    onWorkspaceChange((next) => {
      workspace = next
    })

    dependencies.onOutput((event) => {
      ensureWorkspace()

      if (workspace === null) {
        return
      }

      const entry = normalizeDebugOutputEvent({
        body: event.body,
        rootPath: workspace.rootPath,
        id: issueId(event.generation),
        timestamp: now()
      })

      dependencies.emit(workspace.id, entry)
    })

    dependencies.onStateChange((state, _sessionId, generation) => {
      ensureWorkspace()

      if (workspace !== null && previousState !== 'idle' && state === 'idle') {
        dependencies.emit(workspace.id, {
          id: issueId(generation),
          kind: 'system',
          text: 'Debug session ended.',
          timestamp: now(),
          source: null,
          handle: null
        })
      }

      previousState = state
    })
  }

  function ensureWorkspace(): void {
    const current = dependencies.getWorkspace()

    if (current?.id !== workspace?.id) {
      workspace = current
    }
  }

  function issueId(generation: number): string {
    nextEntry += 1
    return `dc-${String(generation)}-${String(nextEntry)}`
  }

  return { start }
}

export interface NormalizeDebugOutputEventInput {
  readonly body: unknown
  readonly rootPath: string
  readonly id: string
  readonly timestamp: number
}

export function normalizeDebugOutputEvent({
  body,
  rootPath,
  id,
  timestamp
}: NormalizeDebugOutputEventInput): DebugConsoleEntry {
  const record = isRecord(body) ? body : null
  const category = typeof record?.category === 'string' ? record.category : null
  const output = typeof record?.output === 'string' ? record.output : ''

  return {
    id,
    kind: outputKind(category),
    text: sanitizeConsoleText(output),
    timestamp,
    source: normalizeOutputSource(rootPath, record),
    handle: null
  }
}

function outputKind(category: string | null): DebugConsoleEntryKind {
  switch (category) {
    case 'stdout':
      return 'stdout'
    case 'stderr':
      return 'stderr'
    case 'console':
    case 'important':
      return 'console'
    case 'telemetry':
      return 'system'
    default:
      return 'console'
  }
}

function normalizeOutputSource(
  rootPath: string,
  record: Readonly<Record<string, unknown>> | null
): DebugConsoleSourceLocation | null {
  if (record === null || !('source' in record)) {
    return null
  }

  return {
    source: normalizeStackFrameSource(rootPath, record.source),
    line: toPositiveInteger(record.line),
    column: toPositiveInteger(record.column)
  }
}

function sanitizeConsoleText(raw: string): string {
  const withoutNul = raw.replace(/\0/g, '')

  return withoutNul.length <= DEBUG_CONSOLE_TEXT_MAX_LENGTH
    ? withoutNul
    : `${withoutNul.slice(0, DEBUG_CONSOLE_TEXT_MAX_LENGTH)}...`
}

function toPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const defaultHost = createDebugConsoleHost({
  getWorkspace: getCurrentWorkspaceFolder,
  onOutput: onDebugSessionOutput,
  onStateChange: onDebugSessionStateChange,
  emit: (workspaceId, entry) => {
    emitIpcEvent(IPC_EVENT_CHANNELS.DEBUG_CONSOLE_ENTRY, { workspaceId, entry })
  }
})

export function startDebugConsoleHosting(
  onWorkspaceChange: (listener: (next: WorkspaceFolder | null) => void) => () => void
): void {
  defaultHost.start(onWorkspaceChange)
}
