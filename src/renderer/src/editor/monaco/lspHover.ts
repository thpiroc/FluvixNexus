import type { LanguageServerStatus } from '@shared/lsp'
import { fluvix } from '../../api/fluvix'
import { shouldUseLspHover } from '../lsp/hoverAvailability'
import { toEditorHover, type EditorHover } from '../lsp/hoverContent'
import { isTypeScriptWorkerLanguage } from '../lsp/serverAvailability'
import type { EditorDocumentStore } from './documentStore'
import { monaco, setBuiltInHoverSuppressed } from './monacoSetup'

interface TypeScriptDisplayPart {
  readonly text?: string
}

interface TypeScriptQuickInfo {
  readonly displayParts?: readonly TypeScriptDisplayPart[]
  readonly documentation?: readonly TypeScriptDisplayPart[]
  readonly textSpan?: { readonly start: number; readonly length: number }
}

interface RegisterLspHoverProviderOptions {
  readonly documents: EditorDocumentStore
  readonly getStatuses: () => readonly LanguageServerStatus[]
  readonly nextSequence: () => number
  readonly isLatestSequence: (sequence: number) => boolean
}

export function registerLspHoverProvider(
  options: RegisterLspHoverProviderOptions
): monaco.IDisposable {
  /*
    Monaco 0.56 の TypeScript mode は mode configuration の変更を初回登録後に
    購読していないため、内蔵 hover provider はこの provider から worker fallback
    として呼ぶ。画面上の振る舞いは LSP が使えないときだけ built-in 相当へ戻る。
  */
  setBuiltInHoverSuppressed(true)

  const provider: monaco.languages.HoverProvider = {
    provideHover: async (model, position, token) => {
      const relativePath = options.documents.getPathForModel(model)

      if (
        relativePath !== null &&
        shouldUseLspHover(model.getLanguageId(), options.getStatuses())
      ) {
        const hover = await provideLspHover(model, position, token, { ...options, relativePath })

        if (hover !== undefined) {
          return hover
        }
      }

      /*
        落とし先があるのは TypeScript / JavaScript だけ。Python には内蔵の
        Hover が無いので、**何も出さない**（Session 5-10。
        lsp/serverAvailability.ts）。TypeScript worker へ `.py` を渡さない。
      */
      if (!isTypeScriptWorkerLanguage(model.getLanguageId())) {
        return { contents: [] }
      }

      return provideTypeScriptWorkerHover(model, position, token)
    }
  }

  const registrations = [
    monaco.languages.registerHoverProvider('typescript', provider),
    monaco.languages.registerHoverProvider('javascript', provider),
    monaco.languages.registerHoverProvider('python', provider)
  ]

  return {
    dispose: () => {
      for (const registration of registrations) {
        registration.dispose()
      }

      setBuiltInHoverSuppressed(false)
    }
  }
}

async function provideLspHover(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  token: monaco.CancellationToken,
  options: RegisterLspHoverProviderOptions & { readonly relativePath: string }
): Promise<monaco.languages.Hover | null | undefined> {
  const version = model.getVersionId()
  const sequence = options.nextSequence()
  const result = await fluvix.lsp.hover({
    relativePath: options.relativePath,
    version,
    position: {
      line: Math.max(0, position.lineNumber - 1),
      character: Math.max(0, position.column - 1)
    }
  })

  if (
    token.isCancellationRequested ||
    !options.isLatestSequence(sequence) ||
    model.getVersionId() !== version
  ) {
    return { contents: [] }
  }

  if (!result.ok || result.data.status === 'unavailable') {
    return undefined
  }

  if (result.data.status === 'stale' || result.data.hover === null) {
    return { contents: [] }
  }

  const hover = toEditorHover(result.data.hover)

  return hover === null ? { contents: [] } : toMonacoHover(hover)
}

async function provideTypeScriptWorkerHover(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  token: monaco.CancellationToken
): Promise<monaco.languages.Hover | undefined> {
  const languageId = model.getLanguageId()
  const getWorker =
    languageId === 'javascript'
      ? monaco.typescript.getJavaScriptWorker
      : monaco.typescript.getTypeScriptWorker
  const uri = model.uri
  const offset = model.getOffsetAt(position)
  const workerAccessor = await getWorker()
  const worker = await workerAccessor(uri)

  if (token.isCancellationRequested || model.isDisposed()) {
    return { contents: [] }
  }

  const info = (await worker.getQuickInfoAtPosition(uri.toString(), offset)) as
    TypeScriptQuickInfo | undefined

  if (token.isCancellationRequested || model.isDisposed()) {
    return { contents: [] }
  }

  if (info === undefined) {
    return undefined
  }

  const code = displayPartsText(info.displayParts)
  const documentation = displayPartsText(info.documentation)
  const contents: monaco.IMarkdownString[] = []

  if (code !== '') {
    contents.push(markdown(`\`\`\`typescript\n${code}\n\`\`\``))
  }

  if (documentation !== '') {
    contents.push(markdown(documentation))
  }

  if (contents.length === 0) {
    return undefined
  }

  return {
    contents,
    ...(info.textSpan === undefined ? {} : { range: toTextSpanRange(model, info.textSpan) })
  }
}

function toMonacoHover(hover: EditorHover): monaco.languages.Hover {
  return {
    contents: hover.contents.map((content) => markdown(content.value)),
    ...(hover.range === null ? {} : { range: toMonacoRange(hover.range) })
  }
}

function toMonacoRange(range: NonNullable<EditorHover['range']>): monaco.IRange {
  return {
    startLineNumber: range.startLineNumber,
    startColumn: range.startColumn,
    endLineNumber:
      range.endLineNumber > range.startLineNumber ||
      (range.endLineNumber === range.startLineNumber && range.endColumn >= range.startColumn)
        ? range.endLineNumber
        : range.startLineNumber,
    endColumn:
      range.endLineNumber > range.startLineNumber ||
      (range.endLineNumber === range.startLineNumber && range.endColumn >= range.startColumn)
        ? range.endColumn
        : range.startColumn
  }
}

function toTextSpanRange(
  model: monaco.editor.ITextModel,
  span: { readonly start: number; readonly length: number }
): monaco.IRange {
  const start = model.getPositionAt(span.start)
  const end = model.getPositionAt(span.start + span.length)

  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column
  }
}

function displayPartsText(parts: readonly TypeScriptDisplayPart[] | undefined): string {
  return (
    parts
      ?.map((part) => part.text ?? '')
      .join('')
      ?.trim() ?? ''
  )
}

function markdown(value: string): monaco.IMarkdownString {
  return { value, isTrusted: false, supportHtml: false }
}
