import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import type { McpTransport, McpTransportClose } from './mcpClient'
import type { McpServerCommand } from './mcpServerLaunch'

/**
 * MCP サーバーを子プロセスとして立て、その stdin / stdout を経路にする。
 *
 * ## 閉じ方（MCP の stdio の作法）
 *
 * ```
 * 1. stdin を閉じる          … サーバーは読み終わりを見て自分で終わる
 * 2. 待つ（CLOSE_GRACE_MS）
 * 3. まだ居れば kill         … Windows では TerminateProcess
 * 4. 待つ（CLOSE_GRACE_MS）  … それでも exit が来なければ諦めて返す
 * ```
 *
 * `cmd.exe` を挟まずに node を直接起動している（mcpServerCatalog.ts）ので、
 * kill が届く相手はサーバーそのものになる。
 *
 * ## stderr は電文ではない
 *
 * サーバーのログなので、行に切って `onStderrLine` へ渡す。token が混ざりうるので、
 * 伏せるのは受け取る側（mcpConnections.ts）の仕事。行の数には上限を置く。
 */

/** stdin を閉じてから、そして kill してから、終わるのを待つ時間。 */
export const MCP_CLOSE_GRACE_MS = 2_000

/** 1回の接続で stderr から拾う行の上限（それ以上は数だけ数える）。 */
const STDERR_MAX_LINES = 200

/** stderr の1行の上限（文字数）。 */
const STDERR_MAX_LINE_LENGTH = 1_000

export interface McpStdioTransportOptions {
  readonly command: McpServerCommand
  readonly env: Record<string, string | undefined>
  readonly cwd: string
  readonly onStderrLine?: (line: string) => void
  /** 閉じ終わった後に、拾いきれなかった stderr の行数を知らせる。 */
  readonly onStderrDropped?: (count: number) => void
  readonly closeGraceMs?: number
}

export function createMcpStdioTransport(options: McpStdioTransportOptions): McpTransport {
  const closeGraceMs = options.closeGraceMs ?? MCP_CLOSE_GRACE_MS
  const dataListeners: ((chunk: Buffer) => void)[] = []
  const closeListeners: ((close: McpTransportClose) => void)[] = []

  let closeInfo: McpTransportClose | null = null
  let exited = false
  let exitWaiters: (() => void)[] = []

  function announceClose(close: McpTransportClose): void {
    if (closeInfo !== null) {
      return
    }

    closeInfo = close

    for (const listener of closeListeners) {
      listener(close)
    }
  }

  function markExited(): void {
    exited = true
    const waiters = exitWaiters
    exitWaiters = []

    for (const resolve of waiters) {
      resolve()
    }
  }

  let child: ChildProcessWithoutNullStreams | null = null

  try {
    child = spawn(options.command.file, [...options.command.args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // シェルを通さない（引数が文字列として読み直されない）。
      shell: false,
      windowsHide: true
    })
  } catch (cause) {
    /*
      同期的に投げる形（EINVAL など）。リスナーはまだ登録されていないので、
      登録された時点で伝える（下の onClose）。
    */
    closeInfo = { kind: 'spawn-failed', detail: describe(cause) }
    exited = true
  }

  if (child !== null) {
    let started = false
    const running = child

    running.once('spawn', () => {
      started = true
    })

    running.on('error', (cause) => {
      // 起動前の error は「起動できなかった」（ENOENT・EACCES）。後の error は kill の失敗など。
      if (!started) {
        announceClose({ kind: 'spawn-failed', detail: describe(cause) })
        markExited()
      }
    })

    running.on('exit', (code, signal) => {
      announceClose({
        kind: 'exited',
        detail: signal === null ? `exited with code ${String(code)}.` : `killed by ${signal}.`
      })
      markExited()
    })

    running.stdout.on('data', (chunk: Buffer) => {
      for (const listener of dataListeners) {
        listener(chunk)
      }
    })

    // 相手が先に閉じた stdin へ書くと EPIPE が非同期に来る。落とさずに受け止める。
    running.stdin.on('error', () => {})

    let stderrRest = ''
    let stderrLines = 0
    let stderrDropped = 0

    running.stderr.setEncoding('utf8')
    running.stderr.on('data', (text: string) => {
      const lines = (stderrRest + text).split(/\r?\n/)
      stderrRest = (lines.pop() ?? '').slice(-STDERR_MAX_LINE_LENGTH)

      for (const line of lines) {
        if (line.trim().length === 0) {
          continue
        }

        if (stderrLines >= STDERR_MAX_LINES) {
          stderrDropped += 1
          continue
        }

        stderrLines += 1
        options.onStderrLine?.(line.slice(0, STDERR_MAX_LINE_LENGTH))
      }
    })

    running.once('exit', () => {
      if (stderrDropped > 0) {
        options.onStderrDropped?.(stderrDropped)
      }
    })
  }

  function waitForExit(timeoutMs: number): Promise<boolean> {
    if (exited) {
      return Promise.resolve(true)
    }

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        exitWaiters = exitWaiters.filter((waiter) => waiter !== onExit)
        resolve(false)
      }, timeoutMs)

      function onExit(): void {
        clearTimeout(timer)
        resolve(true)
      }

      exitWaiters.push(onExit)
    })
  }

  let closing: Promise<void> | null = null

  return {
    send: (line: string): void => {
      if (child === null || closeInfo !== null) {
        throw new Error('the MCP server is not running.')
      }

      child.stdin.write(line)
    },

    onData: (listener): void => {
      dataListeners.push(listener)
    },

    onClose: (listener): void => {
      closeListeners.push(listener)

      // 起動が同期的に失敗していた場合は、登録された時点で伝える。
      if (closeInfo !== null) {
        listener(closeInfo)
      }
    },

    close: (): Promise<void> => {
      closing ??= (async () => {
        if (child === null || exited) {
          return
        }

        child.stdin.end()

        if (await waitForExit(closeGraceMs)) {
          return
        }

        try {
          child.kill()
        } catch {
          // 既に終わっていた。
        }

        if (await waitForExit(closeGraceMs)) {
          return
        }

        try {
          child.kill('SIGKILL')
        } catch {
          // 既に終わっていた。
        }
      })()

      return closing
    },

    terminate: (): void => {
      if (child === null || exited) {
        return
      }

      try {
        child.kill()
      } catch {
        // 既に終わっていた。
      }
    }
  }
}

function describe(cause: unknown): string {
  if (cause instanceof Error) {
    const code = (cause as { readonly code?: unknown }).code
    return typeof code === 'string' ? `${cause.name} (${code})` : cause.name
  }

  return 'unknown error'
}
