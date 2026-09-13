import { describe, expect, it, vi } from 'vitest'
import {
  isDebugVariableHandleShape,
  type DebugScopesResult,
  type DebugVariablesResult
} from '@shared/debug'
import type { WorkspaceFolder } from '@shared/workspace'
import type { DebugCallStackFrameHandle } from './callStack'
import type { DapRequestOutcome } from './dapConnection'
import type {
  DebugSessionState,
  DebugSessionStoppedListener,
  DebugSessionVariablesChannel
} from './debugSessionManager'
import { createDebugVariablesStore } from './variables'

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] }
}))

const WORKSPACE: WorkspaceFolder = {
  id: 'workspace-1',
  rootPath: 'D:\\proj',
  displayName: 'proj',
  openedAt: 1,
  exists: true
}

const OTHER_WORKSPACE: WorkspaceFolder = { ...WORKSPACE, id: 'workspace-2', rootPath: 'D:\\other' }

function success(body: unknown): DapRequestOutcome {
  return { status: 'success', body }
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })

  return { promise, resolve }
}

const SCOPES = success({
  scopes: [
    { name: 'Locals', presentationHint: 'locals', variablesReference: 1000, expensive: false },
    { name: 'Globals', variablesReference: 1001, expensive: true },
    { name: 'Empty', variablesReference: 0, expensive: false }
  ]
})

const LOCALS = success({
  variables: [
    { name: 'count', value: '3', type: 'number', variablesReference: 0 },
    { name: 'user', value: '{…}', type: 'User', variablesReference: 2001, namedVariables: 2 }
  ]
})

const USER = success({
  variables: [
    { name: 'name', value: '"Ada"', type: 'string', variablesReference: 0 },
    { name: 'address', value: '{…}', variablesReference: 3001 }
  ]
})

interface HarnessOptions {
  readonly maxHandles?: number
  readonly maxPerResponse?: number
  readonly paging?: boolean
  readonly scopes?: (args: unknown) => Promise<DapRequestOutcome>
  readonly variables?: (args: { readonly variablesReference: number }) => Promise<DapRequestOutcome>
}

function createHarness(options: HarnessOptions = {}) {
  let workspace: WorkspaceFolder | null = WORKSPACE
  let state: DebugSessionState = 'stopped'
  let generation = 1
  let stopGeneration = 1
  const frames = new Set<number>([11, 12])
  const workspaceListeners: ((next: WorkspaceFolder | null) => void)[] = []
  const stateListeners: ((state: DebugSessionState) => void)[] = []
  const stoppedListeners: DebugSessionStoppedListener[] = []
  const callStackListeners: (() => void)[] = []
  const logs: string[] = []

  const requestScopes = vi.fn(options.scopes ?? (async () => SCOPES))
  const requestVariables = vi.fn(
    options.variables ??
      (async (args: { readonly variablesReference: number }) => {
        switch (args.variablesReference) {
          case 1000:
            return LOCALS
          case 2001:
            return USER
          default:
            return success({ variables: [] })
        }
      })
  )

  function channel(): DebugSessionVariablesChannel | null {
    return state === 'stopped'
      ? {
          sessionId: `debug-session-${String(generation)}`,
          generation,
          stopGeneration,
          supportsVariablePaging: options.paging ?? false,
          requestScopes,
          requestVariables
        }
      : null
  }

  const store = createDebugVariablesStore({
    getWorkspace: () => workspace,
    getDebugState: () => state,
    getDebugGeneration: () => generation,
    getDebugStopGeneration: () => (state === 'stopped' ? stopGeneration : 0),
    getFrameHandle: (rawFrameId): DebugCallStackFrameHandle | null =>
      typeof rawFrameId === 'number' &&
      frames.has(rawFrameId) &&
      state === 'stopped' &&
      workspace !== null
        ? {
            workspaceId: workspace.id,
            sessionGeneration: generation,
            stopGeneration,
            threadId: 1,
            frameId: rawFrameId
          }
        : null,
    getChannel: channel,
    onDebugStateChange: (listener) => {
      stateListeners.push(listener)
      return () => {}
    },
    onDebugStopped: (listener) => {
      stoppedListeners.push(listener)
      return () => {}
    },
    onCallStackChange: (listener) => {
      callStackListeners.push(listener)
      return () => {}
    },
    log: (level, message) => {
      logs.push(`${level}: ${message}`)
    },
    maxHandles: options.maxHandles,
    maxPerResponse: options.maxPerResponse
  })

  store.start((listener) => {
    workspaceListeners.push(listener)
    return () => {}
  })

  return {
    store,
    logs,
    frames,
    requestScopes,
    requestVariables,
    setState: (next: DebugSessionState) => {
      state = next
      for (const listener of stateListeners) {
        listener(next)
      }
    },
    newStop: () => {
      stopGeneration += 1
      state = 'stopped'
      for (const listener of stoppedListeners) {
        listener({
          sessionId: `debug-session-${String(generation)}`,
          generation,
          stopGeneration,
          stoppedThreadId: 1,
          allThreadsStopped: true,
          stop: { reason: 'breakpoint', description: null, text: null }
        })
      }
    },
    replaceSession: () => {
      generation += 1
      stopGeneration = 1
    },
    callStackChanged: () => {
      for (const listener of callStackListeners) {
        listener()
      }
    },
    setWorkspace: (next: WorkspaceFolder | null) => {
      workspace = next
      for (const listener of workspaceListeners) {
        listener(next)
      }
    },
    switchWorkspaceSilently: (next: WorkspaceFolder | null) => {
      workspace = next
    }
  }
}

