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

import { requestLspHover } from './hover'

function result(value: unknown): Promise<JsonRpcRequestOutcome> {
  return Promise.resolve({ status: 'result', result: value })
}

function hoverRequest(overrides: Record<string, unknown> = {}) {
  return {
    relativePath: 'src/app.ts',
    version: 4,
    position: { line: 1, character: 2 },
    ...overrides
  }
}

describe('requestLspHover', () => {
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
    mocks.requestLanguageServer.mockReturnValue(
      result({ contents: { kind: 'markdown', value: '```ts\nconst answer: number\n```' } })
    )
  })

  it('既存の TypeScript server へ textDocument/hover を送る', async () => {
    await expect(requestLspHover(hoverRequest())).resolves.toEqual({
      status: 'ok',
      version: 4,
      hover: {
        contents: [{ kind: 'markdown', value: '```ts\nconst answer: number\n```' }],
        range: null
      }
    })

    expect(mocks.requestLanguageServer).toHaveBeenCalledWith('typescript', 'textDocument/hover', {
      textDocument: { uri: 'file:///D%3A/proj/src/app.ts' },
      position: { line: 1, character: 2 }
    })
  })

  it('Workspace が無ければ fallback する', async () => {
    mocks.workspace = null

    await expect(requestLspHover(hoverRequest())).resolves.toEqual({ status: 'unavailable' })
    expect(mocks.requestLanguageServer).not.toHaveBeenCalled()
  })

  it('Workspace 外の relativePath は拒否する', async () => {
    await expect(requestLspHover(hoverRequest({ relativePath: '../outside.ts' }))).resolves.toEqual(
      { status: 'outside-workspace' }
    )
    expect(mocks.requestLanguageServer).not.toHaveBeenCalled()
  })

  it('LSP disabled なら fallback する', async () => {
    mocks.allowed = false

    await expect(requestLspHover(hoverRequest())).resolves.toEqual({ status: 'unavailable' })
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

    await expect(requestLspHover(hoverRequest())).resolves.toEqual({ status: 'unavailable' })
    expect(mocks.requestLanguageServer).not.toHaveBeenCalled()
  })

  it('要求時点で版が古ければ stale にする', async () => {
    await expect(requestLspHover(hoverRequest({ version: 3 }))).resolves.toEqual({
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

    const hover = requestLspHover(hoverRequest())

    mocks.document = {
      relativePath: 'src/app.ts',
      serverId: 'typescript',
      languageId: 'typescript',
      uri: 'file:///D%3A/proj/src/app.ts',
      version: 5,
      synced: true
    }
    resolve({ status: 'result', result: { contents: { kind: 'markdown', value: 'old' } } })

    await expect(hover).resolves.toEqual({ status: 'stale' })
  })

  it('server が unavailable / failed / closed なら fallback する', async () => {
    mocks.requestLanguageServer.mockReturnValue(null)

    await expect(requestLspHover(hoverRequest())).resolves.toEqual({ status: 'unavailable' })

    mocks.requestLanguageServer.mockReturnValue(
      Promise.resolve({ status: 'closed', reason: 'the language server exited.' })
    )

    await expect(requestLspHover(hoverRequest())).resolves.toEqual({ status: 'unavailable' })
  })

  it('hover が無い・壊れている場合は no result として返す', async () => {
    mocks.requestLanguageServer.mockReturnValue(result(null))

    await expect(requestLspHover(hoverRequest())).resolves.toEqual({
      status: 'ok',
      version: 4,
      hover: null
    })

    mocks.requestLanguageServer.mockReturnValue(result({ nope: true }))

    await expect(requestLspHover(hoverRequest())).resolves.toEqual({
      status: 'ok',
      version: 4,
      hover: null
    })
  })

  /* --------------------------------------------------- Python（Session 5-10） */

  it('.py は python server へ送り、Pyright の plaintext hover を読む', async () => {
    mocks.document = {
      relativePath: 'src/app.py',
      serverId: 'python',
      languageId: 'python',
      uri: 'file:///D%3A/proj/src/app.py',
      version: 4,
      synced: true
    }
    /*
      Pyright は MarkupContent（kind: 'plaintext'）で返す。実際に繋いで
      受け取った形をそのまま置いてある。
    */
    mocks.requestLanguageServer.mockReturnValue(
      result({
        contents: { kind: 'plaintext', value: '(function) def greet(name: str) -> str' },
        range: { start: { line: 3, character: 14 }, end: { line: 3, character: 19 } }
      })
    )

    await expect(requestLspHover(hoverRequest({ relativePath: 'src/app.py' }))).resolves.toEqual({
      status: 'ok',
      version: 4,
      hover: {
        contents: [{ kind: 'plaintext', value: '(function) def greet(name: str) -> str' }],
        range: { start: { line: 3, character: 14 }, end: { line: 3, character: 19 } }
      }
    })

    expect(mocks.requestLanguageServer).toHaveBeenCalledWith('python', 'textDocument/hover', {
      textDocument: { uri: 'file:///D%3A/proj/src/app.py' },
      position: { line: 1, character: 2 }
    })
  })

  it('hover を出さないサーバへは送らない', async () => {
    mocks.supported = false

    await expect(requestLspHover(hoverRequest())).resolves.toEqual({ status: 'unavailable' })
    expect(mocks.requestLanguageServer).not.toHaveBeenCalled()
  })
})
