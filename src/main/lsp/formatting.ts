import type { LspFormattingRequest, LspFormattingResponse } from '@shared/lsp'
import { createLogger } from '../logger'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import { resolveLspDocumentLanguage } from './documentLanguage'
import { getOpenLspDocument } from './documentSync'
import { resolveWorkspaceDocumentUri } from './documentUri'
import { parseFormattingResult } from './formattingResult'
import { isLanguageServerAllowed } from './languageServerSettings'
import { requestLanguageServer } from './languageServers'

const log = createLogger('lsp-formatting')

export type LspFormattingOutcome = LspFormattingResponse | { readonly status: 'outside-workspace' }

const LSP_FORMATTING = 'textDocument/formatting'

export async function requestLspFormatting(
  request: LspFormattingRequest
): Promise<LspFormattingOutcome> {
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

  const pending = requestLanguageServer(document.serverId, LSP_FORMATTING, {
    textDocument: { uri },
    options: request.options
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

  const edits = parseFormattingResult(outcome.result)

  if (edits === null) {
    log.warn(`ignored a malformed "${LSP_FORMATTING}" response.`)
    return { status: 'ok', version: request.version, edits: [] }
  }

  return { status: 'ok', version: request.version, edits }
}
