import { appendFile, mkdir, rename, rm, stat } from 'fs/promises'
import { isAbsolute, join } from 'path'
import { errnoCodeOf } from '../../files/errno'
import { redactLogText } from '../../logger/logRedaction'
import { describeErrorWithoutSecrets } from '../secret/secretMasking'
import type { AuditEvent } from './auditEvent'
import { AUDIT_RECORD_MAX_BYTES, formatAuditRecordLine } from './auditLogLine'
import { minimalAuditRecord, sanitizeAuditEvent } from './auditRecord'

/**
 * Security Audit Log の書き出し（Security Core v1 の STEP4。Electron 非依存・テスト対象）。
 *
 * ```
 * 置き場所 … <userData>/logs/agent-audit.log（Main が決める。Workspace の中には書かない）
 * 上限     … 1 MiB。超える前に agent-audit.log.1 へ回して**1世代だけ**残す
 * 1件      … JSON Lines（auditLogLine.ts）。1件が大きすぎるときは最小限の記録へ落とす
 * 並び     … Main process 内で**列に並べて**書く（Promise の鎖）。混線も rename の競合も起きない
 * 失敗     … 呼び出し側へは投げない。知らせるだけで、次の書き込みでもう一度試す
 * ```
 *
 * ## 通常のログとは分ける
 *
 * `main/logger/logFile.ts`（`main.log`）とは**別のファイル・別の API** にしてある。
 * 目的が違う ── あちらは不具合を追うための出力で、混ぜると Security の記録が
 * LSP や Terminal の行に埋もれ、上限の取り合いにもなる。置き場所（`logs/`）と
 * 伏せ字（`logRedaction.ts`）のような安全な部品だけを共有する。
 *
 * ## 書き込みは列に並べる（非同期）
 *
 * 通常のログは同期で書く（落ちる直前の行を残すため）が、Audit は非同期で、
 * **1本の Promise の鎖**に並べる。理由は2つ。
 *
 *   - Security Event が同時に起きても、rotation の最中に別の append が割り込まない
 *     （`.1` への rename と append が交差すると、記録が消えるか二重になる）
 *   - 判定の経路（Gate）を同期の I/O で止めない
 *
 * 列は Main process の中だけで閉じている。**Renderer 側の鍵は当てにしない**
 * （そもそも Renderer からこの module へ届く経路は無い。currentAuditLog.ts）。
 *
 * ## 失敗しても Security を緩めない
 *
 * `write()` は**必ず解決する**（拒否しない・投げない）。返り値も「書けたか」を返さない ──
 * 呼び出し側が「Audit が失敗したから許可する」と書けてしまう形を作らないため。
 * 失敗は `onFailure` で知らせるだけで、次の書き込みでは置き場所から開き直す。
 *
 * 書けなかった1件は**そこで落ちる。** 中身をメモリや別の場所へ退避する仕組みは作らない ──
 * 退避先が Secret を含む記録の2つ目の置き場所になるため。落ちたことは `onFailure` で残る。
 */

export const AUDIT_LOG_FILE_NAME = 'agent-audit.log'
export const AUDIT_ROTATED_LOG_FILE_NAME = 'agent-audit.log.1'
export const AUDIT_LOG_MAX_BYTES = 1024 * 1024

export interface AuditFileSystem {
  /** 途中のフォルダも作る。在ってもよい。 */
  readonly mkdir: (path: string) => Promise<void>
  /** バイト数。無ければ null。 */
  readonly size: (path: string) => Promise<number | null>
  readonly append: (path: string, text: string) => Promise<void>
  readonly rename: (from: string, to: string) => Promise<void>
  /** 無くても失敗にしない。 */
  readonly remove: (path: string) => Promise<void>
}

/** 書けなかったこと。**原因の文字列は Audit 側で Secret と絶対パスを伏せてある。** */
export interface AuditWriteFailure {
  /** Secret を含まない1行の説明。 */
  readonly summary: string
  /** 続けて失敗した回数（1 なら、成功の後で初めて失敗した）。 */
  readonly consecutiveFailures: number
}

export interface AuditLogWriterOptions {
  /** 置き場所のフォルダ。取れない・絶対パスでなければ、その回は失敗として扱う。 */
  readonly resolveDirectory: () => string | null
  readonly fileSystem: AuditFileSystem
  readonly maxBytes?: number
  readonly recordMaxBytes?: number
  readonly now?: () => Date
  /** 書けなかったときに呼ばれる。ここで投げても無視される。 */
  readonly onFailure?: (failure: AuditWriteFailure) => void
}

