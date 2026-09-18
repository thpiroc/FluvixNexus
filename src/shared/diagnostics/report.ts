/**
 * 診断情報の形（Electron / fs 非依存・テスト対象）。
 *
 * 不具合の報告を受けたときに「どの版を・どの環境で・何が起きた直後に」使っていたかを、
 * 利用者が画面で確かめてからコピーできるようにするためのもの。
 *
 * ## ここに載せるもの / 載せないもの
 *
 * ```
 * 載せる   版・OS の種類と版・CPU の種類と数・メモリの量・Electron / Chrome / Node / V8 の版
 *          アプリの状態（Workspace を開いているか・言語サーバー / Debug / Terminal の状態）
 *          記録したエラー（種類・日時・伏せ済みの名前と message と stack）
 * 載せない パス（Workspace の場所・userData の場所）・ユーザー名・ホスト名・環境変数
 *          ファイルの中身・ソースコード・設定の値・API キー / パスワード / token
 * ```
 *
 * 作るのは Main だけ（main/diagnostics/）。Renderer は受け取って並べるだけで、
 * 自分で集めたり足したりしない ── 伏せる判断を1箇所に保つため。
 *
 * ## 将来のフィードバック送信から使う
 *
 * `DiagnosticsReport` は「画面に並べる」ためだけの形にしていない。フィードバックに
 * 添付するときは、同じ `DiagnosticsReport`（または `formatDiagnosticsReportText` の文字列）を
 * そのまま付ければよい。`schemaVersion` はそのときに受け取る側が形を見分けるためのもの。
 */

export const DIAGNOSTICS_REPORT_SCHEMA_VERSION = 1

/** 保存しておくエラー記録の上限（古いものから捨てる）。 */
export const DIAGNOSTICS_ERROR_RECORDS_MAX = 20

/** 診断情報に載せるエラー記録の上限（新しいものから）。 */
export const DIAGNOSTICS_REPORT_ERRORS_MAX = 10

/** エラー記録の文字列の上限。 */
export const DIAGNOSTICS_ERROR_NAME_MAX_LENGTH = 120
export const DIAGNOSTICS_ERROR_MESSAGE_MAX_LENGTH = 1000
export const DIAGNOSTICS_ERROR_STACK_MAX_LINES = 20
export const DIAGNOSTICS_ERROR_STACK_LINE_MAX_LENGTH = 300

/**
 * 記録するエラーの種類（閉じた集合）。
 *
 * ```
 * main-uncaught-exception   Main で誰も捕まえなかった例外（Electron がダイアログを出すもの）
 * main-unhandled-rejection  Main で誰も待たなかった Promise の失敗
 * renderer-process-gone     画面のプロセスが落ちた（クラッシュ・メモリ不足など）
 * child-process-gone        GPU などの補助プロセスが落ちた
 * renderer-error            画面の中で誰も捕まえなかった例外
 * renderer-unhandled-rejection 画面の中で誰も待たなかった Promise の失敗
 * ```
 */
export const DIAGNOSTICS_ERROR_KINDS = [
  'main-uncaught-exception',
  'main-unhandled-rejection',
  'renderer-process-gone',
  'child-process-gone',
  'renderer-error',
  'renderer-unhandled-rejection'
] as const

export type DiagnosticsErrorKind = (typeof DIAGNOSTICS_ERROR_KINDS)[number]

/** `fatal` はプロセスが落ちた（落ちうる）もの、`error` は動き続けているもの。 */
export type DiagnosticsErrorSeverity = 'fatal' | 'error'

export function isDiagnosticsErrorKind(value: unknown): value is DiagnosticsErrorKind {
  return typeof value === 'string' && (DIAGNOSTICS_ERROR_KINDS as readonly string[]).includes(value)
}

/** 記録したエラー1件。**すべて伏せ済み**（main/diagnostics/errorSanitize.ts）。 */
export interface DiagnosticsErrorRecord {
  readonly kind: DiagnosticsErrorKind
  readonly severity: DiagnosticsErrorSeverity
  /** 起きた日時（epoch ミリ秒）。 */
  readonly occurredAt: number
  /** 起きたときのアプリの版（更新の前後を見分けるため）。 */
  readonly appVersion: string
  /** Error の名前、またはプロセスが落ちた理由（`crashed` / `oom` など）。 */
  readonly name: string
  readonly message: string
  /** stack の行。パスはファイル名だけに縮めてある。無ければ空。 */
  readonly stack: readonly string[]
}

export interface DiagnosticsAppInfo {
  readonly name: string
  readonly version: string
  /** 配布版（インストールしたもの）か、開発版か。 */
  readonly isPackaged: boolean
  /** 表示に使っている OS の言語（`ja` など）。 */
  readonly locale: string
  /** 起動してからの秒数。 */
  readonly uptimeSeconds: number
}

export interface DiagnosticsRuntimeInfo {
  readonly electron: string
  readonly chrome: string
  readonly node: string
  readonly v8: string
}

export interface DiagnosticsSystemInfo {
  /** `win32` など。 */
  readonly platform: string
  /** OS の製品名（`Windows 11 Home` など）。取れなければ空。 */
  readonly osName: string
  /** OS の版（`10.0.26200` など）。 */
  readonly osRelease: string
  /** CPU アーキテクチャ（`x64` / `arm64`）。 */
  readonly arch: string
  /** CPU の型番。取れなければ空。 */
  readonly cpuModel: string
  readonly cpuCount: number
  readonly totalMemoryBytes: number
  readonly freeMemoryBytes: number
}

export interface DiagnosticsMemoryInfo {
  /** Main プロセスの常駐メモリ。 */
  readonly mainProcessBytes: number
  /** アプリの全プロセス（Main・画面・GPU・補助）の合計。取れなければ null。 */
  readonly allProcessesBytes: number | null
  /** 数えたプロセスの数。取れなければ null。 */
  readonly processCount: number | null
}

