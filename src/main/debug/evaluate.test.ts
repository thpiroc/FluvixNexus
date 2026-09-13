import { describe, expect, it, vi } from 'vitest'
import type { DebugEvaluateResult, DebugVariableHandle } from '@shared/debug'
import type { WorkspaceFolder } from '@shared/workspace'
import type { DebugCallStackFrameHandle } from './callStack'
import type { DapRequestOutcome } from './dapConnection'
import type { DebugSessionEvaluateChannel, DebugSessionState } from './debugSessionManager'
import { createDebugEvaluateStore } from './evaluate'
import { createDebugVariablesStore, type DebugVariablesStore } from './variables'

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

const LEAF = success({ result: '3', type: 'number', variablesReference: 0 })
const OBJECT = success({
  result: '{ name: "Ada" }',
  type: 'User',
  variablesReference: 4001,
  namedVariables: 1
})

interface HarnessOptions {
  readonly evaluate?: (args: unknown) => Promise<DapRequestOutcome>
  readonly timeoutMs?: number
  readonly maxHandles?: number
}

/**
 * Evaluate の store と、Session 6-6 の **本物の handle 表**を繋いだ器。
 *
 * 表を偽物にしない ── 6-7 の要点は「6-6 と同じ表へ載る」ことで、そこを偽装すると
 * 確かめたいものが確かめられない。
 */
