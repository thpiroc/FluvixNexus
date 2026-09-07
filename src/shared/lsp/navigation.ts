import type { TextDocumentPosition, TextDocumentRange } from './document'

export const LSP_NAVIGATION_MAX_LOCATIONS = 1000

export interface LspWorkspaceLocation {
  readonly relativePath: string
  readonly range: TextDocumentRange
}

export interface LspDefinitionRequest {
  readonly relativePath: string
  readonly version: number
  readonly position: TextDocumentPosition
}

export type LspDefinitionResponse =
  | {
      readonly status: 'ok'
      readonly version: number
      readonly definitions: readonly LspWorkspaceLocation[]
    }
  | { readonly status: 'stale' }
  | { readonly status: 'unavailable' }

export interface LspReferencesRequest {
  readonly relativePath: string
  readonly version: number
  readonly position: TextDocumentPosition
  readonly includeDeclaration: boolean
}

export type LspReferencesResponse =
  | {
      readonly status: 'ok'
      readonly version: number
      readonly references: readonly LspWorkspaceLocation[]
    }
  | { readonly status: 'stale' }
  | { readonly status: 'unavailable' }
