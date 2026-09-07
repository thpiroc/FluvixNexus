import type { LanguageServerStatus } from '@shared/lsp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const providers = new Map<
    string,
    {
      provideRenameEdits: Function
      resolveRenameLocation: Function
    }
  >()
  const worker = {
    getRenameInfo: vi.fn(),
    findRenameLocations: vi.fn()
  }

  return {
    providers,
    worker,
    models: new Map<string, unknown>(),
    prepareRename: vi.fn(),
    rename: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    setBuiltInRenameSuppressed: vi.fn(),
    registerRenameProvider: vi.fn((languageId: string, provider: unknown) => {
      providers.set(
        languageId,
        provider as { provideRenameEdits: Function; resolveRenameLocation: Function }
      )

      return { dispose: vi.fn(() => providers.delete(languageId)) }
    }),
    getTypeScriptWorker: vi.fn(async () => async () => worker),
    getJavaScriptWorker: vi.fn(async () => async () => worker)
  }
})

vi.mock('../../api/fluvix', () => ({
  fluvix: {
    lsp: { prepareRename: mocks.prepareRename, rename: mocks.rename },
    files: { readFile: mocks.readFile, writeFile: mocks.writeFile }
  }
}))

vi.mock('./monacoSetup', () => ({
  monaco: {
    languages: { registerRenameProvider: mocks.registerRenameProvider },
    editor: {
      getModel: (uri: { toString: () => string }) => mocks.models.get(uri.toString()) ?? null
    },
    Uri: { parse: (value: string) => ({ toString: () => value }) },
    typescript: {
      getTypeScriptWorker: mocks.getTypeScriptWorker,
      getJavaScriptWorker: mocks.getJavaScriptWorker
    }
  },
  setBuiltInRenameSuppressed: mocks.setBuiltInRenameSuppressed
}))

import { registerLspRenameProvider } from './lspRename'

/**
 * Rename provider の振る舞い（Session 5-9）。
 *
 * 確かめたいことは4つ。
 *
 *   1. 開いているファイルは Model へ、開いていないファイルは保存経路へ、と分かれること
 *   2. **1つでも当てられなければ、何も変えないこと**（部分適用を作らない）
 *   3. LSP が使えないときだけ内蔵へ落ち、断られたときは落ちないこと
 *   4. Monaco へ返す WorkspaceEdit が空であること（＝二重適用の余地が無い）
 */

const READY: readonly LanguageServerStatus[] = [{ serverId: 'typescript', status: 'ready' }]
const STOPPED: readonly LanguageServerStatus[] = [{ serverId: 'typescript', status: 'stopped' }]

function lspRange(line: number, start: number, end: number): Record<string, unknown> {
  return { start: { line, character: start }, end: { line, character: end } }
}

interface FakeModel {
  readonly uri: { toString: () => string }
  readonly pushed: { range: unknown; text: string }[][]
  version: number
  disposed: boolean
  getLanguageId: () => string
  getVersionId: () => number
  getLineCount: () => number
  getLineMaxColumn: (lineNumber: number) => number
  getWordAtPosition: () => { word: string; startColumn: number; endColumn: number } | null
  getValueInRange: () => string
  getOffsetAt: () => number
  getPositionAt: (offset: number) => { lineNumber: number; column: number }
  isDisposed: () => boolean
  pushStackElement: () => void
  pushEditOperations: (a: unknown, edits: { range: unknown; text: string }[]) => null
}

function createModel(languageId = 'typescript', path = 'file:///src/app.ts'): FakeModel {
  const model: FakeModel = {
    uri: { toString: () => path },
    pushed: [],
    version: 7,
    disposed: false,
    getLanguageId: () => languageId,
    getVersionId: () => model.version,
    getLineCount: () => 3,
    getLineMaxColumn: () => 40,
    getWordAtPosition: () => ({ word: 'old', startColumn: 7, endColumn: 10 }),
    getValueInRange: () => 'old',
    getOffsetAt: () => 6,
    getPositionAt: (offset) => ({ lineNumber: 1, column: offset + 1 }),
    isDisposed: () => model.disposed,
    pushStackElement: () => undefined,
    pushEditOperations: (_a, edits) => {
      model.pushed.push(edits)
      return null
    }
  }

  mocks.models.set(path, model)

  return model
}