function okScopes(result: DebugScopesResult) {
  if (result.status !== 'ok') {
    throw new Error(`expected scopes, got ${result.reason}`)
  }

  return result.scopes
}

function okVariables(result: DebugVariablesResult) {
  if (result.status !== 'ok') {
    throw new Error(`expected variables, got ${result.reason}`)
  }

  return result
}

async function loadLocals(harness: ReturnType<typeof createHarness>) {
  const scopes = okScopes(await harness.store.listScopes(11))
  const locals = scopes[0]?.handle

  if (locals === null || locals === undefined) {
    throw new Error('locals has no handle')
  }

  return { scopes, locals, variables: okVariables(await harness.store.listVariables(locals)) }
}

describe('debug variables store — scopes and variables', () => {
  it('lists scopes for a current frame and replaces variablesReference with Main handles', async () => {
    const harness = createHarness()
    const scopes = okScopes(await harness.store.listScopes(11))

    expect(harness.requestScopes).toHaveBeenCalledWith({ frameId: 11 })
    expect(scopes).toEqual([
      {
        handle: expect.stringMatching(/^dv-\d+$/) as unknown,
        name: 'Locals',
        kind: 'locals',
        expensive: false,
        namedCount: null,
        indexedCount: null
      },
      {
        handle: expect.stringMatching(/^dv-\d+$/) as unknown,
        name: 'Globals',
        kind: 'other',
        expensive: true,
        namedCount: null,
        indexedCount: null
      },
      {
        handle: null,
        name: 'Empty',
        kind: 'other',
        expensive: false,
        namedCount: null,
        indexedCount: null
      }
    ])

    const serialized = JSON.stringify(scopes)
    expect(serialized).not.toContain('1000')
    expect(serialized).not.toContain('1001')
    expect(serialized).not.toContain('variablesReference')
    expect(harness.store.handleCount()).toBe(2)
  })

  it('lists variables through a handle and issues new handles for nested children', async () => {
    const harness = createHarness()
    const { locals, variables } = await loadLocals(harness)

    expect(harness.requestVariables).toHaveBeenCalledWith({ variablesReference: 1000 })
    expect(variables.truncated).toBe(false)
    expect(
      variables.variables.map((variable) => [variable.name, variable.handle !== null])
    ).toEqual([
      ['count', false],
      ['user', true]
    ])

    const user = variables.variables[1]?.handle
    expect(user).not.toBe(locals)

    const nested = okVariables(await harness.store.listVariables(user))

    expect(harness.requestVariables).toHaveBeenLastCalledWith({ variablesReference: 2001 })
    expect(nested.variables.map((variable) => variable.name)).toEqual(['name', 'address'])
    expect(nested.variables[1]?.handle).toMatch(/^dv-\d+$/)
    expect(JSON.stringify(nested)).not.toContain('3001')
  })

  it('treats variablesReference = 0 as a leaf and never requests it', async () => {
    const harness = createHarness()
    const { variables } = await loadLocals(harness)

    expect(variables.variables[0]).toMatchObject({ name: 'count', handle: null })
    expect(harness.requestVariables).toHaveBeenCalledTimes(1)
  })

  it('sends start / count only to adapters that support variable paging', async () => {
    const paging = createHarness({ paging: true, maxPerResponse: 10 })
    await loadLocals(paging)

    expect(paging.requestVariables).toHaveBeenCalledWith({
      variablesReference: 1000,
      start: 0,
      count: 11
    })

    const plain = createHarness({ maxPerResponse: 10 })
    await loadLocals(plain)

    expect(plain.requestVariables).toHaveBeenCalledWith({ variablesReference: 1000 })
  })

  it('caps a large variables response and reports truncation', async () => {
    const harness = createHarness({
      maxPerResponse: 50,
      variables: async () =>
        success({
          variables: Array.from({ length: 10_000 }, (_, index) => ({
            name: `item${String(index)}`,
            value: String(index),
            variablesReference: index + 5000
          }))
        })
    })
    const { variables } = await loadLocals(harness)

    expect(variables.variables).toHaveLength(50)
    expect(variables.truncated).toBe(true)
    // 2 scope handles + 50 child handles
    expect(harness.store.handleCount()).toBe(52)
  })

  it('reports failed for adapter failures and malformed responses without leaking adapter text', async () => {
    const rejected = createHarness({
      scopes: async () => ({
        status: 'failure',
        message: 'cannot read D:\\secret\\frame',
        body: undefined
      })
    })

    expect(await rejected.store.listScopes(11)).toEqual({ status: 'unavailable', reason: 'failed' })
    expect(rejected.logs.join('\n')).toContain('scopes request failed')

    const malformedScopes = createHarness({ scopes: async () => success({ scopes: 'nope' }) })
    expect(await malformedScopes.store.listScopes(11)).toEqual({
      status: 'unavailable',
      reason: 'failed'
    })
    expect(malformedScopes.logs).toContain('warn: ignored a malformed scopes response.')

    const malformedVariables = createHarness({
      variables: async () => success({ variables: 42 })
    })
    const scopes = okScopes(await malformedVariables.store.listScopes(11))
    const result = await malformedVariables.store.listVariables(scopes[0]?.handle)

    expect(result).toEqual({ status: 'unavailable', reason: 'failed' })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(malformedVariables.logs).toContain('warn: ignored a malformed variables response.')
  })
})

