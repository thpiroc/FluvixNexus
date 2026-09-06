import type { LspHover, TextDocumentRange } from '@shared/lsp'

export interface EditorHoverContent {
  readonly value: string
}

export interface EditorHoverRange {
  readonly startLineNumber: number
  readonly startColumn: number
  readonly endLineNumber: number
  readonly endColumn: number
}

export interface EditorHover {
  readonly contents: readonly EditorHoverContent[]
  readonly range: EditorHoverRange | null
}

export function toEditorHover(hover: LspHover): EditorHover | null {
  const contents = hover.contents.map((content) => ({
    value: content.kind === 'markdown' ? content.value : escapeMarkdownText(content.value)
  }))

  if (contents.length === 0) {
    return null
  }

  return {
    contents,
    range: hover.range === null ? null : toEditorRange(hover.range)
  }
}

function toEditorRange(range: TextDocumentRange): EditorHoverRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1
  }
}

function escapeMarkdownText(value: string): string {
  return value.replace(/[\\`*_{}[\]<>()#+\-.!|]/g, '\\$&').replace(/\n/g, '  \n')
}
