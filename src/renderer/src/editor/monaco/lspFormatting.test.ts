import type { LanguageServerStatus } from '@shared/lsp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const providers = new Map<string, { provideDocumentFormattingEdits: Function }>()
  const worker = {
    getFormattingEditsForDocument: vi.fn()
  }

  return {
    providers,
    worker,
    formatting: vi.fn(),
    setBuiltInFormattingSuppressed: vi.fn(),
    registerDocumentFormattingEditProvider: vi.fn((languageId: string, provider: unknown) => {
      providers.set(languageId, provider as { provideDocumentFormattingEdits: Function })

      return {
        dispose: vi.fn(() => providers.delete(languageId))
      }
    }),
    getTypeScriptWorker: vi.fn(async () => async () => worker),
    getJavaScriptWorker: vi.fn(async () => async () => worker)
  }
})

vi.mock('../../api/fluvix', () => ({
  fluvix: {
    lsp: {
      formatting: mocks.formatting
    }
  }
}))

vi.mock('./monacoSetup', () => ({
  monaco: {
    languages: {
      registerDocumentFormattingEditProvider: mocks.registerDocumentFormattingEditProvider
    },
    typescript: {
      getTypeScriptWorker: mocks.getTypeScriptWorker,
      getJavaScriptWorker: mocks.getJavaScriptWorker
    }
  },
  setBuiltInFormattingSuppressed: mocks.setBuiltInFormattingSuppressed
}))

import { registerLspFormattingProvider } from './lspFormatting'

const READY_STATUS: readonly LanguageServerStatus[] = [{ serverId: 'typescript', status: 'ready' }]

const STOPPED_STATUS: readonly LanguageServerStatus[] = [
  { serverId: 'typescript', status: 'stopped' }
]

describe('registerLspFormattingProvider', () => {
  beforeEach(() => {
    mocks.providers.clear()
    mocks.formatting.mockReset()
    mocks.worker.getFormattingEditsForDocument.mockReset()
    mocks.setBuiltInFormattingSuppressed.mockClear()
    mocks.registerDocumentFormattingEditProvider.mockClear()
    mocks.getTypeScriptWorker.mockClear()
    mocks.getJavaScriptWorker.mockClear()
  })

  it('TypeScript / JavaScript に provider を1本だけ登録し、dispose で built-in を戻す', () => {
    const registration = registerProvider()

    expect(mocks.setBuiltInFormattingSuppressed).toHaveBeenCalledWith(true)
    expect(mocks.registerDocumentFormattingEditProvider).toHaveBeenCalledWith(
      'typescript',
      expect.any(Object)
    )
    expect(mocks.registerDocumentFormattingEditProvider).toHaveBeenCalledWith(
      'javascript',
      expect.any(Object)
    )

    registration.dispose()

    expect(mocks.setBuiltInFormattingSuppressed).toHaveBeenLastCalledWith(false)
    expect(mocks.providers.size).toBe(0)
  })

  it('LSP ready の TypeScript では LSP formatting だけを返す', async () => {
    registerProvider()
    mocks.formatting.mockResolvedValue({
      ok: true,
      data: {
        status: 'ok',
        version: 7,
        edits: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
            text: 'const x = 1'
          }
        ]
      }
    })

    const edits = await format('typescript', READY_STATUS, { tabSize: 2, insertSpaces: true })

    expect(mocks.formatting).toHaveBeenCalledWith({
      relativePath: 'src/app.ts',
      version: 7,
      options: { tabSize: 2, insertSpaces: true }
    })
    expect(mocks.worker.getFormattingEditsForDocument).not.toHaveBeenCalled()
    expect(edits).toEqual([
      {
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 11 },
        text: 'const x = 1'
      }
    ])
  })

  it('LSP が使えないときだけ Monaco worker formatting へ fallback する', async () => {
    registerProvider(STOPPED_STATUS)
    mocks.worker.getFormattingEditsForDocument.mockResolvedValue([
      { span: { start: 0, length: 10 }, newText: 'let y = 2' }
    ])

    const stopped = await format('javascript', STOPPED_STATUS, { tabSize: 8, insertSpaces: false })

    expect(mocks.formatting).not.toHaveBeenCalled()
    expect(mocks.getJavaScriptWorker).toHaveBeenCalled()
    expect(mocks.worker.getFormattingEditsForDocument).toHaveBeenCalledWith('file:///src/app.js', {
      tabSize: 8,
      indentSize: 8,
      convertTabsToSpaces: false
    })
    expect(stopped).toEqual([
      {
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 11 },
        text: 'let y = 2'
      }
    ])

    mocks.providers.clear()
    registerProvider()
    mocks.formatting.mockResolvedValue({ ok: true, data: { status: 'unavailable' } })
    mocks.worker.getFormattingEditsForDocument.mockResolvedValue([
      { span: { start: 0, length: 10 }, newText: 'const y = 2' }
    ])

    const unavailable = await format('typescript', READY_STATUS, { tabSize: 4, insertSpaces: true })

    expect(unavailable?.[0]?.text).toBe('const y = 2')
  })

  it('stale / cancel / version mismatch は現在の文書へ適用しない', async () => {
    registerProvider()
    mocks.formatting.mockResolvedValue({ ok: true, data: { status: 'stale' } })

    await expect(
      format('typescript', READY_STATUS, { tabSize: 2, insertSpaces: true })
    ).resolves.toEqual([])
    expect(mocks.worker.getFormattingEditsForDocument).not.toHaveBeenCalled()

    mocks.formatting.mockResolvedValue({
      ok: true,
      data: {
        status: 'ok',
        version: 7,
        edits: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
            text: 'const x = 1'
          }
        ]
      }
    })

    await expect(
      format('typescript', READY_STATUS, { tabSize: 2, insertSpaces: true }, { cancel: true })
    ).resolves.toEqual([])

    await expect(
      format(
        'typescript',
        READY_STATUS,
        { tabSize: 2, insertSpaces: true },
        { changeVersion: true }
      )
    ).resolves.toEqual([])
  })
})

