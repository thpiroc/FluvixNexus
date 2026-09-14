import { describe, expect, it, vi } from 'vitest'
import { DEBUG_CONSOLE_TEXT_MAX_LENGTH, type DebugConsoleEntry } from '@shared/debug'
import type { WorkspaceFolder } from '@shared/workspace'
import { createDebugConsoleHost, normalizeDebugOutputEvent } from './console'
import type { DebugSessionOutputEvent, DebugSessionState } from './debugSessionManager'

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] }
}))

const WORKSPACE: WorkspaceFolder = {
  id: 'workspace-1',
  rootPath: 'D:\\Workspace',
  displayName: 'Workspace',
  openedAt: 1,
  exists: true
}

const OTHER_WORKSPACE: WorkspaceFolder = {
  ...WORKSPACE,
  id: 'workspace-2',
  rootPath: 'D:\\Other'
}

describe('debug console output normalization', () => {
  it('normalizes stdout with workspace-relative source and no raw DAP fields', () => {
    const entry = normalizeDebugOutputEvent({
      body: {
        category: 'stdout',
        output: 'hello\0 world',
        source: { path: 'D:\\Workspace\\src\\app.ts', name: 'app.ts', sourceReference: 99 },
        line: 7,
        column: 2,
        variablesReference: 1234,
        data: { secret: 'adapter-detail' }
      },
      rootPath: WORKSPACE.rootPath,
      id: 'entry-1',
      timestamp: 10
    })

    expect(entry).toEqual({
      id: 'entry-1',
      kind: 'stdout',
      text: 'hello world',
      timestamp: 10,
      source: {
        source: { kind: 'workspace', relativePath: 'src/app.ts', name: 'app.ts' },
        line: 7,
        column: 2
      },
      handle: null
    })

    const serialized = JSON.stringify(entry)

    for (const forbidden of [
      'variablesReference',
      '1234',
      'sourceReference',
      'adapter-detail',
      'D:\\Workspace',
      'file://'
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it.each([
    ['stderr', 'stderr'],
    ['console', 'console'],
    ['important', 'console'],
    ['telemetry', 'system'],
    ['unknown', 'console'],
    [undefined, 'console']
  ] as const)('maps output category %s to %s', (category, kind) => {
    const entry = normalizeDebugOutputEvent({
      body: { category, output: 'line' },
      rootPath: WORKSPACE.rootPath,
      id: 'entry-1',
      timestamp: 10
    })

    expect(entry.kind).toBe(kind)
  })

  it('marks outside-workspace sources unavailable without leaking their absolute path', () => {
    const entry = normalizeDebugOutputEvent({
      body: {
        category: 'stderr',
        output: 'boom',
        source: { path: 'C:\\secret\\hidden.ts', name: 'hidden.ts' },
        line: -1,
        column: 1.5
      },
      rootPath: WORKSPACE.rootPath,
      id: 'entry-1',
      timestamp: 10
    })

    expect(entry.source).toEqual({
      source: { kind: 'unavailable', reason: 'outside-workspace', name: 'hidden.ts' },
      line: null,
      column: null
    })
    expect(JSON.stringify(entry)).not.toContain('C:\\secret')
  })

  it('handles malformed output bodies and caps long text', () => {
    expect(
      normalizeDebugOutputEvent({
        body: [],
        rootPath: WORKSPACE.rootPath,
        id: 'entry-1',
        timestamp: 10
      })
    ).toMatchObject({ kind: 'console', text: '', source: null, handle: null })

    const long = normalizeDebugOutputEvent({
      body: { output: 'x'.repeat(DEBUG_CONSOLE_TEXT_MAX_LENGTH + 10) },
      rootPath: WORKSPACE.rootPath,
      id: 'entry-2',
      timestamp: 20
    })

    expect(long.text).toHaveLength(DEBUG_CONSOLE_TEXT_MAX_LENGTH + 3)
    expect(long.text.endsWith('...')).toBe(true)
  })
})

describe('debug console host', () => {
  it('emits output for the current workspace and announces session end', () => {
    let workspace: WorkspaceFolder | null = WORKSPACE
    const outputListeners: ((event: DebugSessionOutputEvent) => void)[] = []
    const stateListeners: ((
      state: DebugSessionState,
      sessionId: string | null,
      generation: number
    ) => void)[] = []
    const workspaceListeners: ((next: WorkspaceFolder | null) => void)[] = []
    const emitted: { readonly workspaceId: string; readonly entry: DebugConsoleEntry }[] = []

    const host = createDebugConsoleHost({
      getWorkspace: () => workspace,
      onOutput: (listener) => {
        outputListeners.push(listener)
        return () => {}
      },
      onStateChange: (listener) => {
        stateListeners.push(listener)
        return () => {}
      },
      emit: (workspaceId, entry) => {
        emitted.push({ workspaceId, entry })
      },
      now: () => 500
    })

    host.start((listener) => {
      workspaceListeners.push(listener)
      return () => {}
    })

    outputListeners[0]?.({
      sessionId: 'debug-session-1',
      generation: 1,
      body: { category: 'stdout', output: 'one' }
    })
    expect(emitted.at(-1)).toMatchObject({
      workspaceId: 'workspace-1',
      entry: { kind: 'stdout', text: 'one' }
    })

    workspace = OTHER_WORKSPACE
    workspaceListeners[0]?.(OTHER_WORKSPACE)
    outputListeners[0]?.({
      sessionId: 'debug-session-2',
      generation: 2,
      body: { category: 'stderr', output: 'two' }
    })

    expect(emitted.at(-1)).toMatchObject({
      workspaceId: 'workspace-2',
      entry: { kind: 'stderr', text: 'two' }
    })

    stateListeners[0]?.('running', 'debug-session-2', 2)
    stateListeners[0]?.('idle', null, 2)

    expect(emitted.at(-1)).toMatchObject({
      workspaceId: 'workspace-2',
      entry: { kind: 'system', text: 'Debug session ended.' }
    })
  })

  it('never emits telemetry output (Session 6-15B)', () => {
    const outputListeners: ((event: DebugSessionOutputEvent) => void)[] = []
    const emitted: DebugConsoleEntry[] = []

    createDebugConsoleHost({
      getWorkspace: () => WORKSPACE,
      onOutput: (listener) => {
        outputListeners.push(listener)
        return () => {}
      },
      onStateChange: () => () => {},
      emit: (_workspaceId, entry) => {
        emitted.push(entry)
      }
    }).start(() => () => {})

    for (const body of [
      { category: 'telemetry', output: 'js-debug/dap/operation', data: { adapter: 'x' } },
      { category: 'telemetry', output: 'debugpy' }
    ]) {
      outputListeners[0]?.({ sessionId: 'debug-session-1', generation: 1, body })
    }

    outputListeners[0]?.({
      sessionId: 'debug-session-1',
      generation: 1,
      body: { category: 'stdout', output: 'program' }
    })

    expect(emitted.map((entry) => entry.text)).toEqual(['program'])
  })
})
