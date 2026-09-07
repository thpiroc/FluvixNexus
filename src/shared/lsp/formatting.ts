import type { TextDocumentRange } from './document'

export const LSP_FORMATTING_MAX_EDITS = 2048
export const LSP_FORMATTING_MAX_TEXT_LENGTH = 16 * 1024 * 1024
export const LSP_FORMATTING_MAX_TAB_SIZE = 16

export interface LspFormattingOptions {
  readonly tabSize: number
  readonly insertSpaces: boolean
}

export interface LspFormattingRequest {
  readonly relativePath: string
  readonly version: number
  readonly options: LspFormattingOptions
}

export interface LspFormattingEdit {
  readonly range: TextDocumentRange
  readonly text: string
}

export type LspFormattingResponse =
  | {
      readonly status: 'ok'
      readonly version: number
      readonly edits: readonly LspFormattingEdit[]
    }
  | { readonly status: 'unavailable' }
  | { readonly status: 'stale' }

export function isLspFormattingOptions(value: unknown): value is LspFormattingOptions {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const options = value as { readonly tabSize: unknown; readonly insertSpaces: unknown }

  return (
    typeof options.tabSize === 'number' &&
    Number.isSafeInteger(options.tabSize) &&
    options.tabSize > 0 &&
    options.tabSize <= LSP_FORMATTING_MAX_TAB_SIZE &&
    typeof options.insertSpaces === 'boolean'
  )
}
