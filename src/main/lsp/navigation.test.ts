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

import { requestLspDefinition, requestLspReferences } from './navigation'

function result(value: unknown): Promise<JsonRpcRequestOutcome> {
  return Promise.resolve({ status: 'result', result: value })
}

function range(line = 1, character = 2): Record<string, unknown> {
  return {
    start: { line, character },
    end: { line, character: character + 4 }
  }
}

function definitionRequest(overrides: Record<string, unknown> = {}) {
  return {
    relativePath: 'src/app.ts',
    version: 4,
    position: { line: 1, character: 2 },
    ...overrides
  }
}

function referencesRequest(overrides: Record<string, unknown> = {}) {
  return {
    relativePath: 'src/app.ts',
    version: 4,
    position: { line: 1, character: 2 },
    includeDeclaration: true,
    ...overrides
  }
}

describe('requestLspDefinition', () => {
  beforeEach(() => {
    resetMocks()
    mocks.requestLanguageServer.mockReturnValue(
      result({ uri: 'file:///D%3A/proj/src/target.ts', range: range(4, 6) })
    )
  })

  it('既存の TypeScript server へ textDocument/definition を送る', async () => {
    await expect(requestLspDefinition(definitionRequest())).resolves.toEqual({
      status: 'ok',
      version: 4,
      definitions: [
        {
          relativePath: 'src/target.ts',
          range: { start: { line: 4, character: 6 }, end: { line: 4, character: 10 } }
        }
      ]
    })

    expect(mocks.requestLanguageServer).toHaveBeenCalledWith(
      'typescript',
      'textDocument/definition',
      {
        textDocument: { uri: 'file:///D%3A/proj/src/app.ts' },
        position: { line: 1, character: 2 }
      }
    )
  })

  it('Workspace / 設定 / 同期状態 / server 状態が使えなければ fallback する', async () => {
    mocks.workspace = null
    await expect(requestLspDefinition(definitionRequest())).resolves.toEqual({
      status: 'unavailable'
    })

    resetMocks()
    mocks.allowed = false
    await expect(requestLspDefinition(definitionRequest())).resolves.toEqual({
      status: 'unavailable'
    })

    resetMocks()
    mocks.document = { ...(mocks.document as object), synced: false }
    await expect(requestLspDefinition(definitionRequest())).resolves.toEqual({
      status: 'unavailable'
    })

    resetMocks()
    mocks.requestLanguageServer.mockReturnValue(null)
    await expect(requestLspDefinition(definitionRequest())).resolves.toEqual({
      status: 'unavailable'
    })
  })

  it('Workspace 外の relativePath は拒否する', async () => {
    await expect(
      requestLspDefinition(definitionRequest({ relativePath: '../outside.ts' }))
    ).resolves.toEqual({ status: 'outside-workspace' })
    expect(mocks.requestLanguageServer).not.toHaveBeenCalled()
  })

  it('要求時点と応答後の stale を判定する', async () => {
    await expect(requestLspDefinition(definitionRequest({ version: 3 }))).resolves.toEqual({
      status: 'stale'
    })
    expect(mocks.requestLanguageServer).not.toHaveBeenCalled()

    resetMocks()
    let resolve: (outcome: JsonRpcRequestOutcome) => void = () => undefined
    const pending = new Promise<JsonRpcRequestOutcome>((done) => {
      resolve = done
    })

    mocks.requestLanguageServer.mockReturnValue(pending)

    const definition = requestLspDefinition(definitionRequest())

    mocks.document = { ...(mocks.document as object), version: 5 }
    resolve({ status: 'result', result: { uri: 'file:///D%3A/proj/src/app.ts', range: range() } })

    await expect(definition).resolves.toEqual({ status: 'stale' })
  })

  it('壊れた response は no result にする', async () => {
    mocks.requestLanguageServer.mockReturnValue(result('nope'))

    await expect(requestLspDefinition(definitionRequest())).resolves.toEqual({
      status: 'ok',
      version: 4,
      definitions: []
    })
  })
})

