import { describe, expect, it } from 'vitest'
import type {
  DebugAdapterConnectionHandlers,
  DebugAdapterProcess,
  DebugAdapterProcessOptions
} from './adapterProcess'
import type { DapConnection, DapRequestOutcome, DapStartDebuggingAnswer } from './dapConnection'
import {
  createDebugSessionManager,
  type DebugSessionConfigurationHook,
  type DebugSessionManager,
  type DebugSessionStartOptions
} from './debugSessionManager'

/**
 * root / child の DAP 接続（Session 6-15A）。
 *
 * adapter は偽物（接続ごとに送られた request を控え、テストが1つずつ答える）。
 * 見ることは次の5つ:
 *
 * - `startDebugging` を受ける条件と断る条件（Renderer の API は1つも変わらない）
 * - 子の設定の窓の順序（breakpoint を root と子のどちらへいつ送るか）
 * - primary child が ready になった後の宛先（実行制御・Call Stack・Variables・Evaluate）
 * - 接続を跨いだ口 / handle を通さないこと（stop generation と connectionId）
 * - どの終わり方でも子・root・adapter のプロセスがすべて片付くこと
 */

interface SentRequest {
  readonly command: string
  readonly args: unknown
  readonly resolve: (outcome: DapRequestOutcome) => void
  settled: boolean
}

interface FakeConnection {
  readonly connection: DapConnection
  readonly requests: SentRequest[]
  closed: boolean
  readonly commands: () => string[]
  readonly closeAll: (reason: string) => void
  readonly respond: (command: string, outcome?: DapRequestOutcome) => Promise<void>
}

interface FakeChild {
  readonly fake: FakeConnection
  readonly handlers: DebugAdapterConnectionHandlers
  readonly disposeReasons: string[]
}

interface FakeAdapter {
  readonly options: DebugAdapterProcessOptions
  readonly process: DebugAdapterProcess
  readonly root: FakeConnection
  readonly children: FakeChild[]
  readonly disposeReasons: string[]
  readonly startDebugging: (args: unknown) => DapStartDebuggingAnswer
  readonly rootEvent: (event: string, body?: unknown) => void
}

interface Harness {
  readonly manager: DebugSessionManager
  readonly adapters: FakeAdapter[]
  readonly logs: string[]
}

const ROOT_ID = 'debug-session-1/root'
const CHILD_ID = 'debug-session-1/child-1'

const POLICY = { launchType: 'pwa-node', targetIdKey: '__pendingTargetId' } as const

const ROOT_CAPABILITIES = { supportsConfigurationDoneRequest: true, supportsTerminateRequest: true }

const CHILD_CAPABILITIES = {
  supportsConfigurationDoneRequest: true,
  supportsTerminateRequest: true,
  supportsExceptionInfoRequest: true
}

const CHILD_ARGS = {
  request: 'launch',
  configuration: {
    type: 'pwa-node',
    name: 'main.js',
    __pendingTargetId: 'target-1',
    sourceMaps: true
  }
}

/** 答えずに済ませる request（仕込みの往復は、ここでは順序だけを見る）。 */
const AUTO_RESPONDED = new Set(['setBreakpoints', 'setExceptionBreakpoints'])

