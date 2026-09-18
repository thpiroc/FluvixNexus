import { app } from 'electron'
import { join } from 'path'
import {
  formatDiagnosticsReportText,
  type DiagnosticsErrorKind,
  type DiagnosticsErrorSeverity,
  type DiagnosticsReport
} from '@shared/diagnostics'
import type { ReportRendererErrorRequest } from '@shared/ipc'
import { createLogger } from '../logger'
import { LOG_DIRECTORY_NAME } from '../logger/logFile'
import { collectDiagnosticsSources } from './diagnosticsCollector'
import { createDiagnosticsReport } from './diagnosticsReport'
import { createErrorGate } from './errorGate'
import { createErrorRecordStore, ERROR_RECORDS_FILE_NAME } from './errorRecords'
import { createErrorRecord, describeThrown } from './errorSanitize'

/**
 * 診断情報とエラー記録の窓口。
 *
 * ```
 * getDiagnosticsReport()      診断情報を作る（伏せ済み）
 * getDiagnosticsReportText()  それをコピー用の文字列にする
 * clearDiagnosticsErrors()    保存しているエラー記録を消す
 * recordRendererError()       画面から届いたエラーを確かめて記録する
 * startErrorCapture()         Main のプロセスで起きる重大なエラーを拾い始める
 * ```
 *
 * IPC（ipc/handlers/diagnostics.ts）はここを呼ぶだけ。**将来のフィードバック送信も
 * ここを呼ぶ**想定で、画面に依らない形（`DiagnosticsReport` / 文字列）で返す。
 *
 * ## 既存の挙動を変えない
 *
 * 未捕捉の例外は `uncaughtExceptionMonitor` で拾う ── `uncaughtException` にリスナーを
 * 足すと、Electron が出しているエラーダイアログが出なくなるため。
 * 未処理の Promise の失敗は、Electron の Main では警告を出して動き続ける（落ちない）。
 * リスナーを足すとその警告が出なくなるので、同じ内容を logger から出す。
 */

const log = createLogger('diagnostics')

const errorRecords = createErrorRecordStore({
  resolveFilePath: () => join(app.getPath('userData'), LOG_DIRECTORY_NAME, ERROR_RECORDS_FILE_NAME)
})

const errorGate = createErrorGate()

/** Renderer から受け取る文字列の、伏せる前に読む上限。 */
const RENDERER_REPORT_READ_LIMIT = 20_000

export function getDiagnosticsReport(): DiagnosticsReport {
  return createDiagnosticsReport(collectDiagnosticsSources(errorRecords.list()))
}

export function getDiagnosticsReportText(): string {
  return formatDiagnosticsReportText(getDiagnosticsReport())
}

export function clearDiagnosticsErrors(): void {
  errorRecords.clear()
  log.info('error records were cleared.')
}

/**
 * 画面から届いたエラーを記録する。中身は Renderer が組み立てたものなので、
 * 型が合わないものは黙って捨て、長さを切ってから伏せる。
 */
export function recordRendererError(request: unknown): void {
  if (typeof request !== 'object' || request === null) {
    return
  }

  const report = request as Partial<Record<keyof ReportRendererErrorRequest, unknown>>

  if (report.source !== 'error' && report.source !== 'unhandledrejection') {
    return
  }

  recordError(
    report.source === 'error' ? 'renderer-error' : 'renderer-unhandled-rejection',
    'error',
    {
      name: readLimited(report.name),
      message: readLimited(report.message),
      stack: readLimited(report.stack)
    }
  )
}

let captureStarted = false

export function startErrorCapture(): void {
  if (captureStarted) {
    return
  }

  captureStarted = true

  process.on('uncaughtExceptionMonitor', (error, origin) => {
    recordError(
      origin === 'unhandledRejection' ? 'main-unhandled-rejection' : 'main-uncaught-exception',
      'fatal',
      describeThrown(error)
    )
  })

  process.on('unhandledRejection', (reason) => {
    // リスナーを足したことで Node の警告が出なくなる分を、ここで出す。
    log.error('unhandled promise rejection in the main process.', reason)
    recordError('main-unhandled-rejection', 'error', describeThrown(reason))
  })

  app.on('render-process-gone', (_event, _webContents, details) => {
    if (details.reason === 'clean-exit') {
      return
    }

    recordError('renderer-process-gone', 'fatal', {
      name: details.reason,
      message: `The renderer process exited (exit code ${details.exitCode}).`,
      stack: ''
    })
  })

  app.on('child-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') {
      return
    }

    // `name` / `serviceName` は Chromium が付ける補助プロセスの名前（`Network Service` など）。
    const label = details.name ?? details.serviceName ?? ''

    recordError('child-process-gone', 'fatal', {
      name: details.reason,
      message: `A ${details.type} process${label.length > 0 ? ` (${label})` : ''} exited (exit code ${details.exitCode}).`,
      stack: ''
    })
  })
}

function recordError(
  kind: DiagnosticsErrorKind,
  severity: DiagnosticsErrorSeverity,
  thrown: { readonly name: string; readonly message: string; readonly stack: string }
): void {
  try {
    const record = createErrorRecord({
      kind,
      severity,
      occurredAt: Date.now(),
      appVersion: app.getVersion(),
      name: thrown.name,
      message: thrown.message,
      stack: thrown.stack
    })

    if (!errorGate.admit(`${record.kind}|${record.name}|${record.message}`)) {
      return
    }

    errorRecords.append(record)
    log.error(
      `recorded ${record.severity} error (${record.kind}): ${record.name}: ${record.message}`
    )
  } catch {
    // 記録のせいで、落ちかけているアプリをさらに止めない。
  }
}

function readLimited(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, RENDERER_REPORT_READ_LIMIT) : ''
}