const NO_CANCEL = { isCancellationRequested: false } as never
const POSITION = { lineNumber: 1, column: 7 } as never

function register(
  statuses: readonly LanguageServerStatus[],
  openModels: Readonly<Record<string, FakeModel>> = {}
): { readonly dispose: () => void } {
  let prepareSequence = 0
  let renameSequence = 0

  return registerLspRenameProvider({
    documents: {
      getPathForModel: () => 'src/app.ts',
      getModel: (relativePath: string) => openModels[relativePath] ?? null
    } as never,
    getStatuses: () => statuses,
    describeFailure: (failure, files) =>
      files === undefined || files.length === 0
        ? `reason:${failure}`
        : `reason:${failure}:${files.join(',')}`,
    nextPrepareSequence: () => ++prepareSequence,
    isLatestPrepareSequence: (target) => target === prepareSequence,
    nextRenameSequence: () => ++renameSequence,
    isLatestRenameSequence: (target) => target === renameSequence
  })
}

function renameProvider(languageId = 'typescript') {
  const provider = mocks.providers.get(languageId)

  if (provider === undefined) {
    throw new Error(`no ${languageId} rename provider registered`)
  }

  return provider
}

function okRename(documents: unknown): { ok: true; data: unknown } {
  return { ok: true, data: { status: 'ok', version: 7, documents } }
}

beforeEach(() => {
  mocks.providers.clear()
  mocks.models.clear()
  mocks.prepareRename.mockReset()
  mocks.rename.mockReset()
  mocks.readFile.mockReset()
  mocks.writeFile.mockReset()
  mocks.worker.getRenameInfo.mockReset()
  mocks.worker.findRenameLocations.mockReset()
  mocks.setBuiltInRenameSuppressed.mockClear()
  mocks.registerRenameProvider.mockClear()
  mocks.getTypeScriptWorker.mockClear()
  mocks.getJavaScriptWorker.mockClear()
  mocks.writeFile.mockResolvedValue({ ok: true, data: { status: 'written' } })
})

describe('registerLspRenameProvider', () => {
  /**
   * Monaco から見える Rename provider を1本に保つ。
   *
   * 2本並べると、本物のサーバが断ったものを内蔵が実行しうる
   * （Monaco は断られた provider の次を試す。monacoSetup.ts）。
   */
  it('TypeScript / JavaScript に1本ずつ登録し、内蔵を止める。dispose で戻す', () => {
    const registration = register(READY)

    expect(mocks.setBuiltInRenameSuppressed).toHaveBeenCalledWith(true)
    expect(mocks.registerRenameProvider).toHaveBeenCalledWith('typescript', expect.any(Object))
    expect(mocks.registerRenameProvider).toHaveBeenCalledWith('javascript', expect.any(Object))

    registration.dispose()

    expect(mocks.setBuiltInRenameSuppressed).toHaveBeenLastCalledWith(false)
    expect(mocks.providers.size).toBe(0)
  })
})

describe('provideRenameEdits（same-file）', () => {
  it('開いている文書へ直接当て、Monaco へは空の WorkspaceEdit を返す', async () => {
    const model = createModel()

    register(READY, { 'src/app.ts': model })
    mocks.rename.mockResolvedValue(
      okRename([
        { relativePath: 'src/app.ts', edits: [{ range: lspRange(0, 6, 9), text: 'next' }] }
      ])
    )

    const edit = await renameProvider().provideRenameEdits(model, POSITION, 'next', NO_CANCEL)

    expect(mocks.rename).toHaveBeenCalledWith({
      relativePath: 'src/app.ts',
      version: 7,
      position: { line: 0, character: 6 },
      newName: 'next'
    })
    expect(model.pushed).toEqual([
      [
        {
          range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 10 },
          text: 'next'
        }
      ]
    ])
    // 二重適用の余地が無い（Monaco は当てるものを受け取らない）。
    expect(edit).toEqual({ edits: [] })
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })
})

