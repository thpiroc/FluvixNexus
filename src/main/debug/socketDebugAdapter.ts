import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createConnection as createNetConnection, type Socket } from 'net'
import {
  DEBUG_ADAPTER_FORCE_KILL_GRACE_MS,
  DEBUG_ADAPTER_SOCKET_CONNECT_TIMEOUT_MS,
  DEBUG_ADAPTER_SOCKET_HOST,
  DEBUG_ADAPTER_SOCKET_MAX_CONNECTIONS,
  DEBUG_ADAPTER_SOCKET_READY_TIMEOUT_MS,
  createDebugAdapterReadinessScanner,
  type DebugAdapterSocketReadiness
} from './adapterTransport'
import type {
  DebugAdapterConnection,
  DebugAdapterConnectionHandlers,
  DebugAdapterProcessOptions,
  StartDebugAdapterProcessOutcome
} from './adapterProcess'
import { createDapConnection, type DapConnection } from './dapConnection'

/**
 * socket で DAP を話す Debug Adapter server（Session 6-15A）。
 *
 * ```
 * spawn（shell なし）
 *   └ stdout の1行に ready の合図（port）          … 待つ上限: readyTimeoutMs
 *       └ 127.0.0.1:<port> へ接続（root）          … 待つ上限: connectTimeoutMs
 *           └ openConnection() で子の接続を足す   … 同じ server・同じ上限
 * dispose
 *   └ 全接続を閉じる → kill → 終わらなければ SIGKILL（forceKillGraceMs）
 * ```
 *
 * **全部 Main が持つ。** port・プロセス・socket はこのファイルの外へ出ず、Renderer には
 * どの形でも届かない（Session Manager が知るのも DapConnection と pid だけ）。
 *
 * root の DapConnection は **spawn の直後に返す**。接続が張れるまでの送信は溜めておき、
 * 張れた時点で順に書く ── Session Manager は stdio と同じ手順で `initialize` を送ればよく、
 * transport の違いで lifecycle（§20.8）を分けずに済む。ready にならなければ root の失敗として
 * 閉じ、溜めていた request は `closed` で終わる。
 */

export type DebugAdapterSocketConnect = (options: {
  readonly host: string
  readonly port: number
}) => Socket