/** 言語サーバー1本の状態（`LanguageServerStatusId` をそのまま）。 */
export interface DiagnosticsLanguageServerState {
  readonly serverId: string
  readonly status: string
}

/** 今のアプリの状態。**場所や名前は持たない**（開いているかどうか・数・状態の語だけ）。 */
export interface DiagnosticsAppState {
  readonly workspaceOpen: boolean
  readonly windowCount: number
  readonly terminalSessionCount: number
  readonly languageServers: readonly DiagnosticsLanguageServerState[]
  /** Debug Session の状態（`idle` / `running` など）。 */
  readonly debugSession: string
}

export interface DiagnosticsReport {
  readonly schemaVersion: typeof DIAGNOSTICS_REPORT_SCHEMA_VERSION
  /** 作った日時（epoch ミリ秒）。 */
  readonly generatedAt: number
  readonly app: DiagnosticsAppInfo
  readonly runtime: DiagnosticsRuntimeInfo
  readonly system: DiagnosticsSystemInfo
  readonly memory: DiagnosticsMemoryInfo
  readonly state: DiagnosticsAppState
  /** 新しい順。上限は `DIAGNOSTICS_REPORT_ERRORS_MAX`。 */
  readonly recentErrors: readonly DiagnosticsErrorRecord[]
  /** 保存されているエラー記録の総数（載せていない古いものも含む）。 */
  readonly storedErrorCount: number
}

/**
 * コピーする文字列にする。
 *
 * **英語の固定の書式**にしてある。読むのは報告を受け取る開発者で、利用者の表示言語で
 * 形が変わると読み比べられない。フィードバックへ添付するときもこの文字列を使う。
 */
export function formatDiagnosticsReportText(report: DiagnosticsReport): string {
  const lines: string[] = []
  const { app, runtime, system, memory, state } = report

  lines.push('# Fluvix Nexus diagnostics')
  lines.push(`Generated: ${formatDiagnosticsTime(report.generatedAt)}`)
  lines.push(`Schema: ${report.schemaVersion}`)
  lines.push('')
  lines.push('## Application')
  lines.push(
    `Version: ${app.name} ${app.version} (${app.isPackaged ? 'installed' : 'development'})`
  )
  lines.push(`Locale: ${app.locale}`)
  lines.push(`Uptime: ${formatDiagnosticsDuration(app.uptimeSeconds)}`)
  lines.push('')
  lines.push('## Runtime')
  lines.push(`Electron: ${runtime.electron}`)
  lines.push(`Chrome: ${runtime.chrome}`)
  lines.push(`Node.js: ${runtime.node}`)
  lines.push(`V8: ${runtime.v8}`)
  lines.push('')
  lines.push('## System')
  lines.push(`OS: ${system.osName.length > 0 ? system.osName : system.platform}`)
  lines.push(`OS version: ${system.platform} ${system.osRelease}`)
  lines.push(`Architecture: ${system.arch}`)
  lines.push(
    `CPU: ${system.cpuModel.length > 0 ? system.cpuModel : 'unknown'} (${system.cpuCount} logical)`
  )
  lines.push(
    `Memory: ${formatDiagnosticsBytes(system.totalMemoryBytes)} total, ${formatDiagnosticsBytes(system.freeMemoryBytes)} free`
  )
  lines.push('')
  lines.push('## Memory usage')
  lines.push(`Main process: ${formatDiagnosticsBytes(memory.mainProcessBytes)}`)
  lines.push(
    `All processes: ${
      memory.allProcessesBytes === null
        ? 'unknown'
        : `${formatDiagnosticsBytes(memory.allProcessesBytes)} (${memory.processCount ?? '?'} processes)`
    }`
  )
  lines.push('')
  lines.push('## State')
  lines.push(`Workspace open: ${state.workspaceOpen ? 'yes' : 'no'}`)
  lines.push(`Windows: ${state.windowCount}`)
  lines.push(`Terminal sessions: ${state.terminalSessionCount}`)
  lines.push(
    `Language servers: ${
      state.languageServers.length === 0
        ? 'none'
        : state.languageServers.map((server) => `${server.serverId}=${server.status}`).join(', ')
    }`
  )
  lines.push(`Debug session: ${state.debugSession}`)
  lines.push('')
  lines.push(
    `## Recent errors (${report.recentErrors.length} shown, ${report.storedErrorCount} stored)`
  )

  if (report.recentErrors.length === 0) {
    lines.push('None')
  }

  report.recentErrors.forEach((record, index) => {
    lines.push(
      `${index + 1}. [${record.severity}] ${record.kind} at ${formatDiagnosticsTime(record.occurredAt)} (v${record.appVersion})`
    )
    lines.push(`   ${record.name}: ${record.message}`)

    for (const frame of record.stack) {
      lines.push(`     ${frame}`)
    }
  })

  return `${lines.join('\n')}\n`
}

/** `2026-09-19T12:34:56.789Z`。読めない値は `unknown`。 */
export function formatDiagnosticsTime(epochMs: number): string {
  const date = new Date(epochMs)

  return Number.isFinite(date.getTime()) ? date.toISOString() : 'unknown'
}

/** `15.9 GiB` のような1語。 */
export function formatDiagnosticsBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'unknown'
  }

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 0

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }

  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`
}

/** `2h 03m 04s` のような1語。 */
export function formatDiagnosticsDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return 'unknown'
  }

  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')

  return hours > 0 ? `${hours}h ${pad(minutes)}m ${pad(rest)}s` : `${minutes}m ${pad(rest)}s`
}
