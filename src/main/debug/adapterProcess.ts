import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio
} from 'child_process'
import type { DebugAdapterCommand } from './adapterCatalog'
import { createDapConnection, type DapConnection, type DapConnectionOptions } from './dapConnection'
import { startSocketDebugAdapter, type DebugAdapterSocketConnect } from './socketDebugAdapter'

/**
 * Debug Adapter process foundation。
 *
 * Main だけがこの層を使い、Renderer へ process 情報を返す API は作らない。
 * ここが持つのは spawn / stream 接続 / stderr / error / close / dispose までで、
 * initialize や launch の状態機械は Session 6-2 以降に残す。
 *
 * Session 6-15A で transport を2つにした（main/debug/adapterTransport.ts）。
 * `command.transport` が無い / `stdio` なら 6-14 までと1行も変わらない経路を通り、
 * `socket` なら main/debug/socketDebugAdapter.ts が server の起動・ready・接続を持つ。
 */

export type DebugAdapterProcessCloseReason = 'error' | 'close' | 'dispose'

export interface DebugAdapterProcessOptions {
  readonly command: DebugAdapterCommand
  readonly onEvent: DapConnectionOptions['onEvent']
  readonly onAdapterRequest?: DapConnectionOptions['onAdapterRequest']
  /** root の接続に届いた `startDebugging` にだけ答える（Session 6-15A）。 */
  readonly onStartDebugging?: DapConnectionOptions['onStartDebugging']
  readonly onProtocolWarning?: (reason: string) => void
  readonly onBrokenStream?: (reason: string) => void
  readonly onStderr?: (chunk: string) => void
  /** socket の adapter が ready の後に stdout へ書いたもの（ログ用。Session 6-15A）。 */
  readonly onStdout?: (chunk: string) => void
  readonly onError?: (error: Error) => void
  readonly onClose?: (
    reason: DebugAdapterProcessCloseReason,
    code: number | null,
    signal: NodeJS.Signals | null
  ) => void
  readonly spawnAdapter?: DebugAdapterSpawn
  readonly createConnection?: typeof createDapConnection
  /** 以下2つは socket の adapter だけが使う（Session 6-15A）。テストが差し替える。 */
  readonly connectSocket?: DebugAdapterSocketConnect
  readonly socketTiming?: {
    readonly readyTimeoutMs?: number
    readonly connectTimeoutMs?: number
    readonly forceKillGraceMs?: number
  }
}

export type StartDebugAdapterProcessOutcome =
  | { readonly status: 'started'; readonly process: DebugAdapterProcess }
  | { readonly status: 'spawn-failed'; readonly detail: string }

/** 同じ adapter へ足す DAP 接続の受け口（Session 6-15A。子セッション用）。 */
export interface DebugAdapterConnectionHandlers {
  readonly onEvent: DapConnectionOptions['onEvent']
  readonly onAdapterRequest?: DapConnectionOptions['onAdapterRequest']
  readonly onProtocolWarning?: (reason: string) => void
  /** 接続が adapter 側から閉じた / 張れなかった / 流れが壊れた（`dispose` では呼ばれない）。 */
  readonly onClosed: (reason: string) => void
}

export interface DebugAdapterConnection {
  readonly connection: DapConnection
  readonly dispose: (reason: string) => void
}

export interface DebugAdapterProcess {
  /** root の DAP 接続。 */
  readonly connection: DapConnection
  readonly pid: number | undefined
  /** 省略は `stdio`（Session 6-15A より前の形）。 */
  readonly transport?: 'stdio' | 'socket'
  /**
   * 同じ adapter へもう1本の DAP 接続を張る（Session 6-15A）。
   *
   * **stdio の adapter には無い**（stdin / stdout は1組しか無い）。socket の adapter でも、
   * ready の前・閉じた後・上限に達したときは null。
   */
  readonly openConnection?: (
    handlers: DebugAdapterConnectionHandlers
  ) => DebugAdapterConnection | null
  readonly dispose: (reason: string) => void
}

export type DebugAdapterSpawn = (
  file: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams

export function startDebugAdapterProcess(
  options: DebugAdapterProcessOptions
): StartDebugAdapterProcessOutcome {
  const transport = options.command.transport

  if (transport !== undefined && transport.kind === 'socket') {
    return startSocketDebugAdapter(options, transport.readiness)
  }

  const spawnAdapter = options.spawnAdapter ?? spawn
  let child: ChildProcessWithoutNullStreams

  try {
    child = spawnAdapter(options.command.file, [...options.command.args], {
      cwd: options.command.cwd,
      env: options.command.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true
    })
  } catch (cause) {
    const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)

    return { status: 'spawn-failed', detail }
  }

  const createConnection = options.createConnection ?? createDapConnection
  let closed = false

  const connection = createConnection({
    send: (data) => {
      child.stdin.write(data)
    },
    onEvent: options.onEvent,
    onAdapterRequest: options.onAdapterRequest,
    onStartDebugging: options.onStartDebugging,
    onBrokenStream: (reason) => {
      options.onBrokenStream?.(reason)
      dispose('the DAP message stream is broken.')
    },
    onProtocolWarning: options.onProtocolWarning
  })

  child.stdout.on('data', (chunk: Buffer) => {
    connection.receive(chunk)
  })

  child.stderr.on('data', (chunk: Buffer) => {
    options.onStderr?.(trimForLog(chunk.toString('utf8')))
  })

  child.stdin.on('error', (cause) => {
    options.onProtocolWarning?.(`writing to ${options.command.name} stdin failed: ${cause.message}`)
  })

  child.on('error', (cause) => {
    if (closed) {
      return
    }

    closed = true
    connection.dispose(`the debug adapter process failed: ${cause.message}`)
    options.onError?.(cause)
    options.onClose?.('error', null, null)
  })

  child.on('close', (code, signal) => {
    if (closed) {
      return
    }

    closed = true
    connection.dispose('the debug adapter process closed.')
    options.onClose?.('close', code, signal)
  })

  function dispose(reason: string): void {
    if (closed) {
      return
    }

    closed = true
    connection.dispose(reason)

    try {
      child.kill()
    } catch {
      // 既に終わっているなら片付けとしては成功。
    }

    options.onClose?.('dispose', null, null)
  }

  return {
    status: 'started',
    process: {
      connection,
      pid: child.pid,
      dispose
    }
  }
}

function trimForLog(value: string): string {
  const line = value.replace(/\s+$/, '')

  return line.length <= 500 ? line : `${line.slice(0, 500)}...`
}
