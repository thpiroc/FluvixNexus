import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { DebugScope, DebugSessionState, DebugVariable } from '@shared/debug'
import type { WorkspaceFolder } from '@shared/workspace'
import { describe, expect, it, vi } from 'vitest'
import type { DebugAdapterCommand } from './adapterCatalog'
import {
  startDebugAdapterProcess,
  type DebugAdapterProcess,
  type DebugAdapterProcessOptions
} from './adapterProcess'
import { createDebugCallStackStore } from './callStack'
import { createSetBreakpointsArguments } from './dapBreakpoints'
import type { DapConnection, DapRequestOutcome } from './dapConnection'
import { createDebugSessionManager } from './debugSessionManager'
import { createDebugVariablesStore } from './variables'

const OK: DapRequestOutcome = { status: 'success', body: undefined }

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] }
}))

interface PendingRequest {
  readonly command: string
  readonly args: unknown
  readonly resolve: (outcome: DapRequestOutcome) => void
}

function settle(): Promise<void> {
  return new Promise((resolveSettle) => setTimeout(resolveSettle, 0))
}

function createCommand(): DebugAdapterCommand {
  return { name: 'Mock Debug Adapter', file: 'C:\\Tools\\mock.exe', args: [], cwd: 'D:\\proj' }
}

function createAdapterHarness(options: DebugAdapterProcessOptions) {
  const requests: PendingRequest[] = []
  let disposed = false

  const connection: DapConnection = {
    receive: vi.fn(),
    request: vi.fn((command: string, args?: unknown) => {
      if (disposed) {
        return Promise.resolve({ status: 'closed', reason: 'disposed' } satisfies DapRequestOutcome)
      }

      return new Promise<DapRequestOutcome>((resolveRequest) => {
        requests.push({ command, args, resolve: resolveRequest })
      })
    }),
    dispose: vi.fn((reason: string) => {
      disposed = true

      for (const request of requests) {
        request.resolve({ status: 'closed', reason })
      }
    })
  }

  const process: DebugAdapterProcess = {
    connection,
    pid: 1234,
    dispose: vi.fn((reason) => {
      connection.dispose(reason)
      options.onClose?.('dispose', null, null)
    })
  }

  return {
    process,
    requests,
    event: (event: string, body?: unknown) => options.onEvent(event, body),
    resolve: async (command: string, outcome: DapRequestOutcome = OK) => {
      const pending = requests.find((request) => request.command === command)

      if (pending === undefined) {
        throw new Error(`no pending request: ${command}`)
      }

      pending.resolve(outcome)
      await settle()
    }
  }
}

async function startRunning(initializeBody: Record<string, unknown> = {}) {
  const adapters: ReturnType<typeof createAdapterHarness>[] = []
  const manager = createDebugSessionManager({
    startTimeoutMs: 1_000,
    startAdapterProcess: (options) => {
      const adapter = createAdapterHarness(options)
      adapters.push(adapter)

      return { status: 'started', process: adapter.process }
    }
  })

  expect(manager.start({ adapterId: 'mock', adapterCommand: createCommand() }).status).toBe(
    'started'
  )

  const adapter = adapters[0]
  await adapter.resolve('initialize', {
    status: 'success',
    body: { supportsConfigurationDoneRequest: true, ...initializeBody }
  })
  adapter.event('initialized')
  await settle()
  await adapter.resolve('configurationDone')

  return { manager, adapter }
}