function createHarness(options: HarnessOptions = {}) {
  let workspace: WorkspaceFolder | null = WORKSPACE
  let state: DebugSessionState = 'stopped'
  let generation = 1
  let stopGeneration = 1
  const frames = new Set<number>([11, 12])
  const workspaceListeners: ((next: WorkspaceFolder | null) => void)[] = []
  const stateListeners: ((state: DebugSessionState) => void)[] = []
  const stoppedListeners: (() => void)[] = []
  const callStackListeners: (() => void)[] = []
  const logs: string[] = []

  const requestEvaluate = vi.fn(options.evaluate ?? (async () => LEAF))
  const requestVariables = vi.fn(async (args: { readonly variablesReference: number }) =>
    args.variablesReference === 4001
      ? success({ variables: [{ name: 'name', value: '"Ada"', variablesReference: 0 }] })
      : success({ variables: [] })
  )
  const requestScopes = vi.fn(async () =>
    success({ scopes: [{ name: 'Locals', variablesReference: 1000, expensive: false }] })
  )

  const getWorkspace = (): WorkspaceFolder | null => workspace
  const getDebugState = (): DebugSessionState => state
  const getDebugGeneration = (): number => generation
  const getDebugStopGeneration = (): number => (state === 'stopped' ? stopGeneration : 0)
  const getFrameHandle = (rawFrameId: unknown): DebugCallStackFrameHandle | null =>
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
      : null

  const variables: DebugVariablesStore = createDebugVariablesStore({
    getWorkspace,
    getDebugState,
    getDebugGeneration,
    getDebugStopGeneration,
    getFrameHandle,
    getChannel: () =>
      state === 'stopped'
        ? {
            sessionId: `debug-session-${String(generation)}`,
            generation,
            stopGeneration,
            supportsVariablePaging: false,
            requestScopes,
            requestVariables
          }
        : null,
    onDebugStateChange: (listener) => {
      stateListeners.push(listener)
      return () => {}
    },
    onDebugStopped: (listener) => {
      stoppedListeners.push(() => {
        listener({
          sessionId: `debug-session-${String(generation)}`,
          generation,
          stopGeneration,
          stoppedThreadId: 1,
          allThreadsStopped: true,
          stop: { reason: 'breakpoint', description: null, text: null }
        })
      })
      return () => {}
    },
    onCallStackChange: (listener) => {
      callStackListeners.push(listener)
      return () => {}
    },
    log: (level, message) => {
      logs.push(`${level}: ${message}`)
    },
    maxHandles: options.maxHandles
  })

  variables.start((listener) => {
    workspaceListeners.push(listener)
    return () => {}
  })

  const store = createDebugEvaluateStore({
    getWorkspace,
    getDebugState,
    getDebugGeneration,
    getDebugStopGeneration,
    getFrameHandle,
    getChannel: (): DebugSessionEvaluateChannel | null =>
      state === 'stopped'
        ? {
            sessionId: `debug-session-${String(generation)}`,
            generation,
            stopGeneration,
            requestEvaluate
          }
        : null,
    getHandleEpoch: variables.currentEpoch,
    registerHandle: variables.registerEvaluateResult,
    log: (level, message) => {
      logs.push(`${level}: ${message}`)
    },
    timeoutMs: options.timeoutMs ?? 50
  })

  return {
    store,
    variables,
    logs,
    requestEvaluate,
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
        listener()
      }
    },
    replaceSession: () => {
      generation += 1
      stopGeneration = 1
      state = 'stopped'
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

function ok(result: DebugEvaluateResult) {
  if (result.status !== 'ok') {
    throw new Error(`expected a value, got ${result.reason}`)
  }

  return result.value
}

function reason(result: DebugEvaluateResult): string {
  return result.status === 'unavailable' ? result.reason : 'ok'
}

function handleOf(result: DebugEvaluateResult): DebugVariableHandle {
  const handle = ok(result).handle

  if (handle === null) {
    throw new Error('expected a handle')
  }

  return handle
}

describe('debug evaluate — the normal path', () => {
  it('sends the expression with the main-checked frame id and the app-domain context', async () => {
    const harness = createHarness()

    const result = await harness.store.evaluate('count', 11, 'repl')

    expect(ok(result)).toEqual({
      handle: null,
      value: '3',
      type: 'number',
      kind: 'other',
      namedCount: null,
      indexedCount: null
    })
    expect(harness.requestEvaluate).toHaveBeenCalledWith({
      expression: 'count',
      frameId: 11,
      context: 'repl'
    })
  })

  it('evaluates in the frame the caller named', async () => {
    const harness = createHarness()

    await harness.store.evaluate('count', 12, 'watch')

    expect(harness.requestEvaluate).toHaveBeenCalledWith({
      expression: 'count',
      frameId: 12,
      context: 'watch'
    })
  })

  it('shows the value as a string, without the raw variablesReference', async () => {
    const harness = createHarness({ evaluate: async () => OBJECT })

    const value = ok(await harness.store.evaluate('user', 11, 'repl'))

    expect(value.value).toBe('{ name: "Ada" }')
    expect(value.type).toBe('User')
    expect(value.namedCount).toBe(1)
    expect(JSON.stringify(value)).not.toContain('4001')
    expect(Object.keys(value).sort()).toEqual([
      'handle',
      'indexedCount',
      'kind',
      'namedCount',
      'type',
      'value'
    ])
  })
})

describe('debug evaluate — the handle table (Session 6-6 reuse)', () => {
  it('registers the result reference in the same main-owned table', async () => {
    const harness = createHarness({ evaluate: async () => OBJECT })

    expect(harness.variables.handleCount()).toBe(0)

    const handle = handleOf(await harness.store.evaluate('user', 11, 'repl'))

    expect(typeof handle).toBe('string')
    expect(handle).not.toContain('4001')
    expect(harness.variables.handleCount()).toBe(1)
  })

  it('expands the result through the Session 6-6 listVariables path', async () => {
    const harness = createHarness({ evaluate: async () => OBJECT })
    const handle = handleOf(await harness.store.evaluate('user', 11, 'repl'))

    const children = await harness.variables.listVariables(handle)

    expect(children.status).toBe('ok')
    expect(children.status === 'ok' ? children.variables[0]?.name : null).toBe('name')
    /* Main が表から戻した番号で読んでいること。 */
    expect(harness.requestVariables).toHaveBeenCalledWith({ variablesReference: 4001 })
  })

  it('does not share handle numbers with the scopes path', async () => {
    const harness = createHarness({ evaluate: async () => OBJECT })
    const scopes = await harness.variables.listScopes(11)
    const scopeHandle = scopes.status === 'ok' ? scopes.scopes[0]?.handle : null
    const evaluateHandle = handleOf(await harness.store.evaluate('user', 11, 'repl'))

    expect(scopeHandle).not.toBeNull()
    expect(evaluateHandle).not.toBe(scopeHandle)
    expect(harness.variables.handleCount()).toBe(2)
  })

  /** 展開できない値には handle を付けない（表を無駄に育てない）。 */
  it('issues no handle for a leaf result', async () => {
    const harness = createHarness()

    expect(ok(await harness.store.evaluate('count', 11, 'repl')).handle).toBeNull()
    expect(harness.variables.handleCount()).toBe(0)
  })

  /** 表が一杯でも評価そのものは返す ── 値は葉として見せる。 */
  it('still answers when the handle table is full, as a leaf', async () => {
    const harness = createHarness({ evaluate: async () => OBJECT, maxHandles: 1 })
    await harness.variables.listScopes(11)

    expect(harness.variables.handleCount()).toBe(1)

    const value = ok(await harness.store.evaluate('user', 11, 'repl'))

    expect(value.value).toBe('{ name: "Ada" }')
    expect(value.handle).toBeNull()
    expect(harness.logs.some((line) => line.includes('could not be given a handle'))).toBe(true)
  })
})

describe('debug evaluate — refusing before anything is sent', () => {
  it.each(['idle', 'starting', 'running', 'terminating'] as const)(
    'refuses while %s without sending anything',
    async (state) => {
      const harness = createHarness()
      harness.setState(state)

      expect(reason(await harness.store.evaluate('count', 11, 'repl'))).toBe('not-stopped')
      expect(harness.requestEvaluate).not.toHaveBeenCalled()
    }
  )

  it('refuses when no workspace is open', async () => {
    const harness = createHarness()
    harness.setWorkspace(null)

    expect(reason(await harness.store.evaluate('count', 11, 'repl'))).toBe('not-stopped')
    expect(harness.requestEvaluate).not.toHaveBeenCalled()
  })

  it('refuses a frame that is not in the current call stack', async () => {
    const harness = createHarness()

    expect(reason(await harness.store.evaluate('count', 99, 'repl'))).toBe('stale')
    expect(harness.requestEvaluate).not.toHaveBeenCalled()
  })

  it.each([0, -1, 1.5, '11', null, undefined, {}])(
    'refuses the malformed frame id %j',
    async (frameId) => {
      const harness = createHarness()

      expect(reason(await harness.store.evaluate('count', frameId, 'repl'))).toBe('stale')
      expect(harness.requestEvaluate).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['a non-string expression', 42, 'repl'],
    ['a blank expression', '   ', 'repl'],
    ['an over-long expression', 'a'.repeat(2001), 'repl'],
    ['an expression with NUL', 'a\0b', 'repl'],
    ['an unknown context', 'count', 'hover'],
    ['a DAP command as the context', 'count', 'setVariable'],
    ['a missing context', 'count', undefined]
  ])('refuses %s without sending anything', async (_name, expression, context) => {
    const harness = createHarness()

    expect(reason(await harness.store.evaluate(expression, 11, context))).toBe('failed')
    expect(harness.requestEvaluate).not.toHaveBeenCalled()
  })

  /**
   * frame が Workspace 外を指していても、frame そのものは今の停止のもの
   * （Session 6-6 と同じ ── source が開けないことと、評価できないことは別）。
   */
  it('evaluates in a frame whose source is outside the workspace', async () => {
    const harness = createHarness()

    expect(reason(await harness.store.evaluate('count', 12, 'repl'))).toBe('ok')
  })
})

describe('debug evaluate — the answer arriving late', () => {
  async function pending(harness: ReturnType<typeof createHarness>) {
    const waiting = deferred<DapRequestOutcome>()
    harness.requestEvaluate.mockImplementationOnce(() => waiting.promise)

    return { waiting, result: harness.store.evaluate('user', 11, 'repl') }
  }

  it('discards an answer that arrives after Continue', async () => {
    const harness = createHarness()
    const { waiting, result } = await pending(harness)

    harness.setState('running')
    waiting.resolve(OBJECT)

    expect(reason(await result)).toBe('stale')
    expect(harness.variables.handleCount()).toBe(0)
  })

  it('discards an answer that arrives after a new stop', async () => {
    const harness = createHarness()
    const { waiting, result } = await pending(harness)

    harness.newStop()
    waiting.resolve(OBJECT)

    expect(reason(await result)).toBe('stale')
    expect(harness.variables.handleCount()).toBe(0)
  })

  it('discards an answer that arrives after a workspace switch', async () => {
    const harness = createHarness()
    const { waiting, result } = await pending(harness)

    harness.setWorkspace(OTHER_WORKSPACE)
    waiting.resolve(OBJECT)

    expect(reason(await result)).toBe('stale')
    expect(harness.variables.handleCount()).toBe(0)
  })

  /** 通知より先に要求が来ることもある（6-6 と同じ ── 要求時にも突き合わせる）。 */
  it('discards an answer after a workspace switch that has not been announced yet', async () => {
    const harness = createHarness()
    const { waiting, result } = await pending(harness)

    harness.switchWorkspaceSilently(OTHER_WORKSPACE)
    waiting.resolve(OBJECT)

    expect(reason(await result)).toBe('stale')
  })

  it('discards an answer that arrives after the session was replaced', async () => {
    const harness = createHarness()
    const { waiting, result } = await pending(harness)

    harness.setState('idle')
    harness.replaceSession()
    waiting.resolve(OBJECT)

    expect(reason(await result)).toBe('stale')
    expect(harness.variables.handleCount()).toBe(0)
  })

  it('discards an answer that arrives after the session ended', async () => {
    const harness = createHarness()
    const { waiting, result } = await pending(harness)

    harness.setState('idle')
    waiting.resolve(OBJECT)

    expect(reason(await result)).toBe('stale')
  })

  /**
   * 停止は変わっていないが Call Stack を読み直した（`thread` event 等）。表は捨てられ、
   * epoch が進む ── **評価そのものは今の停止のもの**なので値は返し、handle だけを付けない。
   */
  it('answers without a handle when the handle table was dropped mid-flight', async () => {
    const harness = createHarness()
    const { waiting, result } = await pending(harness)

    harness.callStackChanged()
    waiting.resolve(OBJECT)

    const value = ok(await result)

    expect(value.value).toBe('{ name: "Ada" }')
    expect(value.handle).toBeNull()
    expect(harness.variables.handleCount()).toBe(0)
  })

  /** adapter が閉じた（プロセスが落ちた / Stop の途中）。 */
  it('treats a closed request as stale', async () => {
    const harness = createHarness({
      evaluate: async () => ({ status: 'closed', reason: 'the session moved on.' })
    })

    expect(reason(await harness.store.evaluate('user', 11, 'repl'))).toBe('stale')
  })
})

describe('debug evaluate — adapter failures', () => {
  it('returns failed and keeps the adapter wording in the main log only', async () => {
    const harness = createHarness({
      evaluate: async () => ({
        status: 'failure',
        message: 'ReferenceError at D:\\proj\\src\\app.js:3',
        body: undefined
      })
    })

    const result = await harness.store.evaluate('nope', 11, 'repl')

    expect(reason(result)).toBe('failed')
    expect(JSON.stringify(result)).not.toContain('D:\\proj')
    expect(harness.logs.some((line) => line.includes('D:\\proj\\src\\app.js:3'))).toBe(true)
  })

  it.each([
    ['no body', undefined],
    ['a body without result', { variablesReference: 1000 }],
    ['a non-string result', { result: 3 }],
    ['an array', []],
    ['a string', 'ok']
  ])('returns failed for a malformed adapter response (%s)', async (_name, body) => {
    const harness = createHarness({ evaluate: async () => success(body) })

    expect(reason(await harness.store.evaluate('user', 11, 'repl'))).toBe('failed')
    expect(harness.logs.some((line) => line.includes('malformed evaluate response'))).toBe(true)
  })

  it('returns timeout when the adapter never answers', async () => {
    const harness = createHarness({
      evaluate: () => new Promise<DapRequestOutcome>(() => {}),
      timeoutMs: 20
    })

    expect(reason(await harness.store.evaluate('while(true);', 11, 'repl'))).toBe('timeout')
    expect(harness.logs.some((line) => line.includes('did not answer in time'))).toBe(true)
  })

  /** 時間切れの後に届いた答えは、handle を発行しない（画面はもう timeout を出している）。 */
  it('does not register a handle for an answer that arrives after the timeout', async () => {
    const waiting = deferred<DapRequestOutcome>()
    const harness = createHarness({ evaluate: () => waiting.promise, timeoutMs: 20 })

    expect(reason(await harness.store.evaluate('user', 11, 'repl'))).toBe('timeout')

    waiting.resolve(OBJECT)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(harness.variables.handleCount()).toBe(0)
  })
})

describe('debug evaluate — what never reaches the renderer', () => {
  it('never carries a DAP command, adapter, path or process detail', async () => {
    const harness = createHarness({
      evaluate: async () =>
        success({
          result: 'ok',
          type: 'string',
          variablesReference: 4001,
          memoryReference: '0x00007ff6',
          valueLocationReference: 12,
          presentationHint: { kind: 'data', attributes: ['rawString'] }
        })
    })

    const serialized = JSON.stringify(await harness.store.evaluate('user', 11, 'repl'))

    for (const forbidden of [
      '4001',
      'memoryReference',
      '0x00007ff6',
      'valueLocationReference',
      'attributes',
      'variablesReference',
      'evaluateName',
      'D:\\',
      'file://'
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  /** 送るのは常に `evaluate` の1語で、呼び出し側は command を選べない。 */
  it('sends only the evaluate request, whatever the caller passes', async () => {
    const harness = createHarness()

    await harness.store.evaluate('count', 11, 'repl')
    await harness.store.evaluate('count', 11, 'watch')

    expect(harness.requestEvaluate).toHaveBeenCalledTimes(2)
    for (const call of harness.requestEvaluate.mock.calls) {
      expect(Object.keys(call[0] as object).sort()).toEqual(['context', 'expression', 'frameId'])
    }
  })
})