function success(body: unknown = undefined): DapRequestOutcome {
  return { status: 'success', body }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createFakeConnection(): FakeConnection {
  const requests: SentRequest[] = []

  const fake: FakeConnection = {
    requests,
    closed: false,
    commands: () => requests.map((request) => request.command),
    connection: {
      receive: () => {},
      request: (command: string, args?: unknown) => {
        if (fake.closed) {
          return Promise.resolve({ status: 'closed', reason: 'closed' } as const)
        }

        return new Promise<DapRequestOutcome>((resolve) => {
          const request: SentRequest = { command, args, resolve, settled: false }
          requests.push(request)

          if (AUTO_RESPONDED.has(command)) {
            request.settled = true
            resolve(success({ breakpoints: [] }))
          }
        })
      },
      dispose: (reason: string) => {
        fake.closeAll(reason)
      }
    },
    closeAll: (reason) => {
      fake.closed = true

      for (const request of requests) {
        if (!request.settled) {
          request.settled = true
          request.resolve({ status: 'closed', reason })
        }
      }
    },
    respond: async (command, outcome = success()) => {
      const pending = requests.find((request) => request.command === command && !request.settled)

      if (pending === undefined) {
        throw new Error(`no pending request: ${command} (sent: ${fake.commands().join(', ')})`)
      }

      pending.settled = true
      pending.resolve(outcome)
      await flush()
    }
  }

  return fake
}

function createFakeAdapter(
  options: DebugAdapterProcessOptions,
  transport: 'socket' | 'stdio',
  openable: () => boolean
): FakeAdapter {
  const root = createFakeConnection()
  const children: FakeChild[] = []
  const disposeReasons: string[] = []
  let disposed = false

  const process: DebugAdapterProcess = {
    connection: root.connection,
    pid: 4242,
    transport,
    ...(transport === 'socket'
      ? {
          openConnection: (handlers: DebugAdapterConnectionHandlers) => {
            if (!openable() || disposed) {
              return null
            }

            const child: FakeChild = { fake: createFakeConnection(), handlers, disposeReasons: [] }
            children.push(child)

            return {
              connection: child.fake.connection,
              dispose: (reason: string) => {
                child.disposeReasons.push(reason)
                child.fake.closeAll(reason)
              }
            }
          }
        }
      : {}),
    dispose: (reason) => {
      if (disposed) {
        return
      }

      disposed = true
      disposeReasons.push(reason)
      root.closeAll(reason)

      for (const child of children) {
        child.fake.closeAll(reason)
      }

      options.onClose?.('dispose', null, null)
    }
  }

  return {
    options,
    process,
    root,
    children,
    disposeReasons,
    startDebugging: (args) =>
      options.onStartDebugging === undefined
        ? { accepted: false, message: 'the client does not handle "startDebugging".' }
        : options.onStartDebugging(args),
    rootEvent: (event, body) => {
      options.onEvent(event, body)
    }
  }
}

function createHarness(
  overrides: {
    readonly transport?: 'socket' | 'stdio'
    readonly openable?: () => boolean
    readonly configurationHook?: DebugSessionConfigurationHook
    readonly startTimeoutMs?: number
  } = {}
): Harness {
  const adapters: FakeAdapter[] = []
  const logs: string[] = []

  const manager = createDebugSessionManager({
    startTimeoutMs: overrides.startTimeoutMs ?? 1_000,
    terminateGraceMs: 200,
    disconnectGraceMs: 200,
    controlTimeoutMs: 500,
    ...(overrides.configurationHook === undefined
      ? {}
      : { configurationHook: overrides.configurationHook }),
    onLog: (level, message) => {
      logs.push(`${level}: ${message}`)
    },
    startAdapterProcess: (options) => {
      const adapter = createFakeAdapter(
        options,
        overrides.transport ?? 'socket',
        overrides.openable ?? (() => true)
      )
      adapters.push(adapter)

      return { status: 'started', process: adapter.process }
    }
  })

  return { manager, adapters, logs }
}

function startOptions(overrides: Partial<DebugSessionStartOptions> = {}): DebugSessionStartOptions {
  return {
    adapterId: 'pwa-node',
    adapterCommand: {
      name: 'Fake socket adapter',
      file: 'C:\\fake\\node.exe',
      args: [],
      cwd: 'C:\\fake'
    },
    launchArguments: { type: 'pwa-node', request: 'launch', program: 'D:\\proj\\main.js' },
    childSessions: POLICY,
    processId: 7,
    ...overrides
  }
}

function lastAdapter(harness: Harness): FakeAdapter {
  const adapter = harness.adapters[harness.adapters.length - 1]

  if (adapter === undefined) {
    throw new Error('no adapter was started')
  }

  return adapter
}

async function startRoot(
  harness: Harness,
  overrides: Partial<DebugSessionStartOptions> = {}
): Promise<FakeAdapter> {
  expect(harness.manager.start(startOptions(overrides)).status).toBe('started')
  const adapter = lastAdapter(harness)

  await flush()
  await adapter.root.respond('initialize', success(ROOT_CAPABILITIES))
  adapter.rootEvent('initialized')
  await flush()
  await adapter.root.respond('configurationDone')

  expect(harness.manager.getState()).toBe('running')

  return adapter
}

function childAt(adapter: FakeAdapter, index = 0): FakeChild {
  const child = adapter.children[index]

  if (child === undefined) {
    throw new Error(`no child connection at ${String(index)}`)
  }

  return child
}

async function attachChild(
  adapter: FakeAdapter,
  capabilities: Record<string, unknown> = CHILD_CAPABILITIES
): Promise<FakeChild> {
  expect(adapter.startDebugging(CHILD_ARGS)).toEqual({ accepted: true })
  const child = childAt(adapter, adapter.children.length - 1)

  await flush()
  await child.fake.respond('initialize', success(capabilities))
  child.handlers.onEvent('initialized', undefined)
  await flush()
  await child.fake.respond('configurationDone')
  await flush()

  return child
}

describe('debug session root / child connections (Session 6-15A)', () => {
  describe('root only', () => {
    it('does not hand the connection a startDebugging answer when child sessions are off', async () => {
      const harness = createHarness({ transport: 'stdio' })
      const adapter = await startRoot(harness, { childSessions: undefined })

      expect(adapter.options.onStartDebugging).toBeUndefined()
      expect(adapter.root.commands()).toEqual(['initialize', 'launch', 'configurationDone'])

      adapter.rootEvent('stopped', { reason: 'breakpoint', threadId: 1 })

      expect(harness.manager.getState()).toBe('stopped')
      expect(harness.manager.getCallStackChannel()?.connectionId).toBe(ROOT_ID)
      expect(harness.manager.getVariablesChannel()?.connectionId).toBe(ROOT_ID)
      expect(harness.manager.getEvaluateChannel()?.connectionId).toBe(ROOT_ID)
      expect(harness.manager.getBreakpointChannel()?.connectionId).toBe(ROOT_ID)

      const control = harness.manager.control('continue')
      await flush()
      await adapter.root.respond('continue')

      expect(await control).toEqual({ status: 'accepted', state: 'running' })
    })

    it('keeps a root-only session on the root connection when no child ever arrives', async () => {
      const harness = createHarness()
      const adapter = await startRoot(harness)

      adapter.rootEvent('stopped', { reason: 'entry', threadId: 3 })
      const channel = harness.manager.getCallStackChannel()

      expect(channel?.connectionId).toBe(ROOT_ID)

      const threads = channel?.requestThreads()
      await flush()
      await adapter.root.respond('threads', success({ threads: [{ id: 3, name: 'main' }] }))

      expect(await threads).toMatchObject({ status: 'success' })
    })
  })

  describe('accepting startDebugging', () => {
    it('opens a child connection and configures it in DAP order with the rebuilt configuration', async () => {
      const harness = createHarness()
      const adapter = await startRoot(harness)
      const child = await attachChild(adapter)

      expect(child.fake.commands()).toEqual(['initialize', 'launch', 'configurationDone'])
      expect(child.fake.requests[0]?.args).toEqual(adapter.root.requests[0]?.args)
      expect(child.fake.requests[1]?.args).toEqual({
        type: 'pwa-node',
        name: 'main.js',
        request: 'launch',
        __pendingTargetId: 'target-1'
      })
      expect(harness.manager.getState()).toBe('running')
      expect(harness.manager.getBreakpointChannel()?.connectionId).toBe(CHILD_ID)
      expect('onStartDebugging' in child.handlers).toBe(false)
    })

    it('sends breakpoints to root in its window, then again to the child before its configurationDone', async () => {
      const hookCalls: string[] = []
      const harness = createHarness({
        configurationHook: async (channel) => {
          hookCalls.push(channel.connectionId)
          await channel.setBreakpoints({
            source: { path: 'D:\\proj\\main.js' },
            breakpoints: [{ line: 3 }],
            lines: [3],
            sourceModified: false
          } as never)
        }
      })

      expect(harness.manager.start(startOptions()).status).toBe('started')
      const adapter = lastAdapter(harness)
      await flush()
      await adapter.root.respond('initialize', success(ROOT_CAPABILITIES))
      adapter.rootEvent('initialized')
      await flush()
      await adapter.root.respond('configurationDone')

      expect(adapter.root.commands()).toEqual([
        'initialize',
        'launch',
        'setBreakpoints',
        'configurationDone'
      ])

      expect(adapter.startDebugging(CHILD_ARGS)).toEqual({ accepted: true })
      const child = childAt(adapter)
      await flush()
      await child.fake.respond('initialize', success(CHILD_CAPABILITIES))

      expect(harness.manager.getBreakpointChannel()).toBeNull()

      child.handlers.onEvent('initialized', undefined)
      await flush()
      await child.fake.respond('configurationDone')

      expect(hookCalls).toEqual([ROOT_ID, CHILD_ID])
      expect(child.fake.commands()).toEqual([
        'initialize',
        'launch',
        'setBreakpoints',
        'configurationDone'
      ])
      expect(harness.manager.getBreakpointChannel()?.connectionId).toBe(CHILD_ID)
    })

    it('sends exception filters to the child only when the child names them', async () => {
      const harness = createHarness()
      const adapter = await startRoot(harness, { exceptionBreakpointFilters: ['uncaught'] })

      await attachChild(adapter, {
        ...CHILD_CAPABILITIES,
        exceptionBreakpointFilters: [{ filter: 'uncaught', label: 'Uncaught' }]
      })

      expect(adapter.root.commands()).not.toContain('setExceptionBreakpoints')
      expect(childAt(adapter).fake.commands()).toEqual([
        'initialize',
        'launch',
        'setExceptionBreakpoints',
        'configurationDone'
      ])
      expect(childAt(adapter).fake.requests[2]?.args).toEqual({ filters: ['uncaught'] })
    })

    it('waits for root to reach running before the child becomes primary', async () => {
      const harness = createHarness()
      expect(harness.manager.start(startOptions()).status).toBe('started')
      const adapter = lastAdapter(harness)
      await flush()
      await adapter.root.respond('initialize', success(ROOT_CAPABILITIES))
      adapter.rootEvent('initialized')
      await flush()

      // root の configurationDone に答える前に子が来て、initialized まで進み、止まったと言う。
      expect(adapter.startDebugging(CHILD_ARGS)).toEqual({ accepted: true })
      const child = childAt(adapter)
      await flush()
      await child.fake.respond('initialize', success(CHILD_CAPABILITIES))
      child.handlers.onEvent('initialized', undefined)
      await flush()
      child.handlers.onEvent('stopped', { reason: 'entry', threadId: 9 })

      // 子の設定の窓は root の running を待つ（root と子の仕込みを重ねない）。
      expect(child.fake.commands()).toEqual(['initialize', 'launch'])
      expect(harness.manager.getState()).toBe('starting')

      await adapter.root.respond('configurationDone')
      await flush()

      expect(harness.manager.getState()).toBe('running')
      expect(child.fake.commands()).toEqual(['initialize', 'launch', 'configurationDone'])

      await child.fake.respond('configurationDone')
      await flush()

      expect(harness.manager.getState()).toBe('stopped')
      expect(harness.manager.getCallStackChannel()).toMatchObject({
        connectionId: CHILD_ID,
        stoppedThreadId: 9
      })
    })

    it('replays child execution events that arrive before configuration finishes', async () => {
      const harness = createHarness()
      const adapter = await startRoot(harness)

      expect(adapter.startDebugging(CHILD_ARGS)).toEqual({ accepted: true })
      const child = childAt(adapter)
      await flush()
      await child.fake.respond('initialize', success(CHILD_CAPABILITIES))
      child.handlers.onEvent('initialized', undefined)
      await flush()
      child.handlers.onEvent('stopped', { reason: 'breakpoint', threadId: 7 })
      child.handlers.onEvent('output', { category: 'stdout', output: 'hi\n' })

      expect(harness.manager.getState()).toBe('running')

      await child.fake.respond('configurationDone')
      await flush()

      expect(harness.manager.getState()).toBe('stopped')
      expect(harness.manager.getCallStackChannel()).toMatchObject({
        connectionId: CHILD_ID,
        stoppedThreadId: 7
      })
    })
  })

  describe('rejecting startDebugging', () => {
    it.each([
      ['attach', { request: 'attach', configuration: CHILD_ARGS.configuration }],
      [
        'an unknown type',
        { request: 'launch', configuration: { type: 'chrome', __pendingTargetId: 't' } }
      ],
      ['a malformed body', 'launch'],
      [
        'a cwd injection',
        { request: 'launch', configuration: { ...CHILD_ARGS.configuration, cwd: 'C:\\' } }
      ],
      [
        'a runtime executable',
        {
          request: 'launch',
          configuration: { ...CHILD_ARGS.configuration, runtimeExecutable: 'calc.exe' }
        }
      ],
      ['a missing target id', { request: 'launch', configuration: { type: 'pwa-node' } }]
    ])('rejects %s without opening a connection', async (_name, args) => {
      const harness = createHarness()
      const adapter = await startRoot(harness)
      const answer = adapter.startDebugging(args)

      expect(answer.accepted).toBe(false)
      expect(adapter.children).toHaveLength(0)
      expect(harness.manager.getState()).toBe('running')
      expect(JSON.stringify(answer)).not.toMatch(/calc|C:\\\\|D:\\\\/)
    })

    it('rejects a duplicate startDebugging while a primary child exists', async () => {
      const harness = createHarness()
      const adapter = await startRoot(harness)

      expect(adapter.startDebugging(CHILD_ARGS)).toEqual({ accepted: true })
      expect(adapter.startDebugging(CHILD_ARGS).accepted).toBe(false)

      await flush()
      await childAt(adapter).fake.respond('initialize', success(CHILD_CAPABILITIES))
      childAt(adapter).handlers.onEvent('initialized', undefined)
      await flush()
      await childAt(adapter).fake.respond('configurationDone')

      expect(adapter.startDebugging(CHILD_ARGS).accepted).toBe(false)
      expect(adapter.children).toHaveLength(1)
      expect(harness.logs.some((line) => line.includes('already attached'))).toBe(true)
    })

    it('rejects when the transport cannot open another connection (stdio)', async () => {
      const harness = createHarness({ transport: 'stdio' })
      const adapter = await startRoot(harness)

      expect(adapter.startDebugging(CHILD_ARGS).accepted).toBe(false)
      expect(harness.manager.getState()).toBe('running')
    })

    it('rejects when no connection can be opened', async () => {
      const harness = createHarness({ openable: () => false })
      const adapter = await startRoot(harness)

      expect(adapter.startDebugging(CHILD_ARGS).accepted).toBe(false)
      expect(adapter.children).toHaveLength(0)
    })

    it('rejects while the session is stopping', async () => {
      const harness = createHarness()
      const adapter = await startRoot(harness)

      void harness.manager.requestStop()

      expect(adapter.startDebugging(CHILD_ARGS).accepted).toBe(false)
      expect(adapter.children).toHaveLength(0)
    })
  })

  describe('primary child routing', () => {
    it('routes Continue / Step / Pause to the primary child with its thread', async () => {
      const harness = createHarness()
      const adapter = await startRoot(harness)
      const child = await attachChild(adapter)

      child.handlers.onEvent('stopped', { reason: 'breakpoint', threadId: 1 })
      expect(harness.manager.getState()).toBe('stopped')

      const stepOver = harness.manager.control('stepOver')
      await flush()
      expect(child.fake.requests[child.fake.requests.length - 1]).toMatchObject({
        command: 'next',
        args: { threadId: 1 }
      })
      await child.fake.respond('next')
      expect(await stepOver).toEqual({ status: 'accepted', state: 'running' })

      const pause = harness.manager.control('pause')
      await flush()
      await child.fake.respond('pause')
      expect(await pause).toMatchObject({ status: 'accepted' })

      child.handlers.onEvent('stopped', { reason: 'pause', threadId: 1 })
      const resume = harness.manager.control('continue')
      await flush()
      await child.fake.respond('continue')
      expect(await resume).toEqual({ status: 'accepted', state: 'running' })

      expect(adapter.root.commands()).toEqual(['initialize', 'launch', 'configurationDone'])
    })

    it('reads threads / stackTrace / scopes / variables / evaluate / exceptionInfo from the child', async () => {
      const harness = createHarness()
      const adapter = await startRoot(harness)
      const child = await attachChild(adapter)

      child.handlers.onEvent('stopped', { reason: 'exception', threadId: 1 })

      const callStack = harness.manager.getCallStackChannel()
      const variables = harness.manager.getVariablesChannel()
      const evaluate = harness.manager.getEvaluateChannel()
      const exceptionInfo = harness.manager.getExceptionInfoChannel()

      expect(callStack?.connectionId).toBe(CHILD_ID)
      expect(variables?.connectionId).toBe(CHILD_ID)
      expect(evaluate?.connectionId).toBe(CHILD_ID)
      expect(exceptionInfo?.connectionId).toBe(CHILD_ID)

      const pending = [
        callStack?.requestThreads(),
        callStack?.requestStackTrace({ threadId: 1, startFrame: 0, levels: 20 }),
        variables?.requestScopes({ frameId: 1 }),
        variables?.requestVariables({ variablesReference: 1 }),
        evaluate?.requestEvaluate({ expression: 'x', frameId: 1, context: 'repl' }),
        exceptionInfo?.requestExceptionInfo({ threadId: 1 })
      ]
      await flush()

      expect(child.fake.commands().slice(3)).toEqual([
        'threads',
        'stackTrace',
        'scopes',
        'variables',
        'evaluate',
        'exceptionInfo'
      ])

      for (const command of child.fake.commands().slice(3)) {
        await child.fake.respond(command, success({}))
      }

      for (const outcome of pending) {
        expect(await outcome).toMatchObject({ status: 'success' })
      }

      expect(adapter.root.commands()).toEqual(['initialize', 'launch', 'configurationDone'])
    })

    it('ignores root execution events once the child is primary', async () => {
      const harness = createHarness()
      const adapter = await startRoot(harness)
      await attachChild(adapter)

      adapter.rootEvent('stopped', { reason: 'breakpoint', threadId: 1 })
      adapter.rootEvent('thread', { reason: 'started', threadId: 5 })

      expect(harness.manager.getState()).toBe('running')
      expect(harness.logs.some((line) => line.includes('child is primary'))).toBe(true)
    })

    it('makes root stop channels stale when the child becomes primary', async () => {
      const harness = createHarness()
      const adapter = await startRoot(harness)

      adapter.rootEvent('stopped', { reason: 'entry', threadId: 1 })
      const rootStack = harness.manager.getCallStackChannel()
      const rootVariables = harness.manager.getVariablesChannel()
      const rootEvaluate = harness.manager.getEvaluateChannel()

      expect(rootStack?.connectionId).toBe(ROOT_ID)

      const child = await attachChild(adapter)

      expect(harness.manager.getState()).toBe('running')
      expect(harness.manager.getCallStackChannel()).toBeNull()
      await expect(rootStack?.requestThreads()).resolves.toMatchObject({ status: 'closed' })
      await expect(rootVariables?.requestScopes({ frameId: 1 })).resolves.toMatchObject({
        status: 'closed'
      })
      await expect(
        rootEvaluate?.requestEvaluate({ expression: 'x', frameId: 1, context: 'repl' })
      ).resolves.toMatchObject({ status: 'closed' })

      child.handlers.onEvent('stopped', { reason: 'breakpoint', threadId: 1 })
      const childStack = harness.manager.getCallStackChannel()

      expect(childStack?.connectionId).toBe(CHILD_ID)
      expect(childStack?.stopGeneration).toBeGreaterThan(rootStack?.stopGeneration ?? 0)
      expect(adapter.root.commands()).not.toContain('threads')
    })
  })

  describe('cleanup', () => {
    it.each(['terminated', 'exited'])(
      'ends the whole session when the child sends "%s"',
      async (event) => {
        const harness = createHarness()
        const adapter = await startRoot(harness)
        const child = await attachChild(adapter)

        child.handlers.onEvent(event, undefined)

        expect(harness.manager.getState()).toBe('idle')
        expect(child.disposeReasons).toHaveLength(1)
        expect(adapter.disposeReasons).toHaveLength(1)
      }
    )

    it('ends the session and closes the child when root terminates', async () => {
      const harness = createHarness()
      const adapter = await startRoot(harness)
      const child = await attachChild(adapter)

      adapter.rootEvent('terminated')

      expect(harness.manager.getState()).toBe('idle')
      expect(child.disposeReasons).toHaveLength(1)
      expect(adapter.disposeReasons).toHaveLength(1)
    })

    it('ends the session when the child connection closes unexpectedly', async () => {
      const harness = createHarness()
      const adapter = await startRoot(harness)
      const child = await attachChild(adapter)

      child.handlers.onClosed('the socket closed.')

      expect(harness.manager.getState()).toBe('idle')
      expect(adapter.disposeReasons).toHaveLength(1)
      expect(harness.logs.some((line) => line.includes('child debug connection closed'))).toBe(true)
    })

    it('ends the session and closes the child on an adapter error', async () => {
      const harness = createHarness()
      const adapter = await startRoot(harness)
      const child = await attachChild(adapter)

      adapter.options.onError?.(new Error('the root DAP connection failed: ECONNRESET'))

      expect(harness.manager.getState()).toBe('idle')
      expect(child.disposeReasons).toHaveLength(1)
      expect(adapter.disposeReasons).toHaveLength(1)
    })

    it('ends the session when the child does not finish configuration in time', async () => {
      const harness = createHarness({ startTimeoutMs: 40 })
      const adapter = await startRoot(harness)

      expect(adapter.startDebugging(CHILD_ARGS)).toEqual({ accepted: true })
      await wait(120)

      expect(harness.manager.getState()).toBe('idle')
      expect(childAt(adapter).disposeReasons).toHaveLength(1)
      expect(adapter.disposeReasons).toHaveLength(1)
      expect(harness.logs.some((line) => line.includes('did not finish configuration'))).toBe(true)
    })

    it('ends the session when the child rejects initialize', async () => {
      const harness = createHarness()
      const adapter = await startRoot(harness)

      expect(adapter.startDebugging(CHILD_ARGS)).toEqual({ accepted: true })
      await flush()
      await childAt(adapter).fake.respond('initialize', {
        status: 'failure',
        message: 'no target',
        body: undefined
      })

      expect(harness.manager.getState()).toBe('idle')
      expect(childAt(adapter).disposeReasons).toHaveLength(1)
    })

    it('Stop terminates through the primary child, then disconnects and closes everything', async () => {
      const harness = createHarness()
      const adapter = await startRoot(harness)
      const child = await attachChild(adapter)

      child.handlers.onEvent('stopped', { reason: 'breakpoint', threadId: 1 })
      const stop = harness.manager.requestStop()
      await flush()

      expect(child.fake.commands()).toContain('terminate')
      await child.fake.respond('terminate')
      child.handlers.onEvent('terminated', undefined)
      await flush()

      expect(child.fake.commands()).toContain('disconnect')
      await child.fake.respond('disconnect')

      expect(await stop).toEqual({ status: 'accepted', state: 'idle' })
      expect(adapter.root.commands()).not.toContain('terminate')
      expect(child.disposeReasons).toHaveLength(1)
      expect(adapter.disposeReasons).toHaveLength(1)
    })

    it('Stop still closes everything when the child never answers', async () => {
      const harness = createHarness()
      const adapter = await startRoot(harness)
      const child = await attachChild(adapter)

      await expect(harness.manager.requestStop()).resolves.toEqual({
        status: 'accepted',
        state: 'idle'
      })
      expect(child.disposeReasons).toHaveLength(1)
      expect(adapter.disposeReasons).toHaveLength(1)
    })

    it.each([
      [
        'workspace switch',
        (manager: DebugSessionManager) => manager.stop('the workspace folder changed.')
      ],
      [
        'app quit',
        (manager: DebugSessionManager) => manager.dispose('the application is quitting.')
      ]
    ])('%s closes the child, root and the adapter process', async (_name, end) => {
      const harness = createHarness()
      const adapter = await startRoot(harness)
      const child = await attachChild(adapter)

      end(harness.manager)

      expect(harness.manager.getState()).toBe('idle')
      expect(adapter.root.commands()).toContain('disconnect')
      expect(child.disposeReasons).toHaveLength(1)
      expect(adapter.disposeReasons).toHaveLength(1)
    })

    it('ignores events and startDebugging from a previous session', async () => {
      const harness = createHarness()
      const first = await startRoot(harness)
      const oldChild = await attachChild(first)

      harness.manager.stop('the workspace folder changed.')
      const second = await startRoot(harness)

      oldChild.handlers.onEvent('stopped', { reason: 'breakpoint', threadId: 1 })
      oldChild.handlers.onClosed('late close')
      first.rootEvent('terminated')

      expect(harness.manager.getState()).toBe('running')
      expect(first.startDebugging(CHILD_ARGS).accepted).toBe(false)
      expect(second.children).toHaveLength(0)
    })

    it('ignores events from the child after it was closed within the same session', async () => {
      const harness = createHarness()
      const adapter = await startRoot(harness)
      const child = await attachChild(adapter)
      const states: string[] = []
      harness.manager.onStateChange((state) => {
        states.push(state)
      })

      harness.manager.stop('the workspace folder changed.')
      const afterStop = [...states]
      child.handlers.onEvent('stopped', { reason: 'breakpoint', threadId: 1 })
      child.handlers.onEvent('terminated', undefined)
      child.handlers.onClosed('late close')

      expect(afterStop[0]).toBe('terminating')
      expect(harness.manager.getState()).toBe('idle')
      expect(states).toEqual(afterStop)
    })
  })
})
