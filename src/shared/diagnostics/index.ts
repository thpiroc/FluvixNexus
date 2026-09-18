/**
 * 診断情報の公開窓口（型・上限・文字列への整形）。
 *
 * 集めて伏せるのは Main（main/diagnostics/）、並べるのは Renderer
 * （renderer/src/settings/DiagnosticsView.tsx）。ここはその間で共有する形だけを持つ。
 */
export {
  DIAGNOSTICS_ERROR_KINDS,
  DIAGNOSTICS_ERROR_MESSAGE_MAX_LENGTH,
  DIAGNOSTICS_ERROR_NAME_MAX_LENGTH,
  DIAGNOSTICS_ERROR_RECORDS_MAX,
  DIAGNOSTICS_ERROR_STACK_LINE_MAX_LENGTH,
  DIAGNOSTICS_ERROR_STACK_MAX_LINES,
  DIAGNOSTICS_REPORT_ERRORS_MAX,
  DIAGNOSTICS_REPORT_SCHEMA_VERSION,
  formatDiagnosticsBytes,
  formatDiagnosticsDuration,
  formatDiagnosticsReportText,
  formatDiagnosticsTime,
  isDiagnosticsErrorKind
} from './report'

export type {
  DiagnosticsAppInfo,
  DiagnosticsAppState,
  DiagnosticsErrorKind,
  DiagnosticsErrorRecord,
  DiagnosticsErrorSeverity,
  DiagnosticsLanguageServerState,
  DiagnosticsMemoryInfo,
  DiagnosticsReport,
  DiagnosticsRuntimeInfo,
  DiagnosticsSystemInfo
} from './report'