describe('debug session variables channel', () => {
  it('opens only while stopped and sends scopes / variables through the feature channel', async () => {
    const { manager, adapter } = await startRunning({ supportsVariablePaging: true })

    expect(manager.getVariablesChannel()).toBeNull()

    adapter.event('stopped', { reason: 'breakpoint', threadId: 1 })
    const channel = manager.getVariablesChannel()

    expect(channel).toMatchObject({
      sessionId: 'debug-session-1',
      generation: 1,
      stopGeneration: 1,
      supportsVariablePaging: true
    })

    const scopes = channel?.requestScopes({ frameId: 11 })
    const variables = channel?.requestVariables({ variablesReference: 1000, start: 0, count: 501 })
    await settle()

    expect(adapter.requests.find((request) => request.command === 'scopes')?.args).toEqual({
      frameId: 11
    })
    expect(adapter.requests.find((request) => request.command === 'variables')?.args).toEqual({
      variablesReference: 1000,
      start: 0,
      count: 501
    })

    await adapter.resolve('scopes', { status: 'success', body: { scopes: [] } })
    await adapter.resolve('variables', { status: 'success', body: { variables: [] } })
    await expect(scopes).resolves.toMatchObject({ status: 'success' })
    await expect(variables).resolves.toMatchObject({ status: 'success' })
  })

  it('reports no paging support when the adapter does not name it', async () => {
    const { manager, adapter } = await startRunning()

    adapter.event('stopped', { reason: 'pause', threadId: 1 })

    expect(manager.getVariablesChannel()?.supportsVariablePaging).toBe(false)
  })

  it('closes old variables channels after a new stop, continued, or cleanup', async () => {
    const { manager, adapter } = await startRunning()

    adapter.event('stopped', { reason: 'breakpoint', threadId: 1 })
    const first = manager.getVariablesChannel()

    adapter.event('stopped', { reason: 'step', threadId: 1 })
    await expect(first?.requestVariables({ variablesReference: 1000 })).resolves.toMatchObject({
      status: 'closed'
    })

    const second = manager.getVariablesChannel()
    expect(second?.stopGeneration).toBe(2)

    adapter.event('continued', { threadId: 1 })
    expect(manager.getVariablesChannel()).toBeNull()
    await expect(second?.requestScopes({ frameId: 11 })).resolves.toMatchObject({
      status: 'closed'
    })
    expect(adapter.requests.some((request) => request.command === 'scopes')).toBe(false)
    expect(adapter.requests.some((request) => request.command === 'variables')).toBe(false)

    manager.stop('workspace changed')
    expect(manager.getVariablesChannel()).toBeNull()
  })
})

describe('real stdio mock adapter with call stack and variables stores', () => {
  it('walks breakpoint stop → call stack → scopes → nested variables → continue → stale handles', async () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'fluvix-dap-variables-'))
    const sourcePath = resolve(rootPath, 'src/app.ts')
    const adapterLog: string[] = []

    try {
      const manager = createDebugSessionManager({
        startTimeoutMs: 5_000,
        startAdapterProcess: startDebugAdapterProcess,
        onLog: (_level, message) => {
          adapterLog.push(message)
        },
        configurationHook: async (channel) => {
          await channel.setBreakpoints(
            createSetBreakpointsArguments({ path: sourcePath, name: 'app.ts' }, [9])
          )
        }
      })
      const workspace: WorkspaceFolder = {
        id: 'workspace-variables',
        rootPath,
        displayName: 'workspace-variables',
        openedAt: 1,
        exists: true
      }
      const callStack = createDebugCallStackStore({
        getWorkspace: () => workspace,
        getDebugState: manager.getState,
        getDebugGeneration: manager.getGeneration,
        getDebugStopGeneration: () => manager.getCallStackChannel()?.stopGeneration ?? 0,
        getChannel: manager.getCallStackChannel,
        onDebugStateChange: (listener) => manager.onStateChange((state) => listener(state)),
        onDebugStopped: manager.onStopped,
        onDebugThread: manager.onThread,
        emit: () => {}
      })
      const variables = createDebugVariablesStore({
        getWorkspace: () => workspace,
        getDebugState: manager.getState,
        getDebugGeneration: manager.getGeneration,
        getDebugStopGeneration: () => manager.getCallStackChannel()?.stopGeneration ?? 0,
        getFrameHandle: callStack.getFrameHandle,
        getChannel: manager.getVariablesChannel,
        onDebugStateChange: (listener) => manager.onStateChange((state) => listener(state)),
        onDebugStopped: manager.onStopped,
        onCallStackChange: callStack.onChange
      })

      callStack.start(() => () => {})
      variables.start(() => () => {})

      const stopped = waitForState(manager, 'stopped')

      expect(
        manager.start({
          adapterId: 'mock',
          adapterCommand: {
            name: 'Node mock DAP adapter',
            file: process.execPath,
            args: ['-e', MOCK_VARIABLES_ADAPTER_SCRIPT, sourcePath],
            cwd: tmpdir(),
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
          },
          launchArguments: { program: 'main.js' }
        }).status
      ).toBe('started')

      await stopped
      await waitFor(() => callStack.list().status === 'stopped')

      const frames = callStack.list().threads[0]?.frames ?? []
      expect(frames.map((frame) => frame.id)).toEqual([101, 102])

      // top frame → scopes → locals (lazy: only scopes first)
      const scopesResult = await variables.listScopes(101)
      expect(scopesResult.status).toBe('ok')
      const scopes = scopesResult.status === 'ok' ? scopesResult.scopes : []
      expect(scopes.map((scope) => [scope.name, scope.expensive, scope.handle !== null])).toEqual([
        ['Locals', false, true],
        ['Globals', true, true]
      ])
      expect(requested(adapterLog, 'variables')).toEqual([])

      const locals = await expectVariables(variables.listVariables(handleOf(scopes[0])))
      expect(locals.map((variable) => [variable.name, variable.value])).toEqual([
        ['count', '3'],
        ['user', 'User {name, address}']
      ])
      expect(locals[0]?.handle).toBeNull()

      const user = await expectVariables(variables.listVariables(handleOf(locals[1])))
      expect(user.map((variable) => variable.name)).toEqual(['name', 'address'])

      const address = await expectVariables(variables.listVariables(handleOf(user[1])))
      expect(address).toMatchObject([{ name: 'city', value: '"London"', handle: null }])

      // variablesReference は Renderer 形に一度も出ない
      const everything = JSON.stringify({ scopes, locals, user, address })
      for (const raw of ['1000', '1001', '2001', '3001', rootPath, 'D:\\\\secret']) {
        expect(everything).not.toContain(raw)
      }

      // 別の frame（Workspace 外）も選べ、その frame の scope が返る
      const outer = await variables.listScopes(102)
      expect(outer.status === 'ok' ? outer.scopes.map((scope) => scope.name) : []).toEqual([
        'Closure'
      ])

      // continue → handles invalid → next stop reuses the same numbers
      const oldLocals = handleOf(scopes[0])
      const oldUser = handleOf(locals[1])
      const restopped = waitForStopGeneration(manager, 2)
      await expect(manager.control('continue')).resolves.toMatchObject({ status: 'accepted' })
      expect(await variables.listVariables(oldUser)).toEqual({
        status: 'unavailable',
        reason: 'not-stopped'
      })

      await restopped
      await waitFor(() => callStack.list().status === 'stopped')

      const variablesRequestsBefore = requested(adapterLog, 'variables').length
      expect(await variables.listVariables(oldLocals)).toEqual({
        status: 'unavailable',
        reason: 'stale'
      })
      expect(await variables.listVariables(oldUser)).toEqual({
        status: 'unavailable',
        reason: 'stale'
      })
      expect(requested(adapterLog, 'variables')).toHaveLength(variablesRequestsBefore)

      const again = await variables.listScopes(101)
      expect(again.status === 'ok' ? again.scopes[0]?.handle : null).not.toBe(oldLocals)

      expect(requested(adapterLog, 'setBreakpoints')).toHaveLength(1)
      expect(requested(adapterLog, 'scopes')).toEqual(['101', '102', '101'])

      await expect(manager.requestStop()).resolves.toMatchObject({ state: 'idle' })
      expect(variables.handleCount()).toBe(0)
    } finally {
      rmSync(rootPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })
})

