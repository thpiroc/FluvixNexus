import { basename, isAbsolute, relative, resolve } from 'path'
import type { DebugCallStackSource, DebugCallStackSourceUnavailableReason } from '@shared/debug'
import { isInsideWorkspace, normalizeWorkspaceRelativePath } from '../files/workspacePath'
import { fileUriToPath } from '../lsp/documentUri'
import { sanitizeLabel } from './dapThreads'

/**
 * DAP StackFrame の `source` を Renderer-safe な形へ落とす（Session 6-5）。
 *
 * `source.path` は絶対パスか file URI になりうる。Workspace 内だけを相対位置へ変換し、
 * それ以外は開けない source として残す。`sourceReference` はここでは読まない。
 */

export function normalizeStackFrameSource(rootPath: string, source: unknown): DebugCallStackSource {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    return unavailable('missing', 'Unknown source')
  }

  const raw = source as { readonly path?: unknown; readonly name?: unknown }
  const fallbackName = sanitizeSourceName(raw.name, 'Unknown source')

  if (typeof raw.path !== 'string' || raw.path.length === 0) {
    return unavailable('missing', fallbackName)
  }

  if (raw.path.includes('\0')) {
    return unavailable('malformed', fallbackName)
  }

  if (raw.path.toLowerCase().startsWith('file:')) {
    const uriPath = fileUriToPath(raw.path)

    return uriPath === null
      ? unavailable('malformed', fallbackName)
      : sourceFromAbsolutePath(rootPath, uriPath, fallbackName)
  }

  if (!isAbsolute(raw.path)) {
    return unavailable('malformed', fallbackName)
  }

  return sourceFromAbsolutePath(rootPath, raw.path, fallbackName)
}

function sourceFromAbsolutePath(
  rootPath: string,
  rawPath: string,
  fallbackName: string
): DebugCallStackSource {
  const absolutePath = resolve(rawPath)

  if (!isInsideWorkspace(rootPath, absolutePath)) {
    return unavailable('outside-workspace', fallbackName)
  }

  const relativePath = normalizeWorkspaceRelativePath(
    relative(resolve(rootPath), absolutePath).replace(/\\/g, '/')
  )

  return relativePath === null || relativePath === ''
    ? unavailable('malformed', fallbackName)
    : workspaceSource(relativePath)
}

function workspaceSource(relativePath: string): DebugCallStackSource {
  return {
    kind: 'workspace',
    relativePath,
    name: basename(relativePath)
  }
}

function unavailable(
  reason: DebugCallStackSourceUnavailableReason,
  name: string
): DebugCallStackSource {
  return { kind: 'unavailable', reason, name }
}

function sanitizeSourceName(raw: unknown, fallback: string): string {
  const label = sanitizeLabel(raw, fallback)
  const lastSegment = label.split(/[\\/]+/).at(-1) ?? label
  const withoutUriScheme = lastSegment.replace(/^[A-Za-z][A-Za-z0-9+.-]*:/, '')
  const safe = withoutUriScheme.trim()

  return safe.length === 0 ? fallback : safe
}