describe('requestLspReferences', () => {
  beforeEach(() => {
    resetMocks()
    mocks.requestLanguageServer.mockReturnValue(
      result([{ uri: 'file:///D%3A/proj/src/app.ts', range: range(8, 2) }])
    )
  })

  it('既存の TypeScript server へ textDocument/references を送る', async () => {
    await expect(
      requestLspReferences(referencesRequest({ includeDeclaration: false }))
    ).resolves.toEqual({
      status: 'ok',
      version: 4,
      references: [
        {
          relativePath: 'src/app.ts',
          range: { start: { line: 8, character: 2 }, end: { line: 8, character: 6 } }
        }
      ]
    })

    expect(mocks.requestLanguageServer).toHaveBeenCalledWith(
      'typescript',
      'textDocument/references',
      {
        textDocument: { uri: 'file:///D%3A/proj/src/app.ts' },
        position: { line: 1, character: 2 },
        context: { includeDeclaration: false }
      }
    )
  })

  it('server が closed なら fallback し、malformed は no result にする', async () => {
    mocks.requestLanguageServer.mockReturnValue(
      Promise.resolve({ status: 'closed', reason: 'the language server exited.' })
    )

    await expect(requestLspReferences(referencesRequest())).resolves.toEqual({
      status: 'unavailable'
    })

    mocks.requestLanguageServer.mockReturnValue(result({ uri: 'file:///D%3A/proj/src/app.ts' }))

    await expect(requestLspReferences(referencesRequest())).resolves.toEqual({
      status: 'ok',
      version: 4,
      references: []
    })
  })

  /* --------------------------------------------------- Python（Session 5-10） */

  it('.py の定義は python server へ送り、workspace 内の別ファイルへ解決する', async () => {
    mocks.document = {
      relativePath: 'src/app.py',
      serverId: 'python',
      languageId: 'python',
      uri: 'file:///D%3A/proj/src/app.py',
      version: 4,
      synced: true
    }
    mocks.requestLanguageServer.mockReturnValue(
      result([
        {
          uri: 'file:///D%3A/proj/src/lib.py',
          range: { start: { line: 0, character: 4 }, end: { line: 0, character: 9 } }
        }
      ])
    )

    await expect(
      requestLspDefinition(definitionRequest({ relativePath: 'src/app.py' }))
    ).resolves.toEqual({
      status: 'ok',
      version: 4,
      definitions: [
        {
          relativePath: 'src/lib.py',
          range: { start: { line: 0, character: 4 }, end: { line: 0, character: 9 } }
        }
      ]
    })

    expect(mocks.requestLanguageServer).toHaveBeenCalledWith(
      'python',
      'textDocument/definition',
      expect.objectContaining({ textDocument: { uri: 'file:///D%3A/proj/src/app.py' } })
    )
  })

  it('.py の参照も python server へ送る', async () => {
    mocks.document = {
      relativePath: 'src/app.py',
      serverId: 'python',
      languageId: 'python',
      uri: 'file:///D%3A/proj/src/app.py',
      version: 4,
      synced: true
    }
    mocks.requestLanguageServer.mockReturnValue(
      result([{ uri: 'file:///D%3A/proj/src/app.py', range: range(2, 4) }])
    )

    await expect(
      requestLspReferences(referencesRequest({ relativePath: 'src/app.py' }))
    ).resolves.toMatchObject({ status: 'ok', version: 4 })

    expect(mocks.requestLanguageServer).toHaveBeenCalledWith(
      'python',
      'textDocument/references',
      expect.objectContaining({ textDocument: { uri: 'file:///D%3A/proj/src/app.py' } })
    )
  })

  it('definition / references を出さないサーバへは送らない', async () => {
    mocks.supported = false

    await expect(requestLspDefinition(definitionRequest())).resolves.toEqual({
      status: 'unavailable'
    })
    await expect(requestLspReferences(referencesRequest())).resolves.toEqual({
      status: 'unavailable'
    })
    expect(mocks.requestLanguageServer).not.toHaveBeenCalled()
  })
})

function resetMocks(): void {
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
  mocks.requestLanguageServer.mockReturnValue(
    result({ uri: 'file:///D%3A/proj/src/app.ts', range: range() })
  )
}
