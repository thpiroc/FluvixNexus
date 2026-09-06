import {
  LSP_COMPLETION_COMMIT_CHARACTERS_MAX,
  LSP_COMPLETION_LABEL_MAX_LENGTH,
  LSP_COMPLETION_MAX_ITEMS,
  LSP_COMPLETION_TEXT_MAX_LENGTH,
  type LspCompletionInsertTextFormat,
  type LspCompletionItem,
  type LspCompletionItemKind,
  type LspCompletionList,
  type LspCompletionTextEdit,
  type TextDocumentPosition,
  type TextDocumentRange
} from '@shared/lsp'

const KIND_BY_NUMBER: Readonly<Record<number, LspCompletionItemKind>> = {
  1: 'text',
  2: 'method',
  3: 'function',
  4: 'constructor',
  5: 'field',
  6: 'variable',
  7: 'class',
  8: 'interface',
  9: 'module',
  10: 'property',
  11: 'unit',
  12: 'value',
  13: 'enum',
  14: 'keyword',
  15: 'snippet',
  16: 'color',
  17: 'file',
  18: 'reference',
  19: 'folder',
  20: 'enum-member',
  21: 'constant',
  22: 'struct',
  23: 'event',
  24: 'operator',
  25: 'type-parameter'
}

export function parseCompletionResult(result: unknown): LspCompletionList | null {
  if (Array.isArray(result)) {
    return parseCompletionList(result, false)
  }

  if (typeof result !== 'object' || result === null) {
    return null
  }

  const raw = result as { readonly isIncomplete: unknown; readonly items: unknown }

  if (!Array.isArray(raw.items)) {
    return null
  }

  return parseCompletionList(raw.items, raw.isIncomplete === true)
}

function parseCompletionList(items: readonly unknown[], isIncomplete: boolean): LspCompletionList {
  const parsed: LspCompletionItem[] = []

  for (const item of items) {
    if (parsed.length >= LSP_COMPLETION_MAX_ITEMS) {
      break
    }

    const completion = parseCompletionItem(item)

    if (completion !== null) {
      parsed.push(completion)
    }
  }

  return { isIncomplete, items: parsed }
}

function parseCompletionItem(value: unknown): LspCompletionItem | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const raw = value as {
    readonly label: unknown
    readonly kind: unknown
    readonly detail: unknown
    readonly documentation: unknown
    readonly sortText: unknown
    readonly filterText: unknown
    readonly insertText: unknown
    readonly textEdit: unknown
    readonly insertTextFormat: unknown
    readonly commitCharacters: unknown
    readonly preselect: unknown
  }

  if (typeof raw.label !== 'string' || raw.label.length === 0) {
    return null
  }

  const textEdit = parseTextEdit(raw.textEdit)

  return {
    label: trim(raw.label, LSP_COMPLETION_LABEL_MAX_LENGTH),
    kind: parseKind(raw.kind),
    detail: parseOptionalString(raw.detail),
    documentation: parseDocumentation(raw.documentation),
    sortText: parseOptionalString(raw.sortText),
    filterText: parseOptionalString(raw.filterText),
    insertText: parseOptionalString(raw.insertText),
    textEdit,
    insertTextFormat: parseInsertTextFormat(raw.insertTextFormat),
    commitCharacters: parseCommitCharacters(raw.commitCharacters),
    preselect: raw.preselect === true
  }
}

function parseKind(value: unknown): LspCompletionItemKind | null {
  return isSafeInteger(value) ? (KIND_BY_NUMBER[value] ?? null) : null
}

function parseInsertTextFormat(value: unknown): LspCompletionInsertTextFormat {
  return value === 2 ? 'snippet' : 'plainText'
}

function parseTextEdit(value: unknown): LspCompletionTextEdit | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const raw = value as {
    readonly newText: unknown
    readonly range: unknown
    readonly insert: unknown
    readonly replace: unknown
  }

  if (typeof raw.newText !== 'string') {
    return null
  }

  const range = parseRange(raw.range)

  if (range !== null) {
    return { newText: trim(raw.newText, LSP_COMPLETION_TEXT_MAX_LENGTH), range }
  }

  const insert = parseRange(raw.insert)
  const replace = parseRange(raw.replace)

  if (insert === null || replace === null) {
    return null
  }

  return {
    newText: trim(raw.newText, LSP_COMPLETION_TEXT_MAX_LENGTH),
    range: { insert, replace }
  }
}

function parseRange(value: unknown): TextDocumentRange | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const raw = value as { readonly start: unknown; readonly end: unknown }
  const start = parsePosition(raw.start)
  const end = parsePosition(raw.end)

  return start === null || end === null ? null : { start, end }
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

function parseDocumentation(value: unknown): string | null {
  if (typeof value === 'string') {
    return parseOptionalString(value)
  }

  if (typeof value !== 'object' || value === null) {
    return null
  }

  const raw = value as { readonly value: unknown }

  return parseOptionalString(raw.value)
}

function parseCommitCharacters(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const characters: string[] = []

  for (const entry of value) {
    if (characters.length >= LSP_COMPLETION_COMMIT_CHARACTERS_MAX) {
      break
    }

    if (typeof entry === 'string' && entry.length === 1 && !characters.includes(entry)) {
      characters.push(entry)
    }
  }

  return characters
}

function parseOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0
    ? trim(value, LSP_COMPLETION_TEXT_MAX_LENGTH)
    : null
}

function trim(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}