describe('debug variables store — handles', () => {
  it('rejects unknown handles and raw variablesReference numbers', async () => {
    const harness = createHarness()
    await loadLocals(harness)

    for (const raw of [1000, 2001, '1000', 'dv-999999', '', null, undefined, { handle: 'dv-1' }]) {
      expect(await harness.store.listVariables(raw)).toEqual({
        status: 'unavailable',
        reason: 'stale'
      })
    }

    expect(harness.requestVariables).toHaveBeenCalledTimes(1)
    expect(isDebugVariableHandleShape(1000)).toBe(false)
    expect(isDebugVariableHandleShape('x'.repeat(65))).toBe(false)
    expect(isDebugVariableHandleShape('dv-1')).toBe(true)
  })

  it('rejects scopes for unknown / stale frames without contacting the adapter', async () => {
    const harness = createHarness()

    for (const raw of [99, -1, 0, 1.5, '11', null]) {
      expect(await harness.store.listScopes(raw)).toEqual({
        status: 'unavailable',
        reason: 'stale'
      })
    }

    harness.frames.delete(11)
    expect(await harness.store.listScopes(11)).toEqual({ status: 'unavailable', reason: 'stale' })
    expect(harness.requestScopes).not.toHaveBeenCalled()
  })

  it('invalidates every handle on a new stop, even when the adapter reuses numbers', async () => {
    const harness = createHarness()
    const { locals, variables } = await loadLocals(harness)
    const user = variables.variables[1]?.handle

    harness.newStop()

    expect(harness.store.handleCount()).toBe(0)
    expect(await harness.store.listVariables(locals)).toEqual({
      status: 'unavailable',
      reason: 'stale'
    })
    expect(await harness.store.listVariables(user)).toEqual({
      status: 'unavailable',
      reason: 'stale'
    })
    expect(harness.requestVariables).toHaveBeenCalledTimes(1)

    const next = await loadLocals(harness)
    expect(next.locals).not.toBe(locals)
  })

  it('rejects handles from a previous session generation', async () => {
    const harness = createHarness()
    const { locals } = await loadLocals(harness)

    harness.setState('idle')
    harness.replaceSession()
    harness.setState('stopped')

    expect(await harness.store.listVariables(locals)).toEqual({
      status: 'unavailable',
      reason: 'stale'
    })
  })

  it('rejects handles from another workspace, even when the switch was not announced yet', async () => {
    const harness = createHarness()
    const { locals } = await loadLocals(harness)

    harness.switchWorkspaceSilently(OTHER_WORKSPACE)

    expect(await harness.store.listVariables(locals)).toEqual({
      status: 'unavailable',
      reason: 'stale'
    })
    expect(harness.store.handleCount()).toBe(0)
  })

  it('invalidates handles when the call stack snapshot changes', async () => {
    const harness = createHarness()
    const { locals } = await loadLocals(harness)

    harness.callStackChanged()

    expect(await harness.store.listVariables(locals)).toEqual({
      status: 'unavailable',
      reason: 'stale'
    })
  })

  it('stops issuing handles at the per-stop limit', async () => {
    const harness = createHarness({
      maxHandles: 4,
      variables: async () =>
        success({
          variables: Array.from({ length: 5 }, (_, index) => ({
            name: `child${String(index)}`,
            value: '{…}',
            variablesReference: 4000 + index
          }))
        })
    })
    const { variables } = await loadLocals(harness)

    // 2 scopes + 2 children fill the table; the rest are shown as leaves
    expect(variables.variables.map((variable) => variable.handle !== null)).toEqual([
      true,
      true,
      false,
      false,
      false
    ])
    expect(variables.truncated).toBe(true)
    expect(harness.store.handleCount()).toBe(4)

    const child = variables.variables[0]?.handle
    expect(await harness.store.listVariables(child)).toEqual({
      status: 'unavailable',
      reason: 'limit'
    })
    expect(harness.requestVariables).toHaveBeenCalledTimes(1)
    expect(harness.logs.some((line) => line.includes('handle limit'))).toBe(true)
  })
})

