import type { LspWorkspaceLocation, TextDocumentRange } from '@shared/lsp'

export interface EditorWorkspaceLocation {
  readonly relativePath: string
  readonly range: {
    readonly startLineNumber: number
    readonly startColumn: number
    readonly endLineNumber: number
    readonly endColumn: number
  }
}

export function toEditorWorkspaceLocations(
  locations: readonly LspWorkspaceLocation[]
): readonly EditorWorkspaceLocation[] {
  return locations.map((location) => ({
    relativePath: location.relativePath,
    range: toEditorRange(location.range)
  }))
}

function toEditorRange(range: TextDocumentRange): EditorWorkspaceLocation['range'] {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1
  }
}
