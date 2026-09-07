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
  requestLanguageServer: vi.fn(),
  realpath: vi.fn(),
  stat: vi.fn()
}))

vi.mock('fs/promises', () => ({
  realpath: mocks.realpath,
  stat: mocks.stat
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
  requestLanguageServer: mocks.requestLanguageServer
}))

import { requestLspPrepareRename, requestLspRename } from './rename'

/**
 * Rename の Main 側（Session 5-9）。
 *
 * 確かめたいことは3つに分かれる。
 *
 *   1. built-in へ落とす条件（`unavailable`）と、落としてはいけない条件（`rejected`）
 *   2. 古い版・Workspace の外・扱えない答えを、書き換える前に断つこと
 *   3. 返す先が**実在するファイル**であることを、実体まで見て確かめること
 *
 * 3 が他の機能に無い確かめで、答えが「見せる先」ではなく
 * **「書き換える先」**であることによる（rename.ts の冒頭）。
 */

function result(value: unknown): Promise<JsonRpcRequestOutcome> {
  return Promise.resolve({ status: 'result', result: value })
}

function error(code: number): Promise<JsonRpcRequestOutcome> {
  return Promise.resolve({ status: 'error', error: { code, message: 'no' } })
}

function uri(relativePath: string): string {
  return `file:///D%3A/proj/${relativePath}`
}

function range(line = 1, character = 2): Record<string, unknown> {
  return { start: { line, character }, end: { line, character: character + 4 } }
}

function renameRequest(overrides: Record<string, unknown> = {}) {
  return {
    relativePath: 'src/app.ts',
    version: 4,
    position: { line: 1, character: 2 },
    newName: 'renamed',
    ...overrides
  }
}

function prepareRequest(overrides: Record<string, unknown> = {}) {
  return {
    relativePath: 'src/app.ts',
    version: 4,
    position: { line: 1, character: 2 },
    ...overrides
  }
}

function resetMocks(): void {
  mocks.workspace = { id: 'workspace-1', rootPath: 'D:\\proj' }
  mocks.allowed = true
  mocks.document = {
    relativePath: 'src/app.ts',
    serverId: 'typescript',
    languageId: 'typescript',
    uri: uri('src/app.ts'),
    version: 4,
    synced: true
  }
  mocks.requestLanguageServer.mockReset()
  // 既定では「すべて Workspace の中の実在するファイル」。
  mocks.realpath.mockReset()
  mocks.realpath.mockImplementation(async (path: string) => path)
  mocks.stat.mockReset()
  mocks.stat.mockResolvedValue({ isFile: () => true })
}

