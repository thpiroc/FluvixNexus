import { app } from 'electron'

/**
 * Main Process のログ出力を集約するモジュール。
 *
 * console.log を各所で直接呼ぶと、出力形式も「どこが出したのか」も揃わず、
 * Terminal / LSP / DAP のように出力量の多い機能が増えた時点で追えなくなる。
 * そのため Main 側のログはこのモジュールが作る Logger 経由に統一する。
 *
 * 現時点の出力先は標準出力のみ。ファイル出力（app.getPath('logs') 配下）や
 * レベルの実行時変更が必要になった場合も、変更するのは write() だけで済むようにしてある。
 *
 * Renderer 側のログはこの経路に載せない。Renderer は DevTools のコンソールを持ち、
 * Main へ送ると IPC の往復コストと引き換えに何も得られないため。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
}

/**
 * 出力する最小レベル。
 * 開発時は debug まで出し、配布ビルドでは info 以上に絞る。
 */
const minimumLevel: LogLevel = app.isPackaged ? 'info' : 'debug'

export interface Logger {
  debug(message: string, ...details: readonly unknown[]): void
  info(message: string, ...details: readonly unknown[]): void
  warn(message: string, ...details: readonly unknown[]): void
  error(message: string, ...details: readonly unknown[]): void
}

/** ISO 8601 の時刻部分だけ（HH:MM:SS.mmm）。日付は起動ログを見れば分かるため省く。 */
function timestamp(): string {
  return new Date().toISOString().slice(11, 23)
}

function write(level: LogLevel, scope: string, message: string, details: readonly unknown[]): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minimumLevel]) {
    return
  }

  const line = `${timestamp()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`

  if (level === 'error') {
    console.error(line, ...details)
  } else if (level === 'warn') {
    console.warn(line, ...details)
  } else {
    console.log(line, ...details)
  }
}

/**
 * スコープ付きの Logger を作る。
 * スコープにはモジュールの役割（'ipc' / 'window' / 'security' など）を短く与える。
 */
export function createLogger(scope: string): Logger {
  return {
    debug: (message, ...details) => write('debug', scope, message, details),
    info: (message, ...details) => write('info', scope, message, details),
    warn: (message, ...details) => write('warn', scope, message, details),
    error: (message, ...details) => write('error', scope, message, details)
  }
}
