import type { LspFormattingRequest, LspFormattingResponse } from '@shared/lsp'
import { createLogger } from '../logger'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import { checkLspDocumentFreshness, prepareLspDocumentRequest } from './documentRequest'
import { parseFormattingResult } from './formattingResult'
import { requestLanguageServer } from './languageServers'

const log = createLogger('lsp-formatting')

export type LspFormattingOutcome = LspFormattingResponse | { readonly status: 'outside-workspace' }

const LSP_FORMATTING = 'textDocument/formatting'

export async function requestLspFormatting(
  request: LspFormattingRequest
): Promise<LspFormattingOutcome> {
  /*
    `formatting` を出さないサーバではここで `unavailable` になる。
    Pyright がまさにそれで、Python の整形は要求そのものが送られない
    （main/lsp/serverCapabilities.ts）。
  */
  const prepared = prepareLspDocumentRequest(request, 'formatting', getCurrentWorkspaceFolder)

  if (prepared.status !== 'ready') {
    return prepared
  }

  const pending = requestLanguageServer(prepared.serverId, LSP_FORMATTING, {
    textDocument: { uri: prepared.uri },
    options: request.options
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

  const edits = parseFormattingResult(outcome.result)

  if (edits === null) {
    log.warn(`ignored a malformed "${LSP_FORMATTING}" response.`)
    return { status: 'ok', version: request.version, edits: [] }
  }

  return { status: 'ok', version: request.version, edits }
}