describe('provideRenameEdits（cross-file）', () => {
  it('開いていないファイルは、既存の保存経路で書く', async () => {
    const model = createModel()

    register(READY, { 'src/app.ts': model })
    mocks.rename.mockResolvedValue(
      okRename([
        { relativePath: 'src/app.ts', edits: [{ range: lspRange(0, 6, 9), text: 'next' }] },
        { relativePath: 'src/lib/util.ts', edits: [{ range: lspRange(0, 0, 3), text: 'next' }] }
      ])
    )
    mocks.readFile.mockResolvedValue({
      ok: true,
      data: {
        status: 'ok',
        content: 'old()\n',
        revision: { mtimeMs: 1, size: 6 },
        encoding: 'utf8'
      }
    })

    const edit = await renameProvider().provideRenameEdits(model, POSITION, 'next', NO_CANCEL)

    expect(mocks.readFile).toHaveBeenCalledWith({ relativePath: 'src/lib/util.ts' })
    expect(mocks.writeFile).toHaveBeenCalledWith({
      relativePath: 'src/lib/util.ts',
      content: 'next()\n',
      // 読んだときの版を添える（外での書き換えを Main に見張らせる）。
      baseRevision: { mtimeMs: 1, size: 6 },
      encoding: 'utf8'
    })
    expect(model.pushed).toHaveLength(1)
    expect(edit).toEqual({ edits: [] })
  })

  it('読めないファイルが1つでもあれば、開いている文書も変えない', async () => {
    const model = createModel()

    register(READY, { 'src/app.ts': model })
    mocks.rename.mockResolvedValue(
      okRename([
        { relativePath: 'src/app.ts', edits: [{ range: lspRange(0, 6, 9), text: 'next' }] },
        { relativePath: 'src/lib/util.ts', edits: [{ range: lspRange(0, 0, 3), text: 'next' }] }
      ])
    )
    mocks.readFile.mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND', message: 'gone' } })

    const edit = await renameProvider().provideRenameEdits(model, POSITION, 'next', NO_CANCEL)

    expect(model.pushed).toEqual([])
    expect(mocks.writeFile).not.toHaveBeenCalled()
    expect(edit).toEqual({ edits: [], rejectReason: 'reason:write-failed:src/lib/util.ts' })
  })

  it('範囲が当てられないファイルがあれば、何も変えない', async () => {
    const model = createModel()

    register(READY, { 'src/app.ts': model })
    mocks.rename.mockResolvedValue(
      okRename([
        { relativePath: 'src/app.ts', edits: [{ range: lspRange(0, 6, 9), text: 'next' }] },
        { relativePath: 'src/lib/util.ts', edits: [{ range: lspRange(9, 0, 3), text: 'next' }] }
      ])
    )
    mocks.readFile.mockResolvedValue({
      ok: true,
      data: { status: 'ok', content: 'old()\n', revision: null, encoding: 'utf8' }
    })

    const edit = await renameProvider().provideRenameEdits(model, POSITION, 'next', NO_CANCEL)

    expect(model.pushed).toEqual([])
    expect(mocks.writeFile).not.toHaveBeenCalled()
    expect(edit).toEqual({ edits: [], rejectReason: 'reason:malformed' })
  })

  it('書けなかったファイルは名前を挙げて知らせる', async () => {
    const model = createModel()

    register(READY, { 'src/app.ts': model })
    mocks.rename.mockResolvedValue(
      okRename([
        { relativePath: 'src/lib/util.ts', edits: [{ range: lspRange(0, 0, 3), text: 'next' }] }
      ])
    )
    mocks.readFile.mockResolvedValue({
      ok: true,
      data: { status: 'ok', content: 'old()\n', revision: null, encoding: 'utf8' }
    })
    // 保存しようとしたら、外で書き換えられていた。
    mocks.writeFile.mockResolvedValue({ ok: true, data: { status: 'stale' } })

    const edit = await renameProvider().provideRenameEdits(model, POSITION, 'next', NO_CANCEL)

    expect(edit).toEqual({ edits: [], rejectReason: 'reason:write-failed:src/lib/util.ts' })
  })
})