describe('debug variables store — lifecycle', () => {
  it('allows requests only while stopped', async () => {
    const harness = createHarness()

    for (const state of ['idle', 'starting', 'running', 'terminating'] as const) {
      harness.setState(state)
      expect(await harness.store.listScopes(11)).toEqual({
        status: 'unavailable',
        reason: 'not-stopped'
      })
      expect(await harness.store.listVariables('dv-1')).toEqual({
        status: 'unavailable',
        reason: 'not-stopped'
      })
    }

    expect(harness.requestScopes).not.toHaveBeenCalled()
    expect(harness.requestVariables).not.toHaveBeenCalled()
  })

  it.each([
    ['continue / step (running)', 'running'],
    ['stop / adapter error / adapter close (terminating)', 'terminating'],
    ['terminated / exited / app cleanup (idle)', 'idle']
  ] as const)('clears handles on %s', async (_label, state) => {
    const harness = createHarness()
    const { locals } = await loadLocals(harness)

    harness.setState(state)
    expect(harness.store.handleCount()).toBe(0)

    harness.setState('stopped')
    expect(await harness.store.listVariables(locals)).toEqual({
      status: 'unavailable',
      reason: 'stale'
    })
  })

  it('clears handles on workspace switch', async () => {
    const harness = createHarness()
    const { locals } = await loadLocals(harness)

    harness.setWorkspace(OTHER_WORKSPACE)
    expect(harness.store.handleCount()).toBe(0)

    harness.setWorkspace(WORKSPACE)
    expect(await harness.store.listVariables(locals)).toEqual({
      status: 'unavailable',
      reason: 'stale'
    })

    harness.setWorkspace(null)
    expect(await harness.store.listScopes(11)).toEqual({
      status: 'unavailable',
      reason: 'not-stopped'
    })
  })

  it('drops a scopes response that arrives after the program resumed', async () => {
    const waiting = deferred<DapRequestOutcome>()
    const harness = createHarness({ scopes: () => waiting.promise })
    const pending = harness.store.listScopes(11)

    harness.setState('running')
    waiting.resolve(SCOPES)

    expect(await pending).toEqual({ status: 'unavailable', reason: 'stale' })
    expect(harness.store.handleCount()).toBe(0)
  })

  it('drops a variables response that arrives after a new stop', async () => {
    const waiting = deferred<DapRequestOutcome>()
    const harness = createHarness({
      variables: (args) =>
        args.variablesReference === 1000 ? waiting.promise : Promise.resolve(USER)
    })
    const scopes = okScopes(await harness.store.listScopes(11))
    const pending = harness.store.listVariables(scopes[0]?.handle)

    harness.newStop()
    waiting.resolve(LOCALS)

    expect(await pending).toEqual({ status: 'unavailable', reason: 'stale' })
    expect(harness.store.handleCount()).toBe(0)
  })

  it('drops a response that arrives after a workspace switch', async () => {
    const waiting = deferred<DapRequestOutcome>()
    const harness = createHarness({ scopes: () => waiting.promise })
    const pending = harness.store.listScopes(11)

    harness.setWorkspace(OTHER_WORKSPACE)
    waiting.resolve(SCOPES)

    expect(await pending).toEqual({ status: 'unavailable', reason: 'stale' })
  })

  it('treats a closed channel (session moved on) as stale', async () => {
    const harness = createHarness({
      scopes: async () => ({
        status: 'closed',
        reason: 'the stopped debug session has already moved on.'
      })
    })

    expect(await harness.store.listScopes(11)).toEqual({ status: 'unavailable', reason: 'stale' })
  })
})

