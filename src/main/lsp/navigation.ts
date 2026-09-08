import type {
  LspDefinitionRequest,
  LspDefinitionResponse,
  LspReferencesRequest,
  LspReferencesResponse
} from '@shared/lsp'
import { createLogger } from '../logger'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import {
  checkLspDocumentFreshness as checkFreshness,
  prepareLspDocumentRequest
} from './documentRequest'
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
  const prepared = prepareLspDocumentRequest(request, 'definition', getCurrentWorkspaceFolder)

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
  const prepared = prepareLspDocumentRequest(request, 'references', getCurrentWorkspaceFolder)

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

/*
  要求を出す前の確認（Workspace・言語・設定・同期・版）と、応答が返った後の
  版の見直しは main/lsp/documentRequest.ts に移した（Session 5-10）。
  同じ6段を5つの機能が別々に持っていたためで、Python を足すのに
  5箇所を同じように直す形にしないための移動になる。
*/
