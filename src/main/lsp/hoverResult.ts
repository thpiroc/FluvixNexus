import {
  LSP_HOVER_MAX_CONTENTS,
  LSP_HOVER_TEXT_MAX_LENGTH,
  type LspHover,
  type LspHoverContent,
  type LspHoverContentKind,
  type TextDocumentPosition,
  type TextDocumentRange
} from '@shared/lsp'

export function parseHoverResult(result: unknown): LspHover | null {
  if (result === null) {
    return null
  }

  if (typeof result !== 'object') {
    return null
  }

  const raw = result as { readonly contents: unknown; readonly range: unknown }
  const contents = parseHoverContents(raw.contents)

  if (contents.length === 0) {
    return null
  }

  return {
    contents,
    range: parseRange(raw.range)
  }
}

function parseHoverContents(value: unknown): readonly LspHoverContent[] {
  const contents = Array.isArray(value) ? value : [value]
  const parsed: LspHoverContent[] = []

  for (const content of contents) {
    if (parsed.length >= LSP_HOVER_MAX_CONTENTS) {
      break
    }

    const item = parseHoverContent(content)

    if (item !== null) {
      parsed.push(item)
    }
  }

  return parsed
}

function parseHoverContent(value: unknown): LspHoverContent | null {
  if (typeof value === 'string') {
    return textContent('plaintext', value)
  }

  if (typeof value !== 'object' || value === null) {
    return null
  }

  const raw = value as {
    readonly kind: unknown
    readonly value: unknown
    readonly language: unknown
  }

  if (raw.kind === 'markdown' || raw.kind === 'plaintext') {
    return typeof raw.value === 'string' ? textContent(raw.kind, raw.value) : null
  }

  if (typeof raw.language === 'string' && typeof raw.value === 'string') {
    const language = normalizeCodeFenceLanguage(raw.language)
    const fence = codeFenceFor(raw.value)

    return textContent('markdown', `${fence}${language}\n${raw.value}\n${fence}`)
  }

  return null
}

function textContent(kind: LspHoverContentKind, value: string): LspHoverContent | null {
  const trimmed = trim(value)

  return trimmed.length === 0 ? null : { kind, value: trimmed }
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

function normalizeCodeFenceLanguage(value: string): string {
  return value.replace(/[^\w#+.-]/g, '').slice(0, 32)
}

function codeFenceFor(value: string): string {
  const runs = value.match(/`+/g) ?? []
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 2)

  return '`'.repeat(longest + 1)
}

function trim(value: string): string {
  const trimmed = value.trim()

  return trimmed.length <= LSP_HOVER_TEXT_MAX_LENGTH
    ? trimmed
    : trimmed.slice(0, LSP_HOVER_TEXT_MAX_LENGTH)
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}
