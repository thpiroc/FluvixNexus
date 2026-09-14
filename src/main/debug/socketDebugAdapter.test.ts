import { EventEmitter } from 'events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DebugAdapterCommand } from './adapterCatalog'
import {
  startDebugAdapterProcess,
  type DebugAdapterProcess,
  type DebugAdapterProcessOptions,
  type DebugAdapterSpawn
} from './adapterProcess'
import type { DebugAdapterTransport } from './adapterTransport'
import {
  createDebugSessionManager,
  type DebugSessionManager,
  type DebugSessionState
} from './debugSessionManager'

/**
 * socket の Debug Adapter transport（Session 6-15A）。
 *
 * **本物の子プロセスと本物の TCP** で見る（DEVELOPMENT.md §3「実ディスク / 実プロセスを触るテスト」）。
 * 題材は下の `FIXTURE_SCRIPT` ── 127.0.0.1 の空いた port で待ち受け、stdout に1行で port を出し、
 * 接続ごとに最小の DAP を話す。1本目の接続を root、2本目以降を child として振る舞い、
 * root は `configurationDone` の後に `runInTerminal` と `startDebugging` を逆方向に送る。
 * 受けた request / response はすべて JSON 行でファイルへ書く。
 *
 * force kill だけは本物のプロセスで作れない（Windows の kill は SIGTERM を無視させられない）ため、
 * 偽の child process で「kill しても終わらない」を作る。
 */

const FIXTURE_SCRIPT = String.raw`
const net = require('net')
const fs = require('fs')
const mode = process.argv[2]
const logPath = process.argv[3]
const record = (entry) => fs.appendFileSync(logPath, JSON.stringify(entry) + '\n')

if (mode === 'exit') {
  process.exit(3)
}

if (mode === 'silent') {
  setInterval(() => {}, 1000)
}

if (mode === 'refuse') {
  const probe = net.createServer()
  probe.listen(0, '127.0.0.1', () => {
    const port = probe.address().port
    probe.close(() => {
      process.stdout.write('FIXTURE listening at 127.0.0.1:' + port + '\n')
      setInterval(() => {}, 1000)
    })
  })
}

if (mode === 'dap') {
  let connections = 0
  const server = net.createServer((socket) => {
    connections += 1
    const label = connections === 1 ? 'root' : 'child'
    let buffer = Buffer.alloc(0)
    let seq = 1
    const send = (message) => {
      message.seq = seq++
      const body = Buffer.from(JSON.stringify(message), 'utf8')
      socket.write('Content-Length: ' + body.length + '\r\n\r\n')
      socket.write(body)
    }
    const respond = (request, body) =>
      send({ type: 'response', request_seq: request.seq, success: true, command: request.command, body })

    socket.on('error', () => {})
    socket.on('close', () => record({ connection: label, closed: true }))
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        const headerEnd = buffer.indexOf('\r\n\r\n')
        if (headerEnd < 0) return
        const match = /Content-Length: (\d+)/i.exec(buffer.subarray(0, headerEnd).toString('utf8'))
        const length = Number(match[1])
        if (buffer.length < headerEnd + 4 + length) return
        const message = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8'))
        buffer = buffer.subarray(headerEnd + 4 + length)
        handle(message)
      }
    })

    function handle(message) {
      if (message.type === 'response') {
        record({ connection: label, response: message.command, success: message.success, message: message.message })
        return
      }

      record({ connection: label, command: message.command, arguments: message.arguments })

      switch (message.command) {
        case 'initialize':
          respond(message, { supportsConfigurationDoneRequest: true, supportsTerminateRequest: true })
          return
        case 'launch':
          respond(message, {})
          send({ type: 'event', event: 'initialized' })
          return
        case 'configurationDone':
          respond(message, {})
          if (label === 'root') {
            send({ type: 'request', command: 'runInTerminal', arguments: { kind: 'integrated', cwd: '/', args: ['calc.exe'] } })
            send({ type: 'request', command: 'startDebugging', arguments: { request: 'launch', configuration: { type: 'pwa-node', name: 'evil', __pendingTargetId: 't-0', runtimeExecutable: 'calc.exe' } } })
            send({ type: 'request', command: 'startDebugging', arguments: { request: 'attach', configuration: { type: 'pwa-node', name: 'attach', __pendingTargetId: 't-0' } } })
            send({ type: 'request', command: 'startDebugging', arguments: { request: 'launch', configuration: { type: 'pwa-node', name: 'main target', __pendingTargetId: 't-1', skipFiles: [] } } })
          } else {
            send({ type: 'event', event: 'output', body: { category: 'stdout', output: 'child ready\n' } })
            send({ type: 'event', event: 'stopped', body: { reason: 'breakpoint', threadId: 1, allThreadsStopped: true } })
          }
          return
        case 'threads':
          respond(message, { threads: [{ id: 1, name: label + '-thread' }] })
          return
        case 'stackTrace':
          respond(message, { stackFrames: [{ id: 1, name: label + '-frame', line: 3, column: 1 }], totalFrames: 1 })
          return
        case 'scopes':
          respond(message, { scopes: [{ name: 'Locals', variablesReference: 1, expensive: false }] })
          return
        case 'variables':
          respond(message, { variables: [{ name: 'who', value: label, variablesReference: 0 }] })
          return
        case 'evaluate':
          respond(message, { result: label + ':' + message.arguments.expression, variablesReference: 0 })
          return
        case 'continue':
          respond(message, { allThreadsContinued: true })
          setTimeout(() => send({ type: 'event', event: 'stopped', body: { reason: 'step', threadId: 1 } }), 30)
          return
        case 'terminate':
          respond(message, {})
          send({ type: 'event', event: 'terminated' })
          return
        case 'disconnect':
          respond(message, {})
          return
        default:
          send({ type: 'response', request_seq: message.seq, success: false, command: message.command, message: 'unsupported' })
      }
    }
  })

  server.listen(0, '127.0.0.1', () => {
    process.stdout.write('booting\n')
    process.stdout.write('FIXTURE listening at 127.0.0.1:' + server.address().port + '\n')
  })
}
`

