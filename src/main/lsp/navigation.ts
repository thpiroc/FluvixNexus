import type {
  LspDefinitionRequest,
  LspDefinitionResponse,
  LspReferencesRequest,
  LspReferencesResponse,
  TextDocumentPosition
} from '@shared/lsp'
import { createLogger } from '../logger'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import { resolveLspDocumentLanguage } from './documentLanguage'
import { getOpenLspDocument } from './documentSync'
import { resolveWorkspaceDocumentUri } from './documentUri'
import { isLanguageServerAllowed } from './languageServerSettings'
import { requestLanguageServer } from './languageServers'
import { parseDefinitionResult, parseReferencesResult } from './navigationResult'

const log = createLogger('lsp-navigation')

export type LspDefinitionOutcome = LspDefinitionResponse | { readonly status: 'outside-workspace' }

export type LspReferencesOutcome = LspReferencesResponse | { readonly status: 'outside-workspace' }

const LSP_DEFINITION = 'textDocument/definition'
const LSP_REFERENCES = 'textDocument/references'

export async function requestLspDefinition(
  request: LspDefinitionRequest
): Promise<LspDefinitionOutcome> {
  const prepared = prepareNavigationRequest(request)

  if (prepared.status !== 'ready') {
    return prepared
  }

  const pending = requestLanguageServer(prepared.serverId, LSP_DEFINITION, {
    textDocument: { uri: prepared.uri },
    position: request.position
  })

  if (pending === null) {
    return { status: 'unavailable' }
  }

  const outcome = await pending
  const freshness = checkFreshness(request)

  if (freshness !== null) {
    return freshness
  }

  if (outcome.status !== 'result') {
    return { status: 'unavailable' }
  }

  const definitions = parseDefinitionResult(prepared.rootPath, outcome.result)

  if (definitions === null) {
    log.warn(`ignored a malformed "${LSP_DEFINITION}" response.`)
    return { status: 'ok', version: request.version, definitions: [] }
  }

  return { status: 'ok', version: request.version, definitions }
}

export async function requestLspReferences(
  request: LspReferencesRequest
): Promise<LspReferencesOutcome> {
  const prepared = prepareNavigationRequest(request)

  if (prepared.status !== 'ready') {
    return prepared
  }

  const pending = requestLanguageServer(prepared.serverId, LSP_REFERENCES, {
    textDocument: { uri: prepared.uri },
    position: request.position,
    context: { includeDeclaration: request.includeDeclaration }
  })

  if (pending === null) {
    return { status: 'unavailable' }
  }

  const outcome = await pending
  const freshness = checkFreshness(request)

  if (freshness !== null) {
    return freshness
  }

  if (outcome.status !== 'result') {
    return { status: 'unavailable' }
  }

  const references = parseReferencesResult(prepared.rootPath, outcome.result)

  if (references === null) {
    log.warn(`ignored a malformed "${LSP_REFERENCES}" response.`)
    return { status: 'ok', version: request.version, references: [] }
  }

  return { status: 'ok', version: request.version, references }
}

type PreparedNavigationRequest =
  | {
      readonly status: 'ready'
      readonly rootPath: string
      readonly uri: string
      readonly serverId: 'typescript'
    }
  | { readonly status: 'outside-workspace' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'stale' }

function prepareNavigationRequest(request: {
  readonly relativePath: string
  readonly version: number
  readonly position: TextDocumentPosition
}): PreparedNavigationRequest {
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

  return { status: 'ready', rootPath: workspace.rootPath, uri, serverId: language.serverId }
}

function checkFreshness(request: {
  readonly relativePath: string
  readonly version: number
}): { readonly status: 'stale' } | null {
  const current = getOpenLspDocument(request.relativePath)

  return current === null || current.version !== request.version ? { status: 'stale' } : null
}