/**
 * evaluate（Session 6-7）が同じ表へ載せる口。
 *
 * **呼び出し側の確認を信じない**ことをここで固定する ── 表に載せてよいかを決めるのは
 * 表の持ち主で、素性が今と食い違えば handle は発行されない。
 */
describe('debug variables handle table — the evaluate entry point (Session 6-7)', () => {
  function scopeOf(harness: ReturnType<typeof createHarness>) {
    return {
      workspaceId: WORKSPACE.id,
      sessionGeneration: 1,
      stopGeneration: 1,
      epoch: harness.store.currentEpoch()
    }
  }

  it('issues a handle from the same table and the same numbering', async () => {
    const harness = createHarness()
    const scopes = okScopes(await harness.store.listScopes(11))
    const handle = harness.store.registerEvaluateResult(scopeOf(harness), 4001)

    expect(handle).not.toBeNull()
    expect(handle).not.toBe(scopes[0]?.handle)
    expect(harness.store.handleCount()).toBe(3)
  })

  it('is readable through listVariables, like any other handle', async () => {
    const harness = createHarness()
    harness.store.currentEpoch()
    const handle = harness.store.registerEvaluateResult(scopeOf(harness), 1000)

    expect(handle).not.toBeNull()
    expect(await harness.store.listVariables(handle)).toMatchObject({ status: 'ok' })
    expect(harness.requestVariables).toHaveBeenCalledWith({ variablesReference: 1000 })
  })

  it('issues nothing for a non-expandable reference', () => {
    const harness = createHarness()

    expect(harness.store.registerEvaluateResult(scopeOf(harness), 0)).toBeNull()
    expect(harness.store.registerEvaluateResult(scopeOf(harness), -1)).toBeNull()
    expect(harness.store.handleCount()).toBe(0)
  })

  it.each([
    ['a stale epoch', { epoch: -1 }],
    ['another workspace', { workspaceId: OTHER_WORKSPACE.id }],
    ['another session', { sessionGeneration: 2 }],
    ['another stop', { stopGeneration: 2 }]
  ])('issues nothing for %s', (_name, override) => {
    const harness = createHarness()

    expect(
      harness.store.registerEvaluateResult({ ...scopeOf(harness), ...override }, 4001)
    ).toBeNull()
    expect(harness.store.handleCount()).toBe(0)
  })

  it('issues nothing once the program is no longer stopped', () => {
    const harness = createHarness()
    const scope = scopeOf(harness)
    harness.setState('running')

    expect(harness.store.registerEvaluateResult(scope, 4001)).toBeNull()
    expect(harness.store.handleCount()).toBe(0)
  })

  /**
   * 停止は変わらないが表だけを捨てた（Call Stack の読み直し）。**epoch だけ**で
   * 断れることを見る ── 世代も Workspace も動いていない。
   */
  it('advances the epoch when the table is dropped within the same stop', () => {
    const harness = createHarness()
    const before = harness.store.currentEpoch()

    harness.callStackChanged()

    const after = scopeOf(harness)

    expect(after.epoch).not.toBe(before)
    expect(after.stopGeneration).toBe(1)
    expect(harness.store.registerEvaluateResult({ ...after, epoch: before }, 4001)).toBeNull()
    expect(harness.store.registerEvaluateResult(after, 4001)).not.toBeNull()
  })

  it('respects the per-stop handle limit', async () => {
    const harness = createHarness({ maxHandles: 2 })
    await harness.store.listScopes(11)

    expect(harness.store.handleCount()).toBe(2)
    expect(harness.store.registerEvaluateResult(scopeOf(harness), 4001)).toBeNull()
  })
})
