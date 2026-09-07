import type { LspFormattingEdit, TextDocumentPosition } from '@shared/lsp'

export interface EditorFormattingRange {
  readonly startLineNumber: number
  readonly startColumn: number
  readonly endLineNumber: number
  readonly endColumn: number
}

export interface EditorFormattingEdit {
  readonly range: EditorFormattingRange
  readonly text: string
}

export interface FormattingDocumentShape {
  readonly lineCount: number
  readonly getLineMaxColumn: (lineNumber: number) => number
}

export function toEditorFormattingEdits(
  edits: readonly LspFormattingEdit[],
  document: FormattingDocumentShape
): readonly EditorFormattingEdit[] | null {
  const converted: EditorFormattingEdit[] = []

  for (const edit of edits) {
    const range = toEditorRange(edit.range, document)

    if (range === null) {
      return null
    }

    converted.push({ range, text: edit.text })
  }

  return hasOverlappingRanges(converted) ? null : converted
}

function toEditorRange(
  range: LspFormattingEdit['range'],
  document: FormattingDocumentShape
): EditorFormattingRange | null {
  const start = toEditorPosition(range.start, document)
  const end = toEditorPosition(range.end, document)

  if (start === null || end === null || compareEditorPositions(start, end) > 0) {
    return null
  }

  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column
  }
}

function toEditorPosition(
  position: TextDocumentPosition,
  document: FormattingDocumentShape
): { readonly lineNumber: number; readonly column: number } | null {
  const lineNumber = position.line + 1
  const column = position.character + 1

  if (lineNumber < 1 || lineNumber > document.lineCount) {
    return null
  }

  if (column < 1 || column > document.getLineMaxColumn(lineNumber)) {
    return null
  }

  return { lineNumber, column }
}

function hasOverlappingRanges(edits: readonly EditorFormattingEdit[]): boolean {
  const sorted = [...edits].sort((a, b) => compareEditorRanges(a.range, b.range))

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!
    const current = sorted[index]!

    if (compareEditorPositions(rangeStart(current.range), rangeEnd(previous.range)) < 0) {
      return true
    }
  }

  return false
}

function compareEditorRanges(a: EditorFormattingRange, b: EditorFormattingRange): number {
  const start = compareEditorPositions(rangeStart(a), rangeStart(b))

  return start === 0 ? compareEditorPositions(rangeEnd(a), rangeEnd(b)) : start
}

function compareEditorPositions(
  a: { readonly lineNumber: number; readonly column: number },
  b: { readonly lineNumber: number; readonly column: number }
): number {
  return a.lineNumber === b.lineNumber ? a.column - b.column : a.lineNumber - b.lineNumber
}

function rangeStart(range: EditorFormattingRange): {
  readonly lineNumber: number
  readonly column: number
} {
  return { lineNumber: range.startLineNumber, column: range.startColumn }
}

function rangeEnd(range: EditorFormattingRange): {
  readonly lineNumber: number
  readonly column: number
} {
  return { lineNumber: range.endLineNumber, column: range.endColumn }
}
