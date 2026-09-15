import { app } from 'electron'
import { join } from 'path'
import { createLogFileSink, LOG_DIRECTORY_NAME, nodeLogFileSystem } from './logFile'
import { formatLogFileLine } from './logRedaction'

/**
 * Main Process のログ出力を集約するモジュール。
 *
 * console.log を各所で直接呼ぶと、出力形式も「どこが出したのか」も揃わず、
 * Terminal / LSP / DAP のように出力量の多い機能が増えた時点で追えなくなる。
 * そのため Main 側のログはこのモジュールが作る Logger 経由に統一する。
 *
 * 出力先は2つ（Session 7-1C でファイルを足した）。
 *
 * ```
 * console … 開発時に手元の端末で見るもの。従来どおり（開発時は debug 以上、配布版は info 以上）。加工しない
 * ファイル … 配布版で利用者から受け取るもの。<userData>/logs/main.log に info 以上だけ。
 *            絶対パス・認証情報を伏せ、1行に畳む（logRedaction.ts）。上限と世代は logFile.ts
 * ```
 *
 * 呼び出し側は今までどおりパスを含めて書いてよい ── ファイルへの伏せ方はここで一律に決まる。
 * ファイルに書けなくてもアプリは止めない（console に1度だけ知らせる）。
 *
 * Renderer 側のログはこの経路に載せない。Renderer は DevTools のコンソールを持ち、
 * Main へ送ると IPC の往復コストと引き換えに何も得られないため。ログファイルを
 * Renderer から読む / 開く口も作らない。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
}

/**
 * console へ出す最小レベル。
 * 開発時は debug まで出し、配布ビルドでは info 以上に絞る。
 */
const minimumLevel: LogLevel = app.isPackaged ? 'info' : 'debug'

/**
 * ファイルへ書く最小レベル（Session 7-1C）。開発時も配布版も info 以上。
 * debug は LSP の stderr や DAP の往復を1行ずつ出すため、ファイルの上限をすぐに使い切る。
 */
const FILE_MINIMUM_LEVEL: LogLevel = 'info'

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

const fileSink = createLogFileSink({
  resolveDirectory: () => join(app.getPath('userData'), LOG_DIRECTORY_NAME),
  fileSystem: nodeLogFileSystem,
  // 起動ごとの区切り。版と実行環境の分類だけで、パスは載せない。
  createHeader: () =>
    formatLogFileLine({
      time: new Date(),
      level: 'info',
      scope: 'logger',
      message:
        `Fluvix Nexus ${app.getVersion()} started ` +
        `(electron ${process.versions.electron ?? '-'}, ${process.platform} ${process.arch}, ` +
        `${app.isPackaged ? 'packaged' : 'development'}, pid ${process.pid})`,
      details: []
    }),
  onFailure: (cause) => {
    console.warn(`${timestamp()} WARN  [logger] the log file is disabled for this session.`, cause)
  }
})

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

  if (LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[FILE_MINIMUM_LEVEL]) {
    writeToFile(level, scope, message, details)
  }
}

function writeToFile(
  level: LogLevel,
  scope: string,
  message: string,
  details: readonly unknown[]
): void {
  let line: string

  try {
    line = formatLogFileLine({ time: new Date(), level, scope, message, details })
  } catch {
    // details の getter が投げるような値でも、ログのせいで呼び出し側を止めない。
    return
  }

  fileSink.write(line)
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