const SOCKET_TRANSPORT: DebugAdapterTransport = {
  kind: 'socket',
  readiness: {
    kind: 'stdout-pattern',
    pattern: /^FIXTURE listening at (?<host>[^:\s]+):(?<port>[0-9]+)$/
  }
}

const CHILD_POLICY = { launchType: 'pwa-node', targetIdKey: '__pendingTargetId' } as const

let workDir = ''
let fixturePath = ''
let logCounter = 0

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'fluvix-dap-socket-'))
  fixturePath = join(workDir, 'fixture-dap-server.js')
  writeFileSync(fixturePath, FIXTURE_SCRIPT, 'utf8')
})

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

function nextLogPath(): string {
  logCounter += 1
  return join(workDir, `requests-${String(logCounter)}.log`)
}

function fixtureCommand(mode: string, logPath: string): DebugAdapterCommand {
  return {
    name: 'Fixture socket DAP server',
    file: process.execPath,
    args: [fixturePath, mode, logPath],
    // 記録先のフォルダを cwd にしない（Windows では消すときに掴まれたままになる）。
    cwd: tmpdir(),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    transport: SOCKET_TRANSPORT
  }
}

interface LogEntry {
  readonly connection: 'root' | 'child'
  readonly command?: string
  readonly arguments?: unknown
  readonly response?: string
  readonly success?: boolean
  readonly message?: string
  readonly closed?: boolean
}