describe('provideRenameEdits（古い答え・断り）', () => {
  it('答えを待っている間に文書が変われば、何も当てない', async () => {
    const model = createModel()

    register(READY, { 'src/app.ts': model })
    mocks.rename.mockImplementation(async () => {
      model.version = 8

      return okRename([
        { relativePath: 'src/app.ts', edits: [{ range: lspRange(0, 6, 9), text: 'next' }] }
      ])
    })

    const edit = await renameProvider().provideRenameEdits(model, POSITION, 'next', NO_CANCEL)

    expect(model.pushed).toEqual([])
    expect(edit).toEqual({ edits: [], rejectReason: 'reason:stale' })
  })

  it('取り消されていれば何も当てない', async () => {
    const model = createModel()
    let canceled = false

    register(READY, { 'src/app.ts': model })
    mocks.rename.mockImplementation(async () => {
      canceled = true

      return okRename([
        { relativePath: 'src/app.ts', edits: [{ range: lspRange(0, 6, 9), text: 'next' }] }
      ])
    })

    const edit = await renameProvider().provideRenameEdits(model, POSITION, 'next', {
      get isCancellationRequested() {
        return canceled
      }
    } as never)

    expect(model.pushed).toEqual([])
    expect(edit).toEqual({ edits: [], rejectReason: 'reason:stale' })
  })

  it('Main が断ったときは内蔵へ落とさず、理由を返す', async () => {
    const model = createModel()

    register(READY, { 'src/app.ts': model })
    mocks.rename.mockResolvedValue({
      ok: true,
      data: { status: 'rejected', reason: 'unsupported-edit' }
    })

    const edit = await renameProvider().provideRenameEdits(model, POSITION, 'next', NO_CANCEL)

    expect(edit).toEqual({ edits: [], rejectReason: 'reason:unsupported-edit' })
    expect(mocks.worker.getRenameInfo).not.toHaveBeenCalled()
  })
})