function registerProvider(statuses: readonly LanguageServerStatus[] = READY_STATUS): {
  readonly dispose: () => void
} {
  let sequence = 0

  return registerLspFormattingProvider({
    documents: {
      getPathForModel: () => 'src/app.ts'
    } as never,
    getStatuses: () => statuses,
    nextSequence: () => ++sequence,
    isLatestSequence: (target) => target === sequence
  })
}

async function format(
  languageId: string,
  statuses: readonly LanguageServerStatus[],
  options: { readonly tabSize: number; readonly insertSpaces: boolean },
  behavior: { readonly cancel?: boolean; readonly changeVersion?: boolean } = {}
): Promise<readonly { readonly text: string }[] | undefined> {
  let version = 7
  let canceled = false

  if (behavior.cancel) {
    mocks.formatting.mockImplementationOnce(async () => {
      canceled = true
      return {
        ok: true,
        data: { status: 'ok', version, edits: [] }
      }
    })
  }

  if (behavior.changeVersion) {
    mocks.formatting.mockImplementationOnce(async () => {
      version = 8
      return {
        ok: true,
        data: { status: 'ok', version: 7, edits: [] }
      }
    })
  }

  const provider = mocks.providers.get(languageId)

  if (provider === undefined) {
    throw new Error(`no ${languageId} formatting provider registered`)
  }

  return provider.provideDocumentFormattingEdits(createModel(languageId, version), options, {
    get isCancellationRequested() {
      return canceled
    }
  })
}

function createModel(languageId: string, initialVersion: number) {
  return {
    uri: {
      toString: () => (languageId === 'javascript' ? 'file:///src/app.js' : 'file:///src/app.ts')
    },
    getLanguageId: () => languageId,
    getVersionId: () => initialVersion,
    getLineCount: () => 1,
    getLineMaxColumn: () => 21,
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
    isDisposed: () => false
  }
}
