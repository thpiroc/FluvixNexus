import type { TextDocumentPosition, TextDocumentRange } from './document'

export const LSP_HOVER_TEXT_MAX_LENGTH = 8000
export const LSP_HOVER_MAX_CONTENTS = 8

export type LspHoverContentKind = 'markdown' | 'plaintext'

export interface LspHoverContent {
  readonly kind: LspHoverContentKind
  readonly value: string
}

export interface LspHover {
  readonly contents: readonly LspHoverContent[]
  readonly range: TextDocumentRange | null
}

export interface LspHoverRequest {
  readonly relativePath: string
  readonly version: number
  readonly position: TextDocumentPosition
}

export type LspHoverResponse =
  | { readonly status: 'ok'; readonly version: number; readonly hover: LspHover | null }
  | { readonly status: 'stale' }
  | { readonly status: 'unavailable' }
