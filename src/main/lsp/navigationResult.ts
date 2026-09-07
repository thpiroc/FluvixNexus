import {
  LSP_NAVIGATION_MAX_LOCATIONS,
  type LspWorkspaceLocation,
  type TextDocumentPosition,
  type TextDocumentRange
} from '@shared/lsp'
import { toWorkspaceRelativePath } from './documentUri'

export function parseDefinitionResult(
  rootPath: string,
  result: unknown
): readonly LspWorkspaceLocation[] | null {
  if (result === null) {
    return []
  }

  if (Array.isArray(result)) {
    return parseLocationList(rootPath, result)
  }

  const location = parseLocationLike(rootPath, result)

  return location === null ? null : [location]
}

export function parseReferencesResult(
  rootPath: string,
  result: unknown
): readonly LspWorkspaceLocation[] | null {
  if (result === null) {
    return []
  }

  return Array.isArray(result) ? parseLocationList(rootPath, result) : null
}

function parseLocationList(
  rootPath: string,
  entries: readonly unknown[]
): readonly LspWorkspaceLocation[] {
  const locations: LspWorkspaceLocation[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    if (locations.length >= LSP_NAVIGATION_MAX_LOCATIONS) {
      break
    }

    const location = parseLocationLike(rootPath, entry)

    if (location === null) {
      continue
    }

    const key = locationKey(location)

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    locations.push(location)
  }

  return locations
}

function parseLocationLike(rootPath: string, value: unknown): LspWorkspaceLocation | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const raw = value as {
    readonly uri: unknown
    readonly range: unknown
    readonly targetUri: unknown
    readonly targetRange: unknown
    readonly targetSelectionRange: unknown
  }

  const relativePath = toWorkspaceRelativePath(rootPath, raw.targetUri ?? raw.uri)

  if (relativePath === null) {
    return null
  }

  const range = parseRange(raw.targetSelectionRange) ?? parseRange(raw.range ?? raw.targetRange)

  return range === null ? null : { relativePath, range }
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

function locationKey(location: LspWorkspaceLocation): string {
  const { range } = location

  return [
    location.relativePath,
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character
  ].join('\0')
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}