describe('requestLspRename', () => {
  beforeEach(() => {
    resetMocks()
    mocks.requestLanguageServer.mockReturnValue(
      result({ changes: { [uri('src/app.ts')]: [{ range: range(), newText: 'renamed' }] } })
    )
  })

  it('workspace-relative path と TextEdit だけを返す（URI は出さない）', async () => {
    const outcome = await requestLspRename(renameRequest())

    expect(outcome).toEqual({
      status: 'ok',
      version: 4,
      documents: [
        {
          relativePath: 'src/app.ts',
          edits: [
            {
              range: { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } },
              text: 'renamed'
            }
          ]
        }
      ]
    })
    expect(JSON.stringify(outcome)).not.toContain('file:///')
    expect(JSON.stringify(outcome)).not.toContain('D:')
  })

  it('複数ファイルへの edit をまとめて返す（cross-file）', async () => {
    mocks.requestLanguageServer.mockReturnValue(
      result({
        changes: {
          [uri('src/app.ts')]: [{ range: range(), newText: 'renamed' }],
          [uri('src/lib/util.ts')]: [{ range: range(0, 0), newText: 'renamed' }]
        }
      })
    )

    const outcome = await requestLspRename(renameRequest())

    expect(outcome.status === 'ok' && outcome.documents.map((entry) => entry.relativePath)).toEqual(
      ['src/app.ts', 'src/lib/util.ts']
    )
  })

  it('固定した method と、Main が組み立てた URI で送る', async () => {
    await requestLspRename(renameRequest())

    expect(mocks.requestLanguageServer).toHaveBeenCalledWith('typescript', 'textDocument/rename', {
      textDocument: { uri: uri('src/app.ts') },
      position: { line: 1, character: 2 },
      newName: 'renamed'
    })
  })

  it.each([
    ['空', ''],
    ['空白だけ', '   '],
    ['改行を含む', 'a\nb'],
    ['長すぎる', 'x'.repeat(257)]
  ])('受け取れない名前（%s）は、サーバへ送らずに断る', async (_label, newName) => {
    const outcome = await requestLspRename(renameRequest({ newName }))

    expect(outcome).toEqual({ status: 'rejected', reason: 'invalid-name' })
    expect(mocks.requestLanguageServer).not.toHaveBeenCalled()
  })

  it('版が合わなければ、サーバへ送らずに stale', async () => {
    const outcome = await requestLspRename(renameRequest({ version: 3 }))

    expect(outcome).toEqual({ status: 'stale' })
    expect(mocks.requestLanguageServer).not.toHaveBeenCalled()
  })

  it('答えを待っている間に文書が変われば、適用させない', async () => {
    mocks.requestLanguageServer.mockImplementation(() => {
      mocks.document = { ...(mocks.document as Record<string, unknown>), version: 5 }

      return result({ changes: { [uri('src/app.ts')]: [{ range: range(), newText: 'renamed' }] } })
    })

    expect(await requestLspRename(renameRequest())).toEqual({ status: 'stale' })
  })

  it('Workspace の外を指す相対位置は outside-workspace', async () => {
    const outcome = await requestLspRename(renameRequest({ relativePath: '../outside.ts' }))

    expect(outcome).toEqual({ status: 'outside-workspace' })
    expect(mocks.requestLanguageServer).not.toHaveBeenCalled()
  })

  /**
   * ここが「見せる先」と「書き換える先」の違い。
   *
   * 文字列としては Workspace の中でも、実体が外を指していれば書かない
   * （Workspace の中に置いた symlink が外を指している場合）。
   */
  it('実体が Workspace の外を指すファイルは断る', async () => {
    mocks.realpath.mockImplementation(async (path: string) =>
      path.includes('app.ts') ? 'C:\\elsewhere\\app.ts' : path
    )

    expect(await requestLspRename(renameRequest())).toEqual({
      status: 'rejected',
      reason: 'outside-workspace'
    })
  })

  it('消えているファイルへの edit は断る', async () => {
    mocks.realpath.mockImplementation(async (path: string) => {
      if (path.includes('app.ts')) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      }

      return path
    })

    expect(await requestLspRename(renameRequest())).toEqual({
      status: 'rejected',
      reason: 'outside-workspace'
    })
  })

  it('ファイルではないもの（フォルダ）への edit は断る', async () => {
    mocks.stat.mockResolvedValue({ isFile: () => false })

    expect(await requestLspRename(renameRequest())).toEqual({
      status: 'rejected',
      reason: 'outside-workspace'
    })
  })

  it('資源操作が混ざった答えは rejected（built-in へは落とさない）', async () => {
    mocks.requestLanguageServer.mockReturnValue(
      result({
        documentChanges: [
          { textDocument: { uri: uri('src/app.ts'), version: 4 }, edits: [] },
          { kind: 'delete', uri: uri('src/app.ts') }
        ]
      })
    )

    expect(await requestLspRename(renameRequest())).toEqual({
      status: 'rejected',
      reason: 'unsupported-edit'
    })
  })

  it.each([
    ['Workspace が開いていない', () => (mocks.workspace = null)],
    ['設定で OFF', () => (mocks.allowed = false)],
    ['同期していない文書', () => (mocks.document = null)],
    ['サーバが立っていない', () => mocks.requestLanguageServer.mockReturnValue(null)],
    [
      '経路が閉じた',
      () =>
        mocks.requestLanguageServer.mockReturnValue(
          Promise.resolve({ status: 'closed', reason: 'exit' })
        )
    ]
  ])('%s のときは unavailable（built-in へ落とす）', async (_label, arrange) => {
    arrange()

    expect((await requestLspRename(renameRequest())).status).toBe('unavailable')
  })

  it('method が無い（古いサーバ）ときも unavailable', async () => {
    mocks.requestLanguageServer.mockReturnValue(error(-32601))

    expect((await requestLspRename(renameRequest())).status).toBe('unavailable')
  })

  /**
   * サーバが失敗を返したときは built-in へ落とさない。
   *
   * 落とすと、本物のサーバが断った Rename を、tsconfig も node_modules も
   * 見ていない内蔵の側が実行することになる（rename.ts の冒頭）。
   */
  it('サーバが失敗を返したときは rejected（unavailable にしない）', async () => {
    mocks.requestLanguageServer.mockReturnValue(error(-32603))

    expect(await requestLspRename(renameRequest())).toEqual({
      status: 'rejected',
      reason: 'server-error'
    })
  })

  it('対応するサーバが無い拡張子は unavailable', async () => {
    expect((await requestLspRename(renameRequest({ relativePath: 'notes.md' }))).status).toBe(
      'unavailable'
    )
  })
})

describe('requestLspPrepareRename', () => {
  beforeEach(() => {
    resetMocks()
    mocks.requestLanguageServer.mockReturnValue(result({ range: range(), placeholder: 'value' }))
  })

  it('範囲と初期値を返す', async () => {
    expect(await requestLspPrepareRename(prepareRequest())).toEqual({
      status: 'ok',
      version: 4,
      range: { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } },
      placeholder: 'value'
    })
  })

  it('固定した method で送る（新しい名前は載らない）', async () => {
    await requestLspPrepareRename(prepareRequest())

    expect(mocks.requestLanguageServer).toHaveBeenCalledWith(
      'typescript',
      'textDocument/prepareRename',
      { textDocument: { uri: uri('src/app.ts') }, position: { line: 1, character: 2 } }
    )
  })

  it('null（変えられない位置）は rejected', async () => {
    mocks.requestLanguageServer.mockReturnValue(result(null))

    expect(await requestLspPrepareRename(prepareRequest())).toEqual({
      status: 'rejected',
      reason: 'not-renameable'
    })
  })

  it('サーバが失敗を返した位置も rejected（built-in へ落とさない）', async () => {
    mocks.requestLanguageServer.mockReturnValue(error(-32603))

    expect(await requestLspPrepareRename(prepareRequest())).toEqual({
      status: 'rejected',
      reason: 'not-renameable'
    })
  })

  it('method が無いサーバは unavailable（built-in へ落とす）', async () => {
    mocks.requestLanguageServer.mockReturnValue(error(-32601))

    expect((await requestLspPrepareRename(prepareRequest())).status).toBe('unavailable')
  })

  it('版が合わなければ stale', async () => {
    expect(await requestLspPrepareRename(prepareRequest({ version: 3 }))).toEqual({
      status: 'stale'
    })
  })

  it('Workspace の外は outside-workspace', async () => {
    expect(await requestLspPrepareRename(prepareRequest({ relativePath: '../x.ts' }))).toEqual({
      status: 'outside-workspace'
    })
  })
})