function handleOf(node: DebugScope | DebugVariable | undefined): string {
  if (node?.handle === null || node?.handle === undefined) {
    throw new Error('expected an expandable node')
  }

  return node.handle
}

async function expectVariables(
  pending: Promise<
    | { readonly status: 'ok'; readonly variables: readonly DebugVariable[] }
    | { readonly status: 'unavailable'; readonly reason: string }
  >
): Promise<readonly DebugVariable[]> {
  const result = await pending

  if (result.status !== 'ok') {
    throw new Error(`expected variables, got ${result.reason}`)
  }

  return result.variables
}

/** mock adapter が stderr に書いた `REQ <command> <detail>` の detail を並べる。 */
function requested(log: readonly string[], command: string): string[] {
  const pattern = /REQ (\w+) ([\w-]+)/g

  return [...log.join('\n').matchAll(pattern)].flatMap((match) =>
    match[1] === command ? [match[2] ?? ''] : []
  )
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (predicate()) {
      return
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 20))
  }

  throw new Error('timed out waiting for condition')
}

function waitForState(
  manager: ReturnType<typeof createDebugSessionManager>,
  expected: DebugSessionState
): Promise<void> {
  if (manager.getState() === expected) {
    return Promise.resolve()
  }

  return new Promise((resolveWait, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`timed out waiting for debug session state: ${expected}`))
    }, 5_000)
    const unsubscribe = manager.onStateChange((state) => {
      if (state !== expected) {
        return
      }

      clearTimeout(timer)
      unsubscribe()
      resolveWait()
    })
  })
}

function waitForStopGeneration(
  manager: ReturnType<typeof createDebugSessionManager>,
  expected: number
): Promise<void> {
  return new Promise((resolveWait, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`timed out waiting for stop generation ${String(expected)}`))
    }, 5_000)
    const unsubscribe = manager.onStopped((event) => {
      if (event.stopGeneration !== expected) {
        return
      }

      clearTimeout(timer)
      unsubscribe()
      resolveWait()
    })
  })
}

