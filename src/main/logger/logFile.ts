import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'fs'
import { isAbsolute, join } from 'path'

/**
 * ログファイルの書き出し先（Session 7-1C。Electron 非依存・テスト対象）。
 *
 * ```
 * 置き場所 … <userData>/logs/main.log（Main が決める Workspace の外。Renderer から指せる口は無い）
 * 上限     … 1 MiB。超える前に main.old.log へ回して1世代だけ残す（合計 2 MiB 程度で止まる）
 * 失敗     … そのセッションの間はファイルへ書くのをやめ、1度だけ知らせる。アプリは止めない
 * ```
 *
 * **書き込みは同期**（appendFileSync）。非同期の列に溜めると、いちばん欲しい「落ちる直前の行」が
 * 残らない。ファイルへ書くのは info 以上だけなので（logger/index.ts）、回数は Git / LSP /
 * Terminal / Debug の節目の数に収まる。
 *
 * 置き場所が取れない・絶対パスでないときは**黙って書かない**。Electron を差し替えたテストでは
 * `app.getPath` が無いか空文字を返すため、ここで書くと作業ディレクトリに `logs/` ができる。
 */

export const LOG_DIRECTORY_NAME = 'logs'
export const LOG_FILE_NAME = 'main.log'
export const ROTATED_LOG_FILE_NAME = 'main.old.log'
export const LOG_FILE_MAX_BYTES = 1024 * 1024

export interface LogFileSystem {
  /** 途中のフォルダも作る。在ってもよい。 */
  readonly mkdir: (path: string) => void
  /** バイト数。無ければ null。 */
  readonly size: (path: string) => number | null
  readonly append: (path: string, text: string) => void
  readonly rename: (from: string, to: string) => void
  /** 無くても失敗にしない。 */
  readonly remove: (path: string) => void
}

export interface LogFileSinkOptions {
  /** 置き場所のフォルダ。取れない（null / 例外）・絶対パスでなければ、ファイルへは書かない。 */
  readonly resolveDirectory: () => string | null
  readonly fileSystem: LogFileSystem
  readonly maxBytes?: number
  /** 開いた直後に書く1行（版・platform など）。パスを含めないこと。 */
  readonly createHeader?: () => string
  /** 書けなくなったときに1度だけ呼ばれる。 */
  readonly onFailure?: (cause: unknown) => void
}

export interface LogFileSink {
  /** 1行（改行を含まないもの）を書く。失敗しても投げない。 */
  readonly write: (line: string) => void
}

export function createLogFileSink(options: LogFileSinkOptions): LogFileSink {
  const { fileSystem } = options
  const maxBytes = options.maxBytes ?? LOG_FILE_MAX_BYTES
  let state: 'pending' | 'open' | 'disabled' = 'pending'
  let filePath = ''
  let rotatedPath = ''
  let size = 0

  function open(): boolean {
    let directory: string | null

    try {
      directory = options.resolveDirectory()
    } catch {
      directory = null
    }

    if (directory === null || directory.length === 0 || !isAbsolute(directory)) {
      state = 'disabled'
      return false
    }

    filePath = join(directory, LOG_FILE_NAME)
    rotatedPath = join(directory, ROTATED_LOG_FILE_NAME)
    fileSystem.mkdir(directory)
    size = fileSystem.size(filePath) ?? 0

    // 前回までで上限に届いていれば、今回の行は新しいファイルから始める。
    if (size >= maxBytes) {
      rotate()
    }

    state = 'open'

    if (options.createHeader !== undefined) {
      append(options.createHeader())
    }

    return true
  }

  function rotate(): void {
    fileSystem.remove(rotatedPath)
    fileSystem.rename(filePath, rotatedPath)
    size = 0
  }

  function append(line: string): void {
    const text = `${line}\n`
    const bytes = Buffer.byteLength(text, 'utf8')

    if (size > 0 && size + bytes > maxBytes) {
      rotate()
    }

    fileSystem.append(filePath, text)
    size += bytes
  }

  function write(line: string): void {
    if (state === 'disabled') {
      return
    }

    try {
      if (state === 'pending' && !open()) {
        return
      }

      append(line)
    } catch (cause) {
      state = 'disabled'

      try {
        options.onFailure?.(cause)
      } catch {
        // 知らせる側が失敗しても、ログのせいでアプリを止めない。
      }
    }
  }

  return { write }
}

export const nodeLogFileSystem: LogFileSystem = {
  mkdir: (path) => {
    mkdirSync(path, { recursive: true })
  },
  size: (path) => statSync(path, { throwIfNoEntry: false })?.size ?? null,
  append: (path, text) => {
    appendFileSync(path, text, { encoding: 'utf8' })
  },
  rename: (from, to) => {
    renameSync(from, to)
  },
  remove: (path) => {
    rmSync(path, { force: true })
  }
}
