import type { LspHoverRequest, LspHoverResponse, TextDocumentPosition } from '@shared/lsp'
import { createLogger } from '../logger'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import { resolveLspDocumentLanguage } from './documentLanguage'
import { getOpenLspDocument } from './documentSync'
import { resolveWorkspaceDocumentUri } from './documentUri'
import { parseHoverResult } from './hoverResult'
import { isLanguageServerAllowed } from './languageServerSettings'
import { requestLanguageServer } from './languageServers'

const log = createLogger('lsp-hover')

export type LspHoverOutcome = LspHoverResponse | { readonly status: 'outside-workspace' }

const LSP_HOVER = 'textDocument/hover'

export async function requestLspHover(request: LspHoverRequest): Promise<LspHoverOutcome> {
  const workspace = getCurrentWorkspaceFolder()

  if (workspace === null) {
    return { status: 'unavailable' }
  }

  const uri = resolveWorkspaceDocumentUri(workspace.rootPath, request.relativePath)

  if (uri === null) {
    return { status: 'outside-workspace' }
  }

  const language = resolveLspDocumentLanguage(request.relativePath)

  if (language === null || language.serverId !== 'typescript') {
    return { status: 'unavailable' }
  }

  if (!isLanguageServerAllowed(language.serverId)) {
    return { status: 'unavailable' }
  }

  const document = getOpenLspDocument(request.relativePath)

  if (document === null || !document.synced || document.serverId !== language.serverId) {
    return { status: 'unavailable' }
  }

  if (document.version !== request.version) {
    return { status: 'stale' }
  }

  const pending = requestLanguageServer(document.serverId, LSP_HOVER, {
    textDocument: { uri },
    position: request.position
  })

  if (pending === null) {
    return { status: 'unavailable' }
  }

  const outcome = await pending

  const current = getOpenLspDocument(request.relativePath)

  if (current === null || current.version !== request.version) {
    return { status: 'stale' }
  }

  if (outcome.status !== 'result') {
    return { status: 'unavailable' }
  }

  const hover = parseHoverResult(outcome.result)

  if (hover === null && outcome.result !== null) {
    log.warn(`ignored an empty or malformed "${LSP_HOVER}" response.`)
  }

  return { status: 'ok', version: request.version, hover }
}