/*
  DAP を話す小さな Node スクリプト。configurationDone の後に breakpoint で止まり、
  continue の後にもう一度（**同じ variablesReference の番号を使い回して**）止まる。
  受けた request は stderr へ `REQ <command> <detail>` と書く（Main のログに流れる）。
*/
const MOCK_VARIABLES_ADAPTER_SCRIPT = String.raw`
const sourcePath = process.argv[1]
let pending = Buffer.alloc(0)
let nextSeq = 1
const separator = '\r\n\r\n'

function send(message) {
  const body = Buffer.from(JSON.stringify({ seq: nextSeq++, ...message }), 'utf8')
  process.stdout.write('Content-Length: ' + body.byteLength + separator)
  process.stdout.write(body)
}

function respond(request, body) {
  send({ type: 'response', request_seq: request.seq, success: true, command: request.command, body })
}

function stop(reason) {
  send({ type: 'event', event: 'stopped', body: { reason, threadId: 1, allThreadsStopped: true } })
}

const VARIABLES = {
  1000: [
    { name: 'count', value: '3', type: 'number', variablesReference: 0 },
    { name: 'user', value: 'User {name, address}', type: 'User', variablesReference: 2001, namedVariables: 2, evaluateName: 'user', memoryReference: '0x1' }
  ],
  1001: [{ name: 'process', value: '{…}', variablesReference: 0 }],
  1100: [{ name: 'captured', value: 'true', variablesReference: 0 }],
  2001: [
    { name: 'name', value: '"Ada"', type: 'string', variablesReference: 0 },
    { name: 'address', value: '{…}', variablesReference: 3001, declarationLocationReference: 9 }
  ],
  3001: [{ name: 'city', value: '"London"', type: 'string', variablesReference: 0 }]
}

function handle(request) {
  const args = request.arguments || {}
  let detail = '-'
  if (request.command === 'scopes') detail = String(args.frameId)
  if (request.command === 'variables') detail = String(args.variablesReference)
  process.stderr.write('REQ ' + request.command + ' ' + detail + '\n')

  switch (request.command) {
    case 'initialize':
      respond(request, { supportsConfigurationDoneRequest: true })
      return
    case 'launch':
      send({ type: 'event', event: 'initialized' })
      return
    case 'setBreakpoints':
      respond(request, { breakpoints: [{ verified: true, line: 9 }] })
      return
    case 'configurationDone':
      respond(request)
      setTimeout(() => stop('breakpoint'), 20)
      return
    case 'threads':
      respond(request, { threads: [{ id: 1, name: 'main' }] })
      return
    case 'stackTrace':
      respond(request, {
        stackFrames: [
          { id: 101, name: 'run', source: { path: sourcePath }, line: 9, column: 5 },
          { id: 102, name: 'external', source: { path: 'D:\\secret\\lib.ts' }, line: 2, column: 1 }
        ]
      })
      return
    case 'scopes':
      if (args.frameId === 102) {
        respond(request, { scopes: [{ name: 'Closure', variablesReference: 1100, expensive: false }] })
        return
      }
      respond(request, {
        scopes: [
          { name: 'Locals', presentationHint: 'locals', variablesReference: 1000, expensive: false, source: { path: 'D:\\secret\\app.ts' } },
          { name: 'Globals', variablesReference: 1001, expensive: true }
        ]
      })
      return
    case 'variables':
      respond(request, { variables: VARIABLES[args.variablesReference] || [] })
      return
    case 'continue':
      respond(request, { allThreadsContinued: true })
      setTimeout(() => stop('breakpoint'), 30)
      return
    case 'disconnect':
      respond(request)
      setTimeout(() => process.exit(0), 10)
      return
    default:
      respond(request)
  }
}

process.stdin.on('data', (chunk) => {
  pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])

  for (;;) {
    const separatorAt = pending.indexOf(separator)
    if (separatorAt < 0) return

    const header = pending.subarray(0, separatorAt).toString('ascii')
    const match = /content-length:\s*(\d+)/i.exec(header)
    if (match === null) process.exit(2)

    const bodyAt = separatorAt + separator.length
    const bodyEnd = bodyAt + Number(match[1])
    if (pending.length < bodyEnd) return

    const request = JSON.parse(pending.subarray(bodyAt, bodyEnd).toString('utf8'))
    pending = pending.subarray(bodyEnd)
    handle(request)
  }
})
`
