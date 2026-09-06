import type { TextDocumentPosition, TextDocumentRange } from './document'

export const LSP_COMPLETION_MAX_ITEMS = 500
export const LSP_COMPLETION_LABEL_MAX_LENGTH = 500
export const LSP_COMPLETION_TEXT_MAX_LENGTH = 4000
export const LSP_COMPLETION_COMMIT_CHARACTERS_MAX = 16

export type LspCompletionTriggerKind =
  'invoked' | 'trigger-character' | 'trigger-for-incomplete-completions'

export type LspCompletionItemKind =
  | 'text'
  | 'method'
  | 'function'
  | 'constructor'
  | 'field'
  | 'variable'
  | 'class'
  | 'interface'
  | 'module'
  | 'property'
  | 'unit'
  | 'value'
  | 'enum'
  | 'keyword'
  | 'snippet'
  | 'color'
  | 'file'
  | 'reference'
  | 'folder'
  | 'enum-member'
  | 'constant'
  | 'struct'
  | 'event'
  | 'operator'
  | 'type-parameter'

export type LspCompletionInsertTextFormat = 'plainText' | 'snippet'

export interface LspCompletionTextEdit {
  readonly newText: string
  readonly range:
    | TextDocumentRange
    | {
        readonly insert: TextDocumentRange
        readonly replace: TextDocumentRange
      }
}

export interface LspCompletionItem {
  readonly label: string
  readonly kind: LspCompletionItemKind | null
  readonly detail: string | null
  readonly documentation: string | null
  readonly sortText: string | null
  readonly filterText: string | null
  readonly insertText: string | null
  readonly textEdit: LspCompletionTextEdit | null
  readonly insertTextFormat: LspCompletionInsertTextFormat
  readonly commitCharacters: readonly string[]
  readonly preselect: boolean
}

export interface LspCompletionList {
  readonly isIncomplete: boolean
  readonly items: readonly LspCompletionItem[]
}

export interface LspCompletionRequest {
  readonly relativePath: string
  readonly version: number
  readonly position: TextDocumentPosition
  readonly triggerKind?: LspCompletionTriggerKind
  readonly triggerCharacter?: string
}

export type LspCompletionResponse =
  | { readonly status: 'ok'; readonly version: number; readonly completion: LspCompletionList }
  | { readonly status: 'stale' }
  | { readonly status: 'unavailable' }
