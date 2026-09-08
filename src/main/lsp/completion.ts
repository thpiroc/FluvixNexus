import type {
  LspCompletionRequest,
  LspCompletionResponse,
  LspCompletionTriggerKind,
  TextDocumentPosition
} from '@shared/lsp'
import { createLogger } from '../logger'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import { checkLspDocumentFreshness, prepareLspDocumentRequest } from './documentRequest'
import { requestLanguageServer } from './languageServers'
import { parseCompletionResult } from './completionResult'

const log = createLogger('lsp-completion')

export type LspCompletionOutcome = LspCompletionResponse | { readonly status: 'outside-workspace' }

const LSP_COMPLETION = 'textDocument/completion'

export async function requestLspCompletion(
  request: LspCompletionRequest
): Promise<LspCompletionOutcome> {
  const prepared = prepareLspDocumentRequest(request, 'completion', getCurrentWorkspaceFolder)

  if (prepared.status !== 'ready') {
    return prepared
  }

  const pending = requestLanguageServer(
    prepared.serverId,
    LSP_COMPLETION,
    createCompletionParams(
      prepared.uri,
      request.position,
      request.triggerKind,
      request.triggerCharacter
    )
  )

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

  const completion = parseCompletionResult(outcome.result)

  if (completion === null) {
    log.warn(`ignored a malformed "${LSP_COMPLETION}" response.`)
    return { status: 'unavailable' }
  }

  return { status: 'ok', version: request.version, completion }
}

function createCompletionParams(
  uri: string,
  position: TextDocumentPosition,
  triggerKind: LspCompletionTriggerKind | undefined,
  triggerCharacter: string | undefined
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    textDocument: { uri },
    position
  }

  const context = createCompletionContext(triggerKind, triggerCharacter)

  if (context !== null) {
    params.context = context
  }

  return params
}

function createCompletionContext(
  triggerKind: LspCompletionTriggerKind | undefined,
  triggerCharacter: string | undefined
): Record<string, unknown> | null {
  switch (triggerKind) {
    case 'invoked':
      return { triggerKind: 1 }

    case 'trigger-character':
      return triggerCharacter === undefined
        ? { triggerKind: 2 }
        : { triggerKind: 2, triggerCharacter }

    case 'trigger-for-incomplete-completions':
      return { triggerKind: 3 }

    default:
      return null
  }
}
