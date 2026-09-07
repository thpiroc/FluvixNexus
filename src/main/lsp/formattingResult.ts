import {
  LSP_FORMATTING_MAX_EDITS,
  LSP_FORMATTING_MAX_TEXT_LENGTH,
  type LspFormattingEdit,
  type TextDocumentPosition,
  type TextDocumentRange
} from '@shared/lsp'

export function parseFormattingResult(result: unknown): readonly LspFormattingEdit[] | null {
  if (result === null) {
    return []
  }

  if (!Array.isArray(result)) {
    return null
  }

  const edits: LspFormattingEdit[] = []

  for (const entry of result) {
    if (edits.length >= LSP_FORMATTING_MAX_EDITS) {
      break
    }

    const edit = parseTextEdit(entry)

    if (edit === null) {
      return null
    }

    edits.push(edit)
  }

  return hasOverlappingRanges(edits) ? null : edits
}

function parseTextEdit(value: unknown): LspFormattingEdit | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const raw = value as { readonly range: unknown; readonly newText: unknown }

  if (typeof raw.newText !== 'string' || raw.newText.length > LSP_FORMATTING_MAX_TEXT_LENGTH) {
    return null
  }

  const range = parseRange(raw.range)

  return range === null ? null : { range, text: raw.newText }
}

function parseRange(value: unknown): TextDocumentRange | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const raw = value as { readonly start: unknown; readonly end: unknown }
  const start = parsePosition(raw.start)
  const end = parsePosition(raw.end)

  if (start === null || end === null || comparePositions(start, end) > 0) {
    return null
  }

  return { start, end }
}

function parsePosition(value: unknown): TextDocumentPosition | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const raw = value as { readonly line: unknown; readonly character: unknown }

  if (!isSafeInteger(raw.line) || !isSafeInteger(raw.character)) {
    return null
  }

  return { line: Math.max(0, raw.line), character: Math.max(0, raw.character) }
}

function hasOverlappingRanges(edits: readonly LspFormattingEdit[]): boolean {
  const sorted = [...edits].sort((a, b) => compareRanges(a.range, b.range))

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!
    const current = sorted[index]!

    if (comparePositions(current.range.start, previous.range.end) < 0) {
      return true
    }
  }

  return false
}

function compareRanges(a: TextDocumentRange, b: TextDocumentRange): number {
  const start = comparePositions(a.start, b.start)

  return start === 0 ? comparePositions(a.end, b.end) : start
}

function comparePositions(a: TextDocumentPosition, b: TextDocumentPosition): number {
  return a.line === b.line ? a.character - b.character : a.line - b.line
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}
