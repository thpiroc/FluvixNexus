/**
 * LSP 契約レイヤーの公開窓口（Session 5-2 / 5-3 / 5-4）。
 *
 * Main / Preload / Renderer はこのモジュール経由で文書同期・診断・
 * サーバの名前 / 設定 / 状態の型を参照する。shared 層のルールどおり、
 * ここに実装（プロセス・電文の組み立て・どこから起動するか）は置かない
 * ── それらは Main の持ち物で、main/lsp/ に閉じている。
 *
 * Session 5-4 で足したのは「名前」「使うかどうか」「今どうなっているか」の3つで、
 * **どれも実行ファイルに触れない**（shared/lsp/server.ts の冒頭）。
 */
export {
  LSP_DOCUMENT_MAX_CONTENT_CHANGES,
  LSP_DOCUMENT_MAX_TEXT_LENGTH,
  isTextDocumentContentChange,
  isTextDocumentVersion
} from './document'

export type { TextDocumentContentChange, TextDocumentPosition, TextDocumentRange } from './document'

export { LSP_DIAGNOSTIC_MESSAGE_MAX_LENGTH, LSP_DIAGNOSTICS_MAX_PER_DOCUMENT } from './diagnostic'

export type { LspDiagnostic, LspDiagnosticSeverity, LspDiagnosticTag } from './diagnostic'

export { LANGUAGE_SERVER_IDS, isLanguageServerId } from './server'

export type { LanguageServerId } from './server'

export {
  DEFAULT_LANGUAGE_SERVER_PREFERENCES,
  isLanguageServerEnabled,
  isSameLanguageServerPreferences,
  normalizeLanguageServerPreferences,
  toStoredLspSettings
} from './serverSettings'

export type { LanguageServerPreferences } from './serverSettings'

export {
  LANGUAGE_SERVER_STATUS_IDS,
  resolveLanguageServerStatus,
  summarizeLanguageServerStatuses
} from './serverStatus'

export type {
  LanguageServerRuntimeStatus,
  LanguageServerStatus,
  LanguageServerStatusId
} from './serverStatus'
