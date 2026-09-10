import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import { startDebugAdapterProcess, type DebugAdapterSpawn } from './adapterProcess'
import type { DebugAdapterCommand } from './adapterCatalog'
import type { DapConnection } from './dapConnection'

class MockStream extends EventEmitter {
  readonly write = vi.fn()
}

class MockChild extends EventEmitter {
  readonly stdin = new MockStream()
  readonly stdout = new MockStream()
  readonly stderr = new MockStream()
  readonly kill = vi.fn()
  readonly pid = 1234
}

function createCommand(): DebugAdapterCommand {
  return {
    name: 'Mock Debug Adapter',
    file: 'C:\\Tools\\mock-adapter.exe',
    args: ['--stdio'],
    cwd: 'D:\\Workspace',
    env: { PATH: 'C:\\Tools' }
  }
}

function createConnection(): DapConnection {
  return {
    receive: vi.fn(),
    request: vi.fn(),
    dispose: vi.fn()
  }
}

describe('startDebugAdapterProcess', () => {
  it('adapter を Main-owned command から shell なしで起動する', () => {
    const child = new MockChild()
    const spawnAdapter = vi.fn<DebugAdapterSpawn>(() => child as never)

    const outcome = startDebugAdapterProcess({
      command: createCommand(),
      onEvent: vi.fn(),
      spawnAdapter
    })

    expect(outcome.status).toBe('started')
    expect(spawnAdapter).toHaveBeenCalledWith('C:\\Tools\\mock-adapter.exe', ['--stdio'], {
      cwd: 'D:\\Workspace',
      env: { PATH: 'C:\\Tools' },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true
    })
  })

  it('stdout を DAP connection へ渡し、stderr はログ用文字列にする', () => {
    const child = new MockChild()
    const connection = createConnection()
    const onStderr = vi.fn()

    startDebugAdapterProcess({
      command: createCommand(),
      onEvent: vi.fn(),
      onStderr,
      spawnAdapter: () => child as never,
      createConnection: () => connection
    })

    child.stdout.emit('data', Buffer.from('frame'))
    child.stderr.emit('data', Buffer.from('adapter log\r\n'))

    expect(connection.receive).toHaveBeenCalledWith(Buffer.from('frame'))
    expect(onStderr).toHaveBeenCalledWith('adapter log')
  })

  it('process error で connection を閉じて通知する', () => {
    const child = new MockChild()
    const connection = createConnection()
    const onError = vi.fn()
    const onClose = vi.fn()

    startDebugAdapterProcess({
      command: createCommand(),
      onEvent: vi.fn(),
      onError,
      onClose,
      spawnAdapter: () => child as never,
      createConnection: () => connection
    })

    const error = new Error('spawn failed')
    child.emit('error', error)

    expect(connection.dispose).toHaveBeenCalledWith(
      'the debug adapter process failed: spawn failed'
    )
    expect(onError).toHaveBeenCalledWith(error)
    expect(onClose).toHaveBeenCalledWith('error', null, null)
  })

  it('process close で pending request cleanup のため connection を閉じる', () => {
    const child = new MockChild()
    const connection = createConnection()
    const onClose = vi.fn()

    startDebugAdapterProcess({
      command: createCommand(),
      onEvent: vi.fn(),
      onClose,
      spawnAdapter: () => child as never,
      createConnection: () => connection
    })

    child.emit('close', 0, null)

    expect(connection.dispose).toHaveBeenCalledWith('the debug adapter process closed.')
    expect(onClose).toHaveBeenCalledWith('close', 0, null)
  })

  it('dispose は adapter を kill して一度だけ片付ける', () => {
    const child = new MockChild()
    const connection = createConnection()
    const onClose = vi.fn()
    const outcome = startDebugAdapterProcess({
      command: createCommand(),
      onEvent: vi.fn(),
      onClose,
      spawnAdapter: () => child as never,
      createConnection: () => connection
    })

    expect(outcome.status).toBe('started')

    if (outcome.status === 'started') {
      outcome.process.dispose('test cleanup')
      outcome.process.dispose('again')
    }

    expect(connection.dispose).toHaveBeenCalledTimes(1)
    expect(connection.dispose).toHaveBeenCalledWith('test cleanup')
    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('dispose', null, null)
  })

  it('spawn が同期的に失敗しても例外を外へ出さない', () => {
    const outcome = startDebugAdapterProcess({
      command: createCommand(),
      onEvent: vi.fn(),
      spawnAdapter: () => {
        throw new Error('boom')
      }
    })

    expect(outcome).toEqual({ status: 'spawn-failed', detail: 'Error: boom' })
  })

  it('real stdio process の mock adapter と DAP request / response を1往復できる', async () => {
    const outcome = startDebugAdapterProcess({
      command: {
        name: 'Node mock DAP adapter',
        file: process.execPath,
        args: ['-e', MOCK_DAP_ADAPTER_SCRIPT],
        cwd: process.cwd(),
        env: process.env
      },
      onEvent: vi.fn()
    })

    expect(outcome.status).toBe('started')

    if (outcome.status !== 'started') {
      return
    }

    await expect(outcome.process.connection.request('ping', { value: 'ok' })).resolves.toEqual({
      status: 'success',
      body: { echo: { value: 'ok' } }
    })

    outcome.process.dispose('smoke complete')
  })
})

const MOCK_DAP_ADAPTER_SCRIPT = String.raw`
let pending = Buffer.alloc(0)
let nextSeq = 1
const separator = '\r\n\r\n'

process.stdin.on('data', (chunk) => {
  pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])

  for (;;) {
    const separatorAt = pending.indexOf(separator)

    if (separatorAt < 0) {
      return
    }

    const header = pending.subarray(0, separatorAt).toString('ascii')
    const match = /content-length:\s*(\d+)/i.exec(header)

    if (match === null) {
      process.exit(2)
    }

    const bodyAt = separatorAt + separator.length
    const bodyEnd = bodyAt + Number(match[1])

    if (pending.length < bodyEnd) {
      return
    }

    const request = JSON.parse(pending.subarray(bodyAt, bodyEnd).toString('utf8'))
    pending = pending.subarray(bodyEnd)

    const response = Buffer.from(
      JSON.stringify({
        seq: nextSeq,
        type: 'response',
        request_seq: request.seq,
        success: true,
        command: request.command,
        body: { echo: request.arguments }
      }),
      'utf8'
    )

    nextSeq += 1
    process.stdout.write('Content-Length: ' + response.byteLength + separator)
    process.stdout.write(response)
  }
})
`