function readLog(logPath: string): LogEntry[] {
  try {
    return readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as LogEntry)
  } catch {
    return []
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(condition: () => boolean, label: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`)
    }

    await sleep(20)
  }
}

/**
 * このテストのプロセス（Main の側）が握っている TCP socket の数。
 *
 * 片付けの後に adapter の側で「閉じた」を記録させることはできない（kill が先に届く）ので、
 * orphan socket が残っていないことは Main の側の数が元へ戻ることで見る。
 */
function countTcpSockets(): number {
  return process.getActiveResourcesInfo().filter((name) => name === 'TCPSocketWrap').length
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForExit(pid: number | undefined): Promise<void> {
  expect(pid).toBeTypeOf('number')
  await waitFor(() => !isAlive(pid as number), `process ${String(pid)} to exit`)
}

function startFixture(
  mode: string,
  overrides: Partial<DebugAdapterProcessOptions> = {}
): {
  readonly process: DebugAdapterProcess
  readonly errors: string[]
  readonly closes: string[]
  readonly logPath: string
} {
  const errors: string[] = []
  const closes: string[] = []
  const logPath = nextLogPath()
  const outcome = startDebugAdapterProcess({
    command: fixtureCommand(mode, logPath),
    onEvent: () => {},
    onError: (error) => {
      errors.push(error.message)
    },
    onClose: (reason) => {
      closes.push(reason)
    },
    ...overrides
  })

  if (outcome.status !== 'started') {
    throw new Error(`the fixture did not start: ${outcome.detail}`)
  }

  return { process: outcome.process, errors, closes, logPath }
}

describe('socket debug adapter transport (real process)', () => {
  it('connects to the listening port, opens another connection, and disposes both with the process', async () => {
    const fixture = startFixture('dap')

    expect(fixture.process.transport).toBe('socket')

    const initialize = await fixture.process.connection.request('initialize', { adapterID: 'x' })
    expect(initialize).toMatchObject({
      status: 'success',
      body: { supportsConfigurationDoneRequest: true }
    })

    const closedReasons: string[] = []
    const child = fixture.process.openConnection?.({
      onEvent: () => {},
      onClosed: (reason) => {
        closedReasons.push(reason)
      }
    })

    expect(child).not.toBeNull()
    expect(child).toBeDefined()
    await expect(child?.connection.request('initialize', {})).resolves.toMatchObject({
      status: 'success'
    })

    fixture.process.dispose('test finished')

    expect(fixture.closes).toEqual(['dispose'])
    await expect(fixture.process.connection.request('threads')).resolves.toMatchObject({
      status: 'closed'
    })
    await expect(child?.connection.request('threads')).resolves.toMatchObject({ status: 'closed' })
    expect(fixture.process.openConnection?.({ onEvent: () => {}, onClosed: () => {} })).toBeNull()
    expect(closedReasons).toEqual([])
    await waitForExit(fixture.process.pid)
    expect(readLog(fixture.logPath).map((entry) => entry.connection)).toEqual(
      expect.arrayContaining(['root', 'child'])
    )
  }, 15_000)

  it('fails and kills the process when the adapter never reports a port in time', async () => {
    const fixture = startFixture('silent', { socketTiming: { readyTimeoutMs: 300 } })
    const initialize = fixture.process.connection.request('initialize', {})

    await expect(initialize).resolves.toMatchObject({ status: 'closed' })
    expect(fixture.errors).toEqual([
      expect.stringContaining('did not report a listening port in time')
    ])
    expect(fixture.closes).toEqual(['error'])
    await waitForExit(fixture.process.pid)
  }, 15_000)

  it('fails and kills the process when the port refuses the connection', async () => {
    const fixture = startFixture('refuse')
    const initialize = fixture.process.connection.request('initialize', {})

    await expect(initialize).resolves.toMatchObject({ status: 'closed' })
    expect(fixture.errors).toEqual([expect.stringContaining('the root DAP connection failed')])
    expect(fixture.closes).toEqual(['error'])
    await waitForExit(fixture.process.pid)
  }, 15_000)

  it('fails when the adapter exits before it is ready', async () => {
    const fixture = startFixture('exit')

    await expect(fixture.process.connection.request('initialize', {})).resolves.toMatchObject({
      status: 'closed'
    })
    expect(fixture.errors).toEqual([expect.stringContaining('exited before it was ready (code=3)')])
    expect(fixture.closes).toEqual(['error'])
  }, 15_000)

  it('reports a spawn failure for a missing executable without throwing', async () => {
    const errors: string[] = []
    const outcome = startDebugAdapterProcess({
      command: { ...fixtureCommand('dap', nextLogPath()), file: join(workDir, 'missing.exe') },
      onEvent: () => {},
      onError: (error) => {
        errors.push(error.message)
      }
    })

    if (outcome.status === 'started') {
      await waitFor(() => errors.length > 0, 'the spawn error')
      await expect(outcome.process.connection.request('initialize')).resolves.toMatchObject({
        status: 'closed'
      })
    } else {
      expect(outcome.detail).toContain('ENOENT')
    }
  }, 15_000)
})

describe('socket debug adapter transport (fake process)', () => {
  class FakeStream extends EventEmitter {
    readonly write = vi.fn()
  }

  class FakeChild extends EventEmitter {
    readonly stdin = new FakeStream()
    readonly stdout = new FakeStream()
    readonly stderr = new FakeStream()
    readonly pid = 9876
    readonly kill = vi.fn()
  }

  class FakeSocket extends EventEmitter {
    readonly write = vi.fn()
    readonly setNoDelay = vi.fn()
    readonly destroy = vi.fn(() => {
      this.emit('close')
    })
  }

  function startFake(forceKillGraceMs = 30) {
    const child = new FakeChild()
    const sockets: FakeSocket[] = []
    const targets: { host: string; port: number }[] = []
    const spawnAdapter = vi.fn<DebugAdapterSpawn>(() => child as never)
    const outcome = startDebugAdapterProcess({
      command: fixtureCommand('dap', 'unused'),
      onEvent: () => {},
      spawnAdapter,
      connectSocket: (target) => {
        targets.push({ ...target })
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket as never
      },
      socketTiming: { forceKillGraceMs }
    })

    if (outcome.status !== 'started') {
      throw new Error('expected started')
    }

    return { child, sockets, targets, spawnAdapter, process: outcome.process }
  }

  it('spawns without a shell and connects only to 127.0.0.1 on the reported port', () => {
    const fake = startFake()

    expect(fake.spawnAdapter).toHaveBeenCalledWith(
      process.execPath,
      [fixturePath, 'dap', 'unused'],
      expect.objectContaining({ shell: false, windowsHide: true })
    )
    expect(fake.process.openConnection?.({ onEvent: () => {}, onClosed: () => {} })).toBeNull()

    fake.child.stdout.emit('data', Buffer.from('FIXTURE listening at localhost:4711\n'))

    expect(fake.targets).toEqual([{ host: '127.0.0.1', port: 4711 }])
  })

  it('queues requests until the socket connects', async () => {
    const fake = startFake()
    void fake.process.connection.request('initialize', {})

    fake.child.stdout.emit('data', Buffer.from('FIXTURE listening at 127.0.0.1:4711\n'))
    const socket = fake.sockets[0]

    expect(socket?.write).not.toHaveBeenCalled()
    socket?.emit('connect')
    expect(socket?.write).toHaveBeenCalledTimes(1)
    expect(String(socket?.write.mock.calls[0]?.[0])).toContain('"command":"initialize"')

    fake.process.dispose('done')
  })

  it('does not become ready when the adapter names a non-loopback host', () => {
    const errors: string[] = []
    const child = new FakeChild()
    startDebugAdapterProcess({
      command: fixtureCommand('dap', 'unused'),
      onEvent: () => {},
      onError: (error) => {
        errors.push(error.message)
      },
      spawnAdapter: () => child as never,
      connectSocket: () => {
        throw new Error('must not connect')
      }
    })

    child.stdout.emit('data', Buffer.from('FIXTURE listening at 192.168.0.10:4711\n'))

    expect(errors).toEqual([expect.stringContaining('not listening on a loopback address')])
    expect(child.kill).toHaveBeenCalled()
  })

  it('sends SIGKILL when the process does not exit after kill', async () => {
    const fake = startFake(30)
    fake.child.stdout.emit('data', Buffer.from('FIXTURE listening at 127.0.0.1:4711\n'))
    fake.sockets[0]?.emit('connect')

    fake.process.dispose('stop')

    expect(fake.child.kill).toHaveBeenCalledTimes(1)
    expect(fake.child.kill).toHaveBeenLastCalledWith()
    expect(fake.sockets[0]?.destroy).toHaveBeenCalled()

    await sleep(80)

    expect(fake.child.kill).toHaveBeenCalledTimes(2)
    expect(fake.child.kill).toHaveBeenLastCalledWith('SIGKILL')
  })

  it('does not send SIGKILL when the process exits within the grace period', async () => {
    const fake = startFake(50)
    fake.child.stdout.emit('data', Buffer.from('FIXTURE listening at 127.0.0.1:4711\n'))

    fake.process.dispose('stop')
    fake.child.emit('exit', null, 'SIGTERM')
    await sleep(100)

    expect(fake.child.kill).toHaveBeenCalledTimes(1)
  })

  it('closes a child connection on its own without ending the adapter', () => {
    const closes: string[] = []
    const child = new FakeChild()
    const sockets: FakeSocket[] = []
    const outcome = startDebugAdapterProcess({
      command: fixtureCommand('dap', 'unused'),
      onEvent: () => {},
      onClose: (reason) => {
        closes.push(reason)
      },
      spawnAdapter: () => child as never,
      connectSocket: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket as never
      }
    })

    if (outcome.status !== 'started') {
      throw new Error('expected started')
    }

    child.stdout.emit('data', Buffer.from('FIXTURE listening at 127.0.0.1:4711\n'))
    sockets[0]?.emit('connect')

    const childClosed: string[] = []
    const link = outcome.process.openConnection?.({
      onEvent: () => {},
      onClosed: (reason) => {
        childClosed.push(reason)
      }
    })
    sockets[1]?.emit('connect')
    sockets[1]?.emit('close')

    expect(link).toBeDefined()
    expect(childClosed).toEqual(['the socket closed.'])
    expect(closes).toEqual([])
    expect(child.kill).not.toHaveBeenCalled()

    outcome.process.dispose('done')
  })

  it('treats a root socket close after ready as an adapter failure and kills the process', () => {
    const errors: string[] = []
    const child = new FakeChild()
    const sockets: FakeSocket[] = []
    startDebugAdapterProcess({
      command: fixtureCommand('dap', 'unused'),
      onEvent: () => {},
      onError: (error) => {
        errors.push(error.message)
      },
      spawnAdapter: () => child as never,
      connectSocket: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket as never
      }
    })

    child.stdout.emit('data', Buffer.from('FIXTURE listening at 127.0.0.1:4711\n'))
    sockets[0]?.emit('connect')
    sockets[0]?.emit('error', new Error('ECONNRESET'))

    expect(errors).toEqual([expect.stringContaining('ECONNRESET')])
    expect(child.kill).toHaveBeenCalled()
  })

  it('keeps stdio adapters on the 6-14 path (no second connection)', () => {
    const child = new FakeChild()
    const outcome = startDebugAdapterProcess({
      command: { ...fixtureCommand('dap', 'unused'), transport: { kind: 'stdio' } },
      onEvent: () => {},
      spawnAdapter: () => child as never
    })

    if (outcome.status !== 'started') {
      throw new Error('expected started')
    }

    expect(outcome.process.transport).toBeUndefined()
    expect(outcome.process.openConnection).toBeUndefined()
  })
})

describe('debug session over a real socket adapter with a primary child (Session 6-15A)', () => {
  function waitForState(manager: DebugSessionManager, expected: DebugSessionState): Promise<void> {
    return new Promise((resolve, reject) => {
      if (manager.getState() === expected) {
        resolve()
        return
      }

      const timer = setTimeout(() => {
        unsubscribe()
        reject(new Error(`timed out waiting for debug session state: ${expected}`))
      }, 8_000)
      const unsubscribe = manager.onStateChange((state) => {
        if (state !== expected) {
          return
        }

        clearTimeout(timer)
        unsubscribe()
        resolve()
      })
    })
  }

  it('runs root → startDebugging → child, reads the child, and cleans up every connection and the process', async () => {
    const logPath = nextLogPath()
    const pids: (number | undefined)[] = []
    const logs: string[] = []
    const outputs: unknown[] = []
    const manager = createDebugSessionManager({
      startTimeoutMs: 8_000,
      onLog: (level, message) => {
        logs.push(`${level}: ${message}`)
      },
      startAdapterProcess: (options) => {
        const outcome = startDebugAdapterProcess(options)

        if (outcome.status === 'started') {
          pids.push(outcome.process.pid)
        }

        return outcome
      }
    })
    manager.onOutput((event) => {
      outputs.push(event.body)
    })

    const socketsBefore = countTcpSockets()
    const stopped = waitForState(manager, 'stopped')

    expect(
      manager.start({
        adapterId: 'pwa-node',
        adapterCommand: fixtureCommand('dap', logPath),
        launchArguments: { type: 'pwa-node', request: 'launch', program: 'main.js' },
        childSessions: CHILD_POLICY
      }).status
    ).toBe('started')

    await stopped

    const callStack = manager.getCallStackChannel()
    expect(callStack?.connectionId).toBe('debug-session-1/child-1')
    await expect(callStack?.requestThreads()).resolves.toEqual({
      status: 'success',
      body: { threads: [{ id: 1, name: 'child-thread' }] }
    })

    const variables = manager.getVariablesChannel()
    await expect(variables?.requestScopes({ frameId: 1 })).resolves.toMatchObject({
      status: 'success'
    })
    await expect(variables?.requestVariables({ variablesReference: 1 })).resolves.toMatchObject({
      body: { variables: [{ name: 'who', value: 'child' }] }
    })
    await expect(
      manager
        .getEvaluateChannel()
        ?.requestEvaluate({ expression: '1+1', frameId: 1, context: 'repl' })
    ).resolves.toMatchObject({ body: { result: 'child:1+1' } })

    const stoppedAgain = waitForState(manager, 'stopped')
    await expect(manager.control('continue')).resolves.toMatchObject({ status: 'accepted' })
    await stoppedAgain

    await expect(manager.requestStop()).resolves.toEqual({ status: 'accepted', state: 'idle' })
    expect(pids).toHaveLength(1)
    await waitForExit(pids[0])

    const log = readLog(logPath)
    const commands = (connection: 'root' | 'child') =>
      log.filter((entry) => entry.connection === connection && entry.command !== undefined)
    const reverse = log.filter((entry) => entry.response !== undefined)

    expect(commands('root').map((entry) => entry.command)).toEqual([
      'initialize',
      'launch',
      'configurationDone'
    ])
    expect(reverse).toEqual([
      expect.objectContaining({ response: 'runInTerminal', success: false }),
      expect.objectContaining({ response: 'startDebugging', success: false }),
      expect.objectContaining({ response: 'startDebugging', success: false }),
      expect.objectContaining({ response: 'startDebugging', success: true })
    ])
    expect(commands('child').map((entry) => entry.command)).toEqual([
      'initialize',
      'launch',
      'configurationDone',
      'threads',
      'scopes',
      'variables',
      'evaluate',
      'continue',
      'terminate',
      'disconnect'
    ])
    expect(commands('child')[1]?.arguments).toEqual({
      type: 'pwa-node',
      name: 'main target',
      request: 'launch',
      __pendingTargetId: 't-1'
    })
    expect(outputs).toContainEqual({ category: 'stdout', output: 'child ready\n' })
    await waitFor(() => countTcpSockets() <= socketsBefore, 'the Main-side sockets to be released')
  }, 30_000)

  it('closes the child, root and the server process on workspace switch / app quit', async () => {
    for (const end of ['stop', 'dispose'] as const) {
      const logPath = nextLogPath()
      const pids: (number | undefined)[] = []
      const manager = createDebugSessionManager({
        startTimeoutMs: 8_000,
        startAdapterProcess: (options) => {
          const outcome = startDebugAdapterProcess(options)

          if (outcome.status === 'started') {
            pids.push(outcome.process.pid)
          }

          return outcome
        }
      })

      const socketsBefore = countTcpSockets()
      const stopped = waitForState(manager, 'stopped')
      manager.start({
        adapterId: 'pwa-node',
        adapterCommand: fixtureCommand('dap', logPath),
        launchArguments: { type: 'pwa-node', request: 'launch', program: 'main.js' },
        childSessions: CHILD_POLICY
      })
      await stopped

      if (end === 'stop') {
        manager.stop('the workspace folder changed.')
      } else {
        manager.dispose('the application is quitting.')
      }

      expect(manager.getState()).toBe('idle')
      await waitForExit(pids[0])
      await waitFor(
        () => countTcpSockets() <= socketsBefore,
        `the Main-side sockets to be released after ${end}`
      )
      expect(readLog(logPath).some((entry) => entry.connection === 'child')).toBe(true)
    }
  }, 30_000)
})
