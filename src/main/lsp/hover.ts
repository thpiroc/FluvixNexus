import type { LspHoverRequest, LspHoverResponse, TextDocumentPosition } from '@shared/lsp'
import { createLogger } from '../logger'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import { checkLspDocumentFreshness, prepareLspDocumentRequest } from './documentRequest'
import { parseHoverResult } from './hoverResult'
import { requestLanguageServer } from './languageServers'

const log = createLogger('lsp-hover')

export type LspHoverOutcome = LspHoverResponse | { readonly status: 'outside-workspace' }

const LSP_HOVER = 'textDocument/hover'

export async function requestLspHover(request: LspHoverRequest): Promise<LspHoverOutcome> {
  const prepared = prepareLspDocumentRequest(request, 'hover', getCurrentWorkspaceFolder)

  if (prepared.status !== 'ready') {
    return prepared
  }

  const pending = requestLanguageServer(prepared.serverId, LSP_HOVER, {
    textDocument: { uri: prepared.uri },
    position: request.position
  })

  if (pending === null) {
    return { status: 'unavailable' }
  }

  const outcome = await pending
  const freshness = checkLspDocumentFreshness(request)

  if (freshness !== null) {
    return freshness
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