export function startSocketDebugAdapter(
  options: DebugAdapterProcessOptions,
  readiness: DebugAdapterSocketReadiness
): StartDebugAdapterProcessOutcome {
  const spawnAdapter = options.spawnAdapter ?? spawn
  const connectSocket: DebugAdapterSocketConnect =
    options.connectSocket ?? ((target) => createNetConnection(target))
  const readyTimeoutMs =
    options.socketTiming?.readyTimeoutMs ?? DEBUG_ADAPTER_SOCKET_READY_TIMEOUT_MS
  const connectTimeoutMs =
    options.socketTiming?.connectTimeoutMs ?? DEBUG_ADAPTER_SOCKET_CONNECT_TIMEOUT_MS
  const forceKillGraceMs =
    options.socketTiming?.forceKillGraceMs ?? DEBUG_ADAPTER_FORCE_KILL_GRACE_MS
  const name = options.command.name
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

  const scanner = createDebugAdapterReadinessScanner(readiness)
  const links = new Set<SocketLink>()

  /**
   * 1本の DAP 接続の socket 側。張れるまでの送信を溜め、張れたら順に書く。
   *
   * - `fail`  … adapter 側の理由で終わった（接続できない / 閉じた / 壊れた）。受け口へ知らせる
   * - `close` … Main が閉じた（dispose / 片付け）。受け口へは知らせない
   */
  interface SocketLink {
    readonly write: (data: Buffer) => void
    readonly receive: (chunk: Buffer) => void
    readonly bind: (connection: DapConnection) => void
    /** 接続を張り始めた socket を控える（張れる前に閉じることになっても destroy できるように）。 */
    readonly track: (socket: Socket) => void
    readonly attach: () => void
    readonly fail: (reason: string) => void
    readonly close: (reason: string) => void
  }

  function createLink(handlers: { readonly onFailed: (reason: string) => void }): SocketLink {
    let socket: Socket | null = null
    let connected = false
    let connection: DapConnection | null = null
    let queue: Buffer[] = []
    let done = false

    function release(reason: string): void {
      done = true
      queue = []
      links.delete(link)

      if (socket !== null) {
        socket.removeAllListeners('data')
        socket.destroy()
        socket = null
      }

      connection?.dispose(reason)
    }

    const link: SocketLink = {
      write: (data) => {
        if (done) {
          throw new Error('the DAP connection is closed.')
        }

        if (!connected || socket === null) {
          queue.push(data)
          return
        }

        socket.write(data)
      },
      receive: (chunk) => {
        if (!done) {
          connection?.receive(chunk)
        }
      },
      bind: (next) => {
        connection = next
      },
      track: (next) => {
        if (done) {
          next.destroy()
          return
        }

        socket = next
      },
      attach: () => {
        if (done || socket === null) {
          return
        }

        connected = true
        const waiting = queue
        queue = []

        for (const data of waiting) {
          socket.write(data)
        }
      },
      fail: (reason) => {
        if (done) {
          return
        }

        release(reason)
        handlers.onFailed(reason)
      },
      close: (reason) => {
        if (!done) {
          release(reason)
        }
      }
    }

    links.add(link)
    return link
  }

  let closed = false
  let exited = false
  let port: number | null = null
  let forceKillTimer: ReturnType<typeof setTimeout> | null = null

  const readyTimer = setTimeout(() => {
    failAdapter(`${name} did not report a listening port in time.`)
  }, readyTimeoutMs)
  readyTimer.unref?.()

  const rootLink = createLink({
    onFailed: (reason) => {
      failAdapter(`the root DAP connection failed: ${reason}`)
    }
  })

  const rootConnection = createDapConnection({
    send: rootLink.write,
    onEvent: options.onEvent,
    onAdapterRequest: options.onAdapterRequest,
    onStartDebugging: options.onStartDebugging,
    onBrokenStream: (reason) => {
      options.onBrokenStream?.(reason)
      failAdapter(`the DAP message stream is broken: ${reason}`)
    },
    onProtocolWarning: options.onProtocolWarning
  })
  rootLink.bind(rootConnection)

  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')

    if (port !== null || closed) {
      options.onStdout?.(trimForLog(text))
      return
    }

    const scan = scanner.push(text)

    switch (scan.status) {
      case 'waiting':
        return

      case 'invalid':
        failAdapter(`${name} did not become ready: ${scan.reason}`)
        return

      case 'ready':
        clearTimeout(readyTimer)
        port = scan.port
        connectLink(rootLink)
        return
    }
  })

  child.stderr.on('data', (chunk: Buffer) => {
    options.onStderr?.(trimForLog(chunk.toString('utf8')))
  })

  child.stdin.on('error', () => {
    // socket の adapter は stdin を読まない。閉じられていても害は無い。
  })

  child.on('error', (cause) => {
    failAdapter(`the debug adapter process failed: ${cause.message}`)
  })

  child.on('exit', (code, signal) => {
    exited = true

    if (forceKillTimer !== null) {
      clearTimeout(forceKillTimer)
      forceKillTimer = null
    }

    if (closed) {
      return
    }

    if (port === null) {
      const how = signal === null ? `code=${code ?? -1}` : `signal=${signal}`
      failAdapter(`${name} exited before it was ready (${how}).`)
      return
    }

    closed = true
    clearTimeout(readyTimer)
    closeAllLinks('the debug adapter process exited.')
    options.onClose?.('close', code, signal)
  })

  function connectLink(link: SocketLink): void {
    if (port === null) {
      link.fail('the adapter is not listening yet.')
      return
    }

    let socket: Socket

    try {
      socket = connectSocket({ host: DEBUG_ADAPTER_SOCKET_HOST, port })
    } catch (cause) {
      link.fail(`connecting failed: ${cause instanceof Error ? cause.message : String(cause)}`)
      return
    }

    link.track(socket)

    const timer = setTimeout(() => {
      link.fail('connecting to the adapter timed out.')
    }, connectTimeoutMs)
    timer.unref?.()

    socket.once('connect', () => {
      clearTimeout(timer)
      socket.setNoDelay?.(true)
      link.attach()
    })

    socket.on('data', (chunk: Buffer) => {
      link.receive(chunk)
    })

    socket.on('error', (cause) => {
      clearTimeout(timer)
      link.fail(`socket error: ${cause.message}`)
    })

    socket.on('close', () => {
      clearTimeout(timer)
      link.fail('the socket closed.')
    })
  }

  function openConnection(handlers: DebugAdapterConnectionHandlers): DebugAdapterConnection | null {
    if (closed || port === null || links.size >= DEBUG_ADAPTER_SOCKET_MAX_CONNECTIONS) {
      return null
    }

    let ended = false
    const end = (reason: string): void => {
      if (ended) {
        return
      }

      ended = true
      handlers.onClosed(reason)
    }

    const link = createLink({ onFailed: end })
    const connection = createDapConnection({
      send: link.write,
      onEvent: handlers.onEvent,
      onAdapterRequest: handlers.onAdapterRequest,
      onBrokenStream: (reason) => {
        link.fail(`the DAP message stream is broken: ${reason}`)
      },
      onProtocolWarning: handlers.onProtocolWarning
    })

    link.bind(connection)
    connectLink(link)

    return {
      connection,
      dispose: (reason) => {
        ended = true
        link.close(reason)
      }
    }
  }

  function closeAllLinks(reason: string): void {
    for (const link of [...links]) {
      link.close(reason)
    }
  }

  function killProcess(): void {
    if (exited) {
      return
    }

    try {
      child.kill()
    } catch {
      // 既に終わっているなら片付けとしては成功。
    }

    forceKillTimer = setTimeout(() => {
      forceKillTimer = null

      if (exited) {
        return
      }

      options.onProtocolWarning?.(`${name} did not exit after kill; sending SIGKILL.`)

      try {
        child.kill('SIGKILL')
      } catch {
        // 同上。
      }
    }, forceKillGraceMs)
    forceKillTimer.unref?.()
  }

  /** ready にならない / root の接続が落ちた / プロセスが失敗した。全部閉じて kill する。 */
  function failAdapter(reason: string): void {
    if (closed) {
      return
    }

    closed = true
    clearTimeout(readyTimer)
    closeAllLinks(reason)
    killProcess()
    options.onError?.(new Error(reason))
    options.onClose?.('error', null, null)
  }

  function dispose(reason: string): void {
    if (closed) {
      return
    }

    closed = true
    clearTimeout(readyTimer)
    closeAllLinks(reason)
    killProcess()
    options.onClose?.('dispose', null, null)
  }

  return {
    status: 'started',
    process: {
      connection: rootConnection,
      pid: child.pid,
      transport: 'socket',
      openConnection,
      dispose
    }
  }
}

function trimForLog(value: string): string {
  const line = value.replace(/\s+$/, '')

  return line.length <= 500 ? line : `${line.slice(0, 500)}...`
}
