import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JsonRpcRequestOutcome } from './jsonRpcConnection'

const mocks = vi.hoisted(() => ({
  workspace: { id: 'workspace-1', rootPath: 'D:\\proj' } as { id: string; rootPath: string } | null,
  allowed: true,
  document: {
    relativePath: 'src/app.ts',
    serverId: 'typescript',
    languageId: 'typescript',
    uri: 'file:///D%3A/proj/src/app.ts',
    version: 4,
    synced: true
  } as unknown,
  supported: true,
  requestLanguageServer: vi.fn()
}))

vi.mock('../workspaceFolder/currentWorkspaceFolder', () => ({
  getCurrentWorkspaceFolder: () => mocks.workspace
}))

vi.mock('../logger', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  })
}))

vi.mock('./languageServerSettings', () => ({
  isLanguageServerAllowed: () => mocks.allowed
}))

vi.mock('./documentSync', () => ({
  getOpenLspDocument: () => mocks.document
}))

vi.mock('./languageServers', () => ({
  requestLanguageServer: mocks.requestLanguageServer,
  supportsLanguageServerFeature: () => mocks.supported
}))

import { requestLspCompletion } from './completion'

function result(value: unknown): Promise<JsonRpcRequestOutcome> {
  return Promise.resolve({ status: 'result', result: value })
}

function completionRequest(overrides: Record<string, unknown> = {}) {
  return {
    relativePath: 'src/app.ts',
    version: 4,
    position: { line: 1, character: 2 },
    ...overrides
  }
}

describe('requestLspCompletion', () => {
  beforeEach(() => {
    mocks.workspace = { id: 'workspace-1', rootPath: 'D:\\proj' }
    mocks.allowed = true
    mocks.supported = true
    mocks.document = {
      relativePath: 'src/app.ts',
      serverId: 'typescript',
      languageId: 'typescript',
      uri: 'file:///D%3A/proj/src/app.ts',
      version: 4,
      synced: true
    }
    mocks.requestLanguageServer.mockReset()
    mocks.requestLanguageServer.mockReturnValue(result([{ label: 'console', kind: 6 }]))
  })

  it('既存の TypeScript server へ textDocument/completion を送る', async () => {
    await expect(requestLspCompletion(completionRequest())).resolves.toEqual({
      status: 'ok',
      version: 4,
      completion: {
        isIncomplete: false,
        items: [
          expect.objectContaining({
            label: 'console',
            kind: 'variable'
          })
        ]
      }
    })

    expect(mocks.requestLanguageServer).toHaveBeenCalledWith(
      'typescript',
      'textDocument/completion',
      {
        textDocument: { uri: 'file:///D%3A/proj/src/app.ts' },
        position: { line: 1, character: 2 }
      }
    )
  })

  it('Workspace が無ければ fallback する', async () => {
    mocks.workspace = null

    await expect(requestLspCompletion(completionRequest())).resolves.toEqual({
      status: 'unavailable'
    })
    expect(mocks.requestLanguageServer).not.toHaveBeenCalled()
  })

  it('Workspace 外の relativePath は拒否する', async () => {
    await expect(
      requestLspCompletion(completionRequest({ relativePath: '../outside.ts' }))
    ).resolves.toEqual({ status: 'outside-workspace' })
    expect(mocks.requestLanguageServer).not.toHaveBeenCalled()
  })

  it('LSP disabled なら fallback する', async () => {
    mocks.allowed = false

    await expect(requestLspCompletion(completionRequest())).resolves.toEqual({
      status: 'unavailable'
    })
    expect(mocks.requestLanguageServer).not.toHaveBeenCalled()
  })

  it('文書が同期済みでなければ fallback する', async () => {
    mocks.document = {
      relativePath: 'src/app.ts',
      serverId: 'typescript',
      languageId: 'typescript',
      uri: 'file:///D%3A/proj/src/app.ts',
      version: 4,
      synced: false
    }

    await expect(requestLspCompletion(completionRequest())).resolves.toEqual({
      status: 'unavailable'
    })
    expect(mocks.requestLanguageServer).not.toHaveBeenCalled()
  })

  it('要求時点で版が古ければ stale にする', async () => {
    await expect(requestLspCompletion(completionRequest({ version: 3 }))).resolves.toEqual({
      status: 'stale'
    })
    expect(mocks.requestLanguageServer).not.toHaveBeenCalled()
  })

  it('応答待ちの間に版が進んだら stale にする', async () => {
    let resolve: (outcome: JsonRpcRequestOutcome) => void = () => undefined
    const pending = new Promise<JsonRpcRequestOutcome>((done) => {
      resolve = done
    })

    mocks.requestLanguageServer.mockReturnValue(pending)

    const completion = requestLspCompletion(completionRequest())

    mocks.document = {
      relativePath: 'src/app.ts',
      serverId: 'typescript',
      languageId: 'typescript',
      uri: 'file:///D%3A/proj/src/app.ts',
      version: 5,
      synced: true
    }
    resolve({ status: 'result', result: [{ label: 'old' }] })

    await expect(completion).resolves.toEqual({ status: 'stale' })
  })

  it('server が unavailable / failed / closed なら fallback する', async () => {
    mocks.requestLanguageServer.mockReturnValue(null)

    await expect(requestLspCompletion(completionRequest())).resolves.toEqual({
      status: 'unavailable'
    })

    mocks.requestLanguageServer.mockReturnValue(
      Promise.resolve({ status: 'closed', reason: 'the language server exited.' })
    )

    await expect(requestLspCompletion(completionRequest())).resolves.toEqual({
      status: 'unavailable'
    })
  })

  it('壊れた completion response は fallback する', async () => {
    mocks.requestLanguageServer.mockReturnValue(result({ nope: true }))

    await expect(requestLspCompletion(completionRequest())).resolves.toEqual({
      status: 'unavailable'
    })
  })

  /* --------------------------------------------------- Python（Session 5-10） */

  it('.py は python server へ送る（Renderer はサーバを名指ししない）', async () => {
    mocks.document = {
      relativePath: 'src/app.py',
      serverId: 'python',
      languageId: 'python',
      uri: 'file:///D%3A/proj/src/app.py',
      version: 4,
      synced: true
    }
    mocks.requestLanguageServer.mockReturnValue(
      result({ items: [{ label: 'upper', kind: 2, sortText: '09.9999.upper' }] })
    )

    await expect(
      requestLspCompletion(completionRequest({ relativePath: 'src/app.py' }))
    ).resolves.toEqual({
      status: 'ok',
      version: 4,
      completion: {
        isIncomplete: false,
        items: [expect.objectContaining({ label: 'upper', kind: 'method' })]
      }
    })

    expect(mocks.requestLanguageServer).toHaveBeenCalledWith(
      'python',
      'textDocument/completion',
      expect.objectContaining({ textDocument: { uri: 'file:///D%3A/proj/src/app.py' } })
    )
  })

  it('completion を出さないサーバへは送らない', async () => {
    mocks.supported = false

    await expect(requestLspCompletion(completionRequest())).resolves.toEqual({
      status: 'unavailable'
    })
    expect(mocks.requestLanguageServer).not.toHaveBeenCalled()
  })
})