describe('provideRenameEdits（内蔵への fallback）', () => {
  it.each([
    ['LSP OFF / 停止中', STOPPED, () => undefined],
    [
      'サーバが答えられない',
      READY,
      () => mocks.rename.mockResolvedValue({ ok: true, data: { status: 'unavailable' } })
    ],
    [
      'IPC が失敗した',
      READY,
      () => mocks.rename.mockResolvedValue({ ok: false, error: { code: 'INTERNAL', message: 'x' } })
    ]
  ])('%s のときは Monaco 内蔵の Rename を使う', async (_label, statuses, arrange) => {
    const model = createModel()

    register(statuses, { 'src/app.ts': model })
    arrange()
    mocks.worker.getRenameInfo.mockResolvedValue({ canRename: true })
    mocks.worker.findRenameLocations.mockResolvedValue([
      { fileName: 'file:///src/app.ts', textSpan: { start: 6, length: 3 } }
    ])

    const edit = await renameProvider().provideRenameEdits(model, POSITION, 'next', NO_CANCEL)

    expect(mocks.worker.findRenameLocations).toHaveBeenCalled()
    expect(edit).toEqual({
      edits: [
        {
          resource: model.uri,
          versionId: undefined,
          textEdit: {
            range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 10 },
            text: 'next'
          }
        }
      ]
    })
    // 内蔵へ落ちたので、Model へ自分では当てない（二重適用にしない）。
    expect(model.pushed).toEqual([])
  })

  it('内蔵が「変えられない」と言えば、その理由を返す', async () => {
    const model = createModel()

    register(STOPPED, { 'src/app.ts': model })
    mocks.worker.getRenameInfo.mockResolvedValue({
      canRename: false,
      localizedErrorMessage: 'You cannot rename this element.'
    })

    const edit = await renameProvider().provideRenameEdits(model, POSITION, 'next', NO_CANCEL)

    expect(edit).toEqual({ edits: [], rejectReason: 'You cannot rename this element.' })
    expect(mocks.worker.findRenameLocations).not.toHaveBeenCalled()
  })

  it('内蔵が Model の無いファイルを指したら、部分適用にせず諦める', async () => {
    const model = createModel()

    register(STOPPED, { 'src/app.ts': model })
    mocks.worker.getRenameInfo.mockResolvedValue({ canRename: true })
    mocks.worker.findRenameLocations.mockResolvedValue([
      { fileName: 'file:///src/app.ts', textSpan: { start: 6, length: 3 } },
      { fileName: 'file:///src/unknown.ts', textSpan: { start: 0, length: 3 } }
    ])

    expect(
      await renameProvider().provideRenameEdits(model, POSITION, 'next', NO_CANCEL)
    ).toBeUndefined()
  })

  it('JavaScript では JavaScript worker を使う', async () => {
    const model = createModel('javascript', 'file:///src/app.js')

    register(STOPPED, { 'src/app.ts': model })
    mocks.worker.getRenameInfo.mockResolvedValue({ canRename: true })
    mocks.worker.findRenameLocations.mockResolvedValue([])

    await renameProvider('javascript').provideRenameEdits(model, POSITION, 'next', NO_CANCEL)

    expect(mocks.getJavaScriptWorker).toHaveBeenCalled()
    expect(mocks.getTypeScriptWorker).not.toHaveBeenCalled()
  })
})

describe('resolveRenameLocation', () => {
  it('サーバが返した範囲と初期値を使う', async () => {
    const model = createModel()

    register(READY, { 'src/app.ts': model })
    mocks.prepareRename.mockResolvedValue({
      ok: true,
      data: { status: 'ok', version: 7, range: lspRange(0, 6, 9), placeholder: 'old' }
    })

    expect(await renameProvider().resolveRenameLocation(model, POSITION, NO_CANCEL)).toEqual({
      range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 10 },
      text: 'old'
    })
  })

  /**
   * `defaultBehavior` のときは、この場の単語を使う。
   *
   * Main は文書の本文を持たないため範囲を作れない（shared/lsp/rename.ts）。
   */
  it('範囲が無い答えなら、Monaco が見ている単語を使う', async () => {
    const model = createModel()

    register(READY, { 'src/app.ts': model })
    mocks.prepareRename.mockResolvedValue({
      ok: true,
      data: { status: 'ok', version: 7, range: null, placeholder: null }
    })

    expect(await renameProvider().resolveRenameLocation(model, POSITION, NO_CANCEL)).toEqual({
      range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 10 },
      text: 'old'
    })
  })

  it('変えられない位置は、理由を添えて断る', async () => {
    const model = createModel()

    register(READY, { 'src/app.ts': model })
    mocks.prepareRename.mockResolvedValue({
      ok: true,
      data: { status: 'rejected', reason: 'not-renameable' }
    })

    expect(await renameProvider().resolveRenameLocation(model, POSITION, NO_CANCEL)).toMatchObject({
      rejectReason: 'reason:not-renameable'
    })
    expect(mocks.worker.getRenameInfo).not.toHaveBeenCalled()
  })

  it('サーバが答えられないときは内蔵へ落とす', async () => {
    const model = createModel()

    register(READY, { 'src/app.ts': model })
    mocks.prepareRename.mockResolvedValue({ ok: true, data: { status: 'unavailable' } })
    mocks.worker.getRenameInfo.mockResolvedValue({
      canRename: true,
      displayName: 'old',
      triggerSpan: { start: 6, length: 3 }
    })

    expect(await renameProvider().resolveRenameLocation(model, POSITION, NO_CANCEL)).toEqual({
      range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 10 },
      text: 'old'
    })
  })
})
