import { isAbsolute } from 'path'
import {
  DIAGNOSTICS_ERROR_RECORDS_MAX,
  isDiagnosticsErrorKind,
  type DiagnosticsErrorRecord
} from '@shared/diagnostics'
import { readJsonFile, writeJsonFile } from '../store/jsonFile'
import { createErrorRecord } from './errorSanitize'

/**
 * エラー記録の保存（Electron 非依存・テスト対象）。
 *
 * ```
 * 置き場所 … <userData>/logs/error-reports.json（main.log の隣。Workspace にもインストール先にも書かない）
 * 形       … { schemaVersion: 1, records: [...] }（古い順）
 * 上限     … DIAGNOSTICS_ERROR_RECORDS_MAX 件。超えたら古いものから捨てる（数十 KB で止まる）
 * 書き込み … 同期・原子的な差し替え（jsonFile.ts）。落ちる直前の1件を残すため
 * 失敗     … 投げない。書けなくてもその起動の間はメモリに持ち、診断情報には出る
 * ```
 *
 * main.log（logger/logFile.ts）と分けてあるのは、**画面に出して利用者がコピーするもの**だから。
 * main.log は行の並びで、しかも伏せ方が「ファイルへ書く1行」向け（stack を書かない）になっている。
 * こちらは件数で区切れる形・stack を縮めて残す形にしたかった。
 *
 * 読み込んだ記録も**もう一度伏せ直す**。手で書き換えられたファイルや、伏せ方を強めた後の
 * 古い記録から、伏せていない文字列が診断情報へ出ないようにするため。
 */

export const ERROR_RECORDS_FILE_NAME = 'error-reports.json'
export const ERROR_RECORDS_SCHEMA_VERSION = 1

export interface ErrorRecordStoreOptions {
  /** ファイルの場所。取れない（null / 例外）・絶対パスでなければ、メモリにだけ持つ。 */
  readonly resolveFilePath: () => string | null
  readonly maxRecords?: number
}

export interface ErrorRecordStore {
  /** 1件足す（伏せ済みのもの）。失敗しても投げない。 */
  readonly append: (record: DiagnosticsErrorRecord) => void
  /** 新しい順。 */
  readonly list: () => readonly DiagnosticsErrorRecord[]
  /** すべて消す。 */
  readonly clear: () => void
}

export function createErrorRecordStore(options: ErrorRecordStoreOptions): ErrorRecordStore {
  const maxRecords = Math.max(1, options.maxRecords ?? DIAGNOSTICS_ERROR_RECORDS_MAX)
  let records: DiagnosticsErrorRecord[] | null = null

  function filePath(): string | null {
    try {
      const path = options.resolveFilePath()

      return path !== null && path.length > 0 && isAbsolute(path) ? path : null
    } catch {
      return null
    }
  }

  function load(): DiagnosticsErrorRecord[] {
    if (records !== null) {
      return records
    }

    const path = filePath()
    records = path === null ? [] : readErrorRecordsDocument(path, maxRecords)

    return records
  }

  function persist(): void {
    const path = filePath()

    if (path === null || records === null) {
      return
    }

    writeJsonFile(path, { schemaVersion: ERROR_RECORDS_SCHEMA_VERSION, records })
  }

  return {
    append: (record) => {
      try {
        const current = load()

        current.push(record)

        if (current.length > maxRecords) {
          current.splice(0, current.length - maxRecords)
        }

        persist()
      } catch {
        // 記録のせいで、落ちかけているアプリをさらに止めない。
      }
    },
    list: () => {
      try {
        return [...load()].reverse()
      } catch {
        return []
      }
    },
    clear: () => {
      try {
        records = []
        persist()
      } catch {
        // 消せなくてもメモリ上は空になっている。
      }
    }
  }
}

/** 保存されている記録を読む。読めない・形が違うものは捨てる（投げない）。 */
export function readErrorRecordsDocument(
  path: string,
  maxRecords: number = DIAGNOSTICS_ERROR_RECORDS_MAX
): DiagnosticsErrorRecord[] {
  const read = readJsonFile(path)

  if (read.kind !== 'present') {
    return []
  }

  return normalizeErrorRecordsDocument(read.raw).slice(-maxRecords)
}

export function normalizeErrorRecordsDocument(raw: unknown): DiagnosticsErrorRecord[] {
  if (typeof raw !== 'object' || raw === null) {
    return []
  }

  const document = raw as { readonly schemaVersion?: unknown; readonly records?: unknown }

  if (document.schemaVersion !== ERROR_RECORDS_SCHEMA_VERSION || !Array.isArray(document.records)) {
    return []
  }

  const records: DiagnosticsErrorRecord[] = []

  for (const entry of document.records as readonly unknown[]) {
    const record = normalizeErrorRecord(entry)

    if (record !== null) {
      records.push(record)
    }
  }

  return records
}

function normalizeErrorRecord(raw: unknown): DiagnosticsErrorRecord | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }

  const entry = raw as Record<string, unknown>

  if (
    !isDiagnosticsErrorKind(entry.kind) ||
    (entry.severity !== 'fatal' && entry.severity !== 'error') ||
    typeof entry.occurredAt !== 'number'
  ) {
    return null
  }

  return createErrorRecord({
    kind: entry.kind,
    severity: entry.severity,
    occurredAt: entry.occurredAt,
    appVersion: typeof entry.appVersion === 'string' ? entry.appVersion : 'unknown',
    name: entry.name,
    message: entry.message,
    // 保存形式では行の配列。伏せ直しは `at …` の行だけを残すので、改行でつないで渡す。
    stack: Array.isArray(entry.stack)
      ? entry.stack.filter((line): line is string => typeof line === 'string').join('\n')
      : ''
  })
}
