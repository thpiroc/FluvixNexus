/**
 * LSP 契約レイヤーの公開窓口（Session 5-2）。
 *
 * Main / Preload / Renderer はこのモジュール経由で文書同期の型と上限を参照する。
 * shared 層のルールどおり、ここに実装（プロセス・電文の組み立て）は置かない
 * ── それらは Main の持ち物で、main/lsp/ に閉じている。
 */
export {
  LSP_DOCUMENT_MAX_CONTENT_CHANGES,
  LSP_DOCUMENT_MAX_TEXT_LENGTH,
  isTextDocumentContentChange,
  isTextDocumentVersion
} from './document'

export type { TextDocumentContentChange, TextDocumentPosition, TextDocumentRange } from './document'
