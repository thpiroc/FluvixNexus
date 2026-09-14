/**
 * Debug Adapter の繋ぎ方（Session 6-15A。Electron / child_process 非依存・テスト対象）。
 *
 * DAP のフレーミング（dapMessage.ts）と、その上の request / response（dapConnection.ts）は
 * stream の種類を知らない（docs/ARCHITECTURE.md §20.7「framing と transport を分ける」）。
 * ここに置くのは**どの stream を繋ぐか**の Main 内部の決めだけで、IPC にも Profile にも載らない。
 *
 * | kind     | 繋ぎ方                                                                        |
 * | -------- | ----------------------------------------------------------------------------- |
 * | `stdio`  | adapter のプロセスの stdin / stdout がそのまま DAP（debugpy / netcoredbg）    |
 * | `socket` | adapter が **server** として立ち、stdout に待ち受けの port を出す。Main が    |
 * |          | 127.0.0.1 へ接続する。1つの server に DAP の接続が複数張られうる（子セッション） |
 *
 * 繋ぐ先の host は**常に 127.0.0.1**（Main が決める）。adapter の出力から読むのは port だけで、
 * host を名乗られても loopback 以外なら ready として扱わない。
 */

/**
 * adapter が「待ち受けを始めた」と分かる合図（Main-side metadata）。
 *
 * v1 は stdout の1行に正規表現を当てる1通りだけ。**名前付きグループ `port` が必須**で、
 * `host` があれば loopback であることを確かめる。adapter 固有の文言はこの表の側
 * （catalog の行）が持ち、transport の実装は文言を知らない。
 */
export interface DebugAdapterSocketReadiness {
  readonly kind: 'stdout-pattern'
  readonly pattern: RegExp
}

export type DebugAdapterTransport =
  | { readonly kind: 'stdio' }
  | { readonly kind: 'socket'; readonly readiness: DebugAdapterSocketReadiness }

export const DEBUG_ADAPTER_STDIO_TRANSPORT: DebugAdapterTransport = { kind: 'stdio' }

/** stdout に port が出るまで待つ長さ。過ぎたら adapter を片付けて起動失敗にする。 */
export const DEBUG_ADAPTER_SOCKET_READY_TIMEOUT_MS = 10_000

/** port が分かってから TCP の接続が張れるまで待つ長さ（接続1本ごと）。 */
export const DEBUG_ADAPTER_SOCKET_CONNECT_TIMEOUT_MS = 5_000

/** kill の後、プロセスが終わらなければ SIGKILL を送るまでの長さ。 */
export const DEBUG_ADAPTER_FORCE_KILL_GRACE_MS = 2_000

/** ready の合図を探す間に溜める stdout の上限。越えたら ready にならなかったものとする。 */
export const DEBUG_ADAPTER_READINESS_MAX_BUFFER = 64 * 1024

/** 1つの adapter server へ Main が張る DAP 接続の上限（root を含む）。 */
export const DEBUG_ADAPTER_SOCKET_MAX_CONNECTIONS = 4

/** 接続する host。adapter の出力からは決めない。 */
export const DEBUG_ADAPTER_SOCKET_HOST = '127.0.0.1'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export type DebugAdapterReadinessScan =
  | { readonly status: 'waiting' }
  | { readonly status: 'ready'; readonly port: number }
  | { readonly status: 'invalid'; readonly reason: string }

export interface DebugAdapterReadinessScanner {
  /** stdout の断片を足す。行が揃ったところで合図を探す。 */
  readonly push: (chunk: string) => DebugAdapterReadinessScan
}

export function createDebugAdapterReadinessScanner(
  readiness: DebugAdapterSocketReadiness,
  maxBuffer: number = DEBUG_ADAPTER_READINESS_MAX_BUFFER
): DebugAdapterReadinessScanner {
  /*
    `g` / `y` の付いた正規表現は `lastIndex` を持ち回り、同じ行に2回当てると結果が変わる。
    表の書き方に依らず同じ答えになるよう、フラグを落として作り直す。
  */
  const pattern = new RegExp(readiness.pattern.source, readiness.pattern.flags.replace(/[gy]/g, ''))
  let pending = ''
  let settled: DebugAdapterReadinessScan | null = null

  function scanLine(line: string): DebugAdapterReadinessScan {
    const match = pattern.exec(line)

    if (match === null) {
      return { status: 'waiting' }
    }

    const rawPort = match.groups?.port

    if (rawPort === undefined || !/^[0-9]{1,5}$/.test(rawPort)) {
      return { status: 'invalid', reason: 'the listening line did not carry a valid port.' }
    }

    const port = Number(rawPort)

    if (port < 1 || port > 65_535) {
      return { status: 'invalid', reason: 'the listening port is out of range.' }
    }

    const host = match.groups?.host

    if (host !== undefined && !LOOPBACK_HOSTS.has(host.toLowerCase())) {
      return { status: 'invalid', reason: 'the adapter is not listening on a loopback address.' }
    }

    return { status: 'ready', port }
  }

  return {
    push: (chunk) => {
      if (settled !== null) {
        return settled
      }

      pending += chunk

      const lines = pending.split('\n')
      pending = lines.pop() ?? ''

      for (const line of lines) {
        const scan = scanLine(line.replace(/\r$/, ''))

        if (scan.status !== 'waiting') {
          settled = scan
          return scan
        }
      }

      if (pending.length > maxBuffer) {
        settled = {
          status: 'invalid',
          reason: 'the adapter wrote too much output before it was ready.'
        }
        return settled
      }

      return { status: 'waiting' }
    }
  }
}
