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

import { requestLspFormatting } from './formatting'

function result(value: unknown): Promise<JsonRpcRequestOutcome> {
  return Promise.resolve({ status: 'result', result: value })
}

function formattingRequest(overrides: Record<string, unknown> = {}) {
  return {
    relativePath: 'src/app.ts',
    version: 4,
    options: { tabSize: 2, insertSpaces: true },
    ...overrides
  }
}

describe('requestLspFormatting', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('既存の TypeScript server へ textDocument/formatting を送る', async () => {
    await expect(requestLspFormatting(formattingRequest())).resolves.toEqual({
      status: 'ok',
      version: 4,
      edits: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          text: 'const'
        }
      ]
    })

    expect(mocks.requestLanguageServer).toHaveBeenCalledWith(
      'typescript',
      'textDocument/formatting',
      {
        textDocument: { uri: 'file:///D%3A/proj/src/app.ts' },
        options: { tabSize: 2, insertSpaces: true }
      }
    )
  })

  it('Workspace / 設定 / 同期状態 / server 状態が使えなければ fallback する', async () => {
    mocks.workspace = null
    await expect(requestLspFormatting(formattingRequest())).resolves.toEqual({
      status: 'unavailable'
    })

    resetMocks()
    mocks.allowed = false
    await expect(requestLspFormatting(formattingRequest())).resolves.toEqual({
      status: 'unavailable'
    })

    resetMocks()
    mocks.document = { ...(mocks.document as object), synced: false }
    await expect(requestLspFormatting(formattingRequest())).resolves.toEqual({
      status: 'unavailable'
    })

    resetMocks()
    mocks.requestLanguageServer.mockReturnValue(null)
    await expect(requestLspFormatting(formattingRequest())).resolves.toEqual({
      status: 'unavailable'
    })
  })

  it('Workspace 外の relativePath は拒否する', async () => {
    await expect(
      requestLspFormatting(formattingRequest({ relativePath: '../outside.ts' }))
    ).resolves.toEqual({ status: 'outside-workspace' })
    expect(mocks.requestLanguageServer).not.toHaveBeenCalled()
  })

  it('要求時点と応答後の stale を判定する', async () => {
    await expect(requestLspFormatting(formattingRequest({ version: 3 }))).resolves.toEqual({
      status: 'stale'
    })
    expect(mocks.requestLanguageServer).not.toHaveBeenCalled()

    resetMocks()
    let resolve: (outcome: JsonRpcRequestOutcome) => void = () => undefined
    const pending = new Promise<JsonRpcRequestOutcome>((done) => {
      resolve = done
    })

    mocks.requestLanguageServer.mockReturnValue(pending)

    const formatting = requestLspFormatting(formattingRequest())

    mocks.document = { ...(mocks.document as object), version: 5 }
    resolve({ status: 'result', result: [] })

    await expect(formatting).resolves.toEqual({ status: 'stale' })
  })

  it('malformed / null response は安全に no result にする', async () => {
    mocks.requestLanguageServer.mockReturnValue(result(null))

    await expect(requestLspFormatting(formattingRequest())).resolves.toEqual({
      status: 'ok',
      version: 4,
      edits: []
    })

    mocks.requestLanguageServer.mockReturnValue(result({ edit: true }))

    await expect(requestLspFormatting(formattingRequest())).resolves.toEqual({
      status: 'ok',
      version: 4,
      edits: []
    })
  })

  /* --------------------------------------------------- Python（Session 5-10） */

  /*
    Pyright は `documentFormattingProvider` を出さない。送れば
    `-32601 Unhandled method` が返るだけなので、**要求そのものを出さない**
    （main/lsp/serverCapabilities.ts）。
  */
  it('formatting を出さないサーバ（Pyright）へは要求を送らない', async () => {
    mocks.supported = false
    mocks.document = {
      relativePath: 'src/app.py',
      serverId: 'python',
      languageId: 'python',
      uri: 'file:///D%3A/proj/src/app.py',
      version: 4,
      synced: true
    }

    await expect(
      requestLspFormatting(formattingRequest({ relativePath: 'src/app.py' }))
    ).resolves.toEqual({ status: 'unavailable' })

    expect(mocks.requestLanguageServer).not.toHaveBeenCalled()
  })

  it('formatting を出すサーバなら .py でも送る（別の formatter が入った場合）', async () => {
    mocks.document = {
      relativePath: 'src/app.py',
      serverId: 'python',
      languageId: 'python',
      uri: 'file:///D%3A/proj/src/app.py',
      version: 4,
      synced: true
    }

    await expect(
      requestLspFormatting(formattingRequest({ relativePath: 'src/app.py' }))
    ).resolves.toMatchObject({ status: 'ok', version: 4 })

    expect(mocks.requestLanguageServer).toHaveBeenCalledWith(
      'python',
      'textDocument/formatting',
      expect.objectContaining({ textDocument: { uri: 'file:///D%3A/proj/src/app.py' } })
    )
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
    result([
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        newText: 'const'
      }
    ])
  )
}
