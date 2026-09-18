import type { DiagnosticsReport } from '../../diagnostics'

/**
 * diagnostics ドメインの IPC 契約（診断情報とエラー記録）。
 *
 * ## 4本
 *
 * ```
 * diagnostics:get-report            診断情報を作って返す（Settings の「診断情報」が読む）
 * diagnostics:copy-report           診断情報を作って、Main がクリップボードへ書く
 * diagnostics:clear-errors          保存しているエラー記録を消す
 * diagnostics:report-renderer-error 画面の中で捕まえられなかった例外を Main へ知らせる
 * ```
 *
 * ## コピーは Main が書く
 *
 * Renderer の `navigator.clipboard` は Web 権限（`clipboard-sanitized-write`）が要り、
 * このアプリは Web 権限をすべて拒否している（main/security/index.ts）。そこを開けずに済むよう、
 * **Main が自分で作り直した診断情報**を Electron の `clipboard` で書く ── Renderer から
 * 好きな文字列をクリップボードへ書ける口にはしない（要求に欄が無い）。
 *
 * ## Renderer からのエラーは信じ切らない
 *
 * `report-renderer-error` の中身は Renderer が組み立てるので、Main 側で型・長さを確かめ、
 * 伏せ、1回の起動あたりの件数に上限を掛けてから記録する（main/diagnostics/errorCapture.ts）。
 * 返事は常に空 ── 記録したかどうかを Renderer が知る必要は無い。
 */

export type RendererErrorSource = 'error' | 'unhandledrejection'

export interface ReportRendererErrorRequest {
  readonly source: RendererErrorSource
  readonly name: string
  readonly message: string
  /** Error の stack（無ければ空文字）。 */
  readonly stack: string
}

export interface CopyDiagnosticsReportResponse {
  /** クリップボードへ書いた文字数。 */
  readonly characters: number
}

export interface DiagnosticsIpcContract {
  'diagnostics:get-report': {
    request: void
    response: DiagnosticsReport
  }
  'diagnostics:copy-report': {
    request: void
    response: CopyDiagnosticsReportResponse
  }
  'diagnostics:clear-errors': {
    request: void
    response: void
  }
  'diagnostics:report-renderer-error': {
    request: ReportRendererErrorRequest
    response: void
  }
}
