import type { LanguageServerStatus } from '@shared/lsp'
import { fluvix } from '../../api/fluvix'
import { LSP_FORMATTING_LANGUAGE_IDS, shouldUseLspFormatting } from '../lsp/formattingAvailability'
import { toEditorFormattingEdits, type EditorFormattingEdit } from '../lsp/formattingEdits'
import { isTypeScriptWorkerLanguage } from '../lsp/serverAvailability'
import type { EditorDocumentStore } from './documentStore'
import { monaco, setBuiltInFormattingSuppressed } from './monacoSetup'

interface TypeScriptTextChange {
  readonly newText?: string
  readonly span?: { readonly start: number; readonly length: number }
}

interface RegisterLspFormattingProviderOptions {
  readonly documents: EditorDocumentStore
  readonly getStatuses: () => readonly LanguageServerStatus[]
  readonly nextSequence: () => number
  readonly isLatestSequence: (sequence: number) => boolean
}

export function registerLspFormattingProvider(
  options: RegisterLspFormattingProviderOptions
): monaco.IDisposable {
  /*
    TypeScript mode の内蔵 formatter は、LSP が ready かどうかで直接出し入れせず、
    この provider から worker fallback として呼ぶ。Monaco から見える provider を
    1本に保つことで、Format Document で LSP と built-in が二重に並ばない。
  */
  setBuiltInFormattingSuppressed(true)

  const provider: monaco.languages.DocumentFormattingEditProvider = {
    displayName: 'Fluvix LSP',
    provideDocumentFormattingEdits: async (model, formattingOptions, token) => {
      const relativePath = options.documents.getPathForModel(model)

      if (
        relativePath !== null &&
        shouldUseLspFormatting(model.getLanguageId(), options.getStatuses())
      ) {
        const edits = await provideLspFormatting(model, formattingOptions, token, {
          ...options,
          relativePath
        })

        if (edits !== undefined) {
          return edits
        }
      }

      /*
        LSP が答えられなかった。落とし先があるのは TypeScript / JavaScript だけで、
        C# に内蔵の整形器は無い（Session 5-11。lsp/serverAvailability.ts）。
        **`.cs` を TypeScript worker へ渡さない** ── 渡せば C# の綴りを
        TypeScript として整形した編集が返り、コードが壊れる。

        ここで何も返さないと Format Document は黙って何もしないが、
        壊れた整形を当てるよりは何もしないほうが安全にほかならない
        ── サーバが OFF / 未インストール / 起動中のときの C# は
        「整形されない」に留まる。
      */
      if (!isTypeScriptWorkerLanguage(model.getLanguageId())) {
        return []
      }

      return provideTypeScriptWorkerFormatting(model, formattingOptions, token)
    }
  }

  const registrations = LSP_FORMATTING_LANGUAGE_IDS.map((languageId) =>
    monaco.languages.registerDocumentFormattingEditProvider(languageId, provider)
  )

  return {
    dispose: () => {
      for (const registration of registrations) {
        registration.dispose()
      }

      setBuiltInFormattingSuppressed(false)
    }
  }
}

async function provideLspFormatting(
  model: monaco.editor.ITextModel,
  formattingOptions: monaco.languages.FormattingOptions,
  token: monaco.CancellationToken,
  options: RegisterLspFormattingProviderOptions & { readonly relativePath: string }
): Promise<monaco.languages.TextEdit[] | undefined> {
  const version = model.getVersionId()
  const sequence = options.nextSequence()
  const result = await fluvix.lsp.formatting({
    relativePath: options.relativePath,
    version,
    options: {
      tabSize: normalizeTabSize(formattingOptions.tabSize),
      insertSpaces: formattingOptions.insertSpaces
    }
  })

  if (
    token.isCancellationRequested ||
    !options.isLatestSequence(sequence) ||
    model.getVersionId() !== version
  ) {
    return []
  }

  if (!result.ok || result.data.status === 'unavailable') {
    return undefined
  }

  if (result.data.status === 'stale') {
    return []
  }

  const edits = toEditorFormattingEdits(result.data.edits, {
    lineCount: model.getLineCount(),
    getLineMaxColumn: (lineNumber) => model.getLineMaxColumn(lineNumber)
  })

  return edits === null ? [] : edits.map(toMonacoTextEdit)
}

async function provideTypeScriptWorkerFormatting(
  model: monaco.editor.ITextModel,
  formattingOptions: monaco.languages.FormattingOptions,
  token: monaco.CancellationToken
): Promise<monaco.languages.TextEdit[] | undefined> {
  const languageId = model.getLanguageId()
  const getWorker =
    languageId === 'javascript'
      ? monaco.typescript.getJavaScriptWorker
      : monaco.typescript.getTypeScriptWorker
  const uri = model.uri
  const workerAccessor = await getWorker()
  const worker = await workerAccessor(uri)

  if (token.isCancellationRequested || model.isDisposed()) {
    return []
  }

  const changes = (await worker.getFormattingEditsForDocument(uri.toString(), {
    tabSize: normalizeTabSize(formattingOptions.tabSize),
    indentSize: normalizeTabSize(formattingOptions.tabSize),
    convertTabsToSpaces: formattingOptions.insertSpaces
  })) as readonly TypeScriptTextChange[] | undefined

  if (token.isCancellationRequested || model.isDisposed()) {
    return []
  }

  if (!Array.isArray(changes)) {
    return undefined
  }

  return changes.map((change) => toTypeScriptWorkerTextEdit(model, change)).filter(isTextEdit)
}

function toTypeScriptWorkerTextEdit(
  model: monaco.editor.ITextModel,
  change: TypeScriptTextChange
): monaco.languages.TextEdit | null {
  if (typeof change.newText !== 'string' || change.span === undefined) {
    return null
  }

  const start = model.getPositionAt(change.span.start)
  const end = model.getPositionAt(change.span.start + Math.max(0, change.span.length))

  return {
    range: {
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column
    },
    text: change.newText
  }
}

function toMonacoTextEdit(edit: EditorFormattingEdit): monaco.languages.TextEdit {
  return {
    range: edit.range,
    text: edit.text
  }
}

function normalizeTabSize(tabSize: number): number {
  return Number.isSafeInteger(tabSize) && tabSize > 0 ? Math.min(tabSize, 16) : 4
}

function isTextEdit(value: monaco.languages.TextEdit | null): value is monaco.languages.TextEdit {
  return value !== null
}