export interface AuditLogWriter {
  /** 1件を列の最後に並べる。**拒否しない**（失敗しても解決する）。 */
  readonly write: (event: AuditEvent) => Promise<void>
  /** 並んでいるものが全部片付くまで待つ（テストと終了処理のため）。 */
  readonly whenIdle: () => Promise<void>
}

export function createAuditLogWriter(options: AuditLogWriterOptions): AuditLogWriter {
  const { fileSystem } = options
  const maxBytes = options.maxBytes ?? AUDIT_LOG_MAX_BYTES
  const recordMaxBytes = options.recordMaxBytes ?? AUDIT_RECORD_MAX_BYTES
  const now = options.now ?? ((): Date => new Date())

  let openedDirectory: string | null = null
  let filePath = ''
  let rotatedPath = ''
  let size = 0
  let consecutiveFailures = 0
  let tail: Promise<void> = Promise.resolve()

  /** 置き場所を確かめて開く。既に同じフォルダで開いていれば何もしない。 */
  async function open(): Promise<void> {
    const directory = options.resolveDirectory()

    if (typeof directory !== 'string' || directory.length === 0 || !isAbsolute(directory)) {
      throw new Error('the audit log directory is not available.')
    }

    if (openedDirectory === directory) {
      return
    }

    await fileSystem.mkdir(directory)

    filePath = join(directory, AUDIT_LOG_FILE_NAME)
    rotatedPath = join(directory, AUDIT_ROTATED_LOG_FILE_NAME)
    size = (await fileSystem.size(filePath)) ?? 0
    openedDirectory = directory
  }

  /** 1世代だけ残す（古い `.1` を捨て、今の Log を `.1` にして、新しい Log から書き始める）。 */
  async function rotate(): Promise<void> {
    await fileSystem.remove(rotatedPath)
    await fileSystem.rename(filePath, rotatedPath)
    size = 0
  }

  async function append(line: string): Promise<void> {
    await open()

    const text = `${line}\n`
    const bytes = Buffer.byteLength(text, 'utf8')

    if (size > 0 && size + bytes > maxBytes) {
      await rotate()
    }

    await fileSystem.append(filePath, text)
    size += bytes
  }

  function fail(cause: unknown): void {
    consecutiveFailures += 1

    // 次の書き込みで開き直す（置き場所が戻れば、そのまま続けられる）。
    openedDirectory = null

    try {
      options.onFailure?.({ summary: failureSummary(cause), consecutiveFailures })
    } catch {
      // 知らせる側が失敗しても、Audit のせいでアプリを止めない。
    }
  }

  function write(event: AuditEvent): Promise<void> {
    // 時刻は**並べる前**に押す（書いた順ではなく、起きた順で読めるように）。
    const line = buildLine(event)
    const task = tail.then(
      () =>
        append(line).then(
          () => {
            consecutiveFailures = 0
          },
          (cause: unknown) => {
            fail(cause)
          }
        ),
      () => undefined
    )

    tail = task

    return task
  }

  function buildLine(event: AuditEvent): string {
    const at = now()

    try {
      return formatAuditRecordLine(sanitizeAuditEvent(event, at), recordMaxBytes)
    } catch {
      // Sanitize も整形も投げない作りだが、投げたときに平文が出ることだけは無いようにする。
      return formatAuditRecordLine(
        minimalAuditRecord(safeTimeText(at), 'sanitize-failed'),
        recordMaxBytes
      )
    }
  }

  return { write, whenIdle: () => tail }
}

/** 原因を、Secret も絶対パスも含まない1行にする。 */
function failureSummary(cause: unknown): string {
  const described = describeErrorWithoutSecrets(cause)

  return redactLogText(described)
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .slice(0, 400)
}

function safeTimeText(time: Date): string {
  const value = time instanceof Date ? time.getTime() : Number.NaN

  return new Date(Number.isFinite(value) ? value : Date.now()).toISOString()
}

export const nodeAuditFileSystem: AuditFileSystem = {
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
  size: async (path) => {
    try {
      return (await stat(path)).size
    } catch (cause) {
      /*
        無い（まだ1件も書いていない）だけを 0 として扱う。EACCES などを 0 と読むと、
        rotation の判断が狂ったまま append を続けることになり、上限が効かなくなる。
      */
      if (errnoCodeOf(cause) === 'ENOENT') {
        return null
      }

      throw cause
    }
  },
  append: async (path, text) => {
    await appendFile(path, text, { encoding: 'utf8' })
  },
  rename: async (from, to) => {
    await rename(from, to)
  },
  remove: async (path) => {
    await rm(path, { force: true })
  }
}
