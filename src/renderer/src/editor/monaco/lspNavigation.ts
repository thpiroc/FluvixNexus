import type { LanguageServerStatus } from '@shared/lsp'
import { fluvix } from '../../api/fluvix'
import { shouldUseLspNavigation } from '../lsp/navigationAvailability'
import {
  toEditorWorkspaceLocations,
  type EditorWorkspaceLocation
} from '../lsp/navigationLocations'
import { isTypeScriptWorkerLanguage } from '../lsp/serverAvailability'
import type { EditorDocumentStore } from './documentStore'
import { monaco } from './monacoSetup'

interface TypeScriptNavigationEntry {
  readonly fileName?: string
  readonly textSpan?: { readonly start: number; readonly length: number }
  readonly isDefinition?: boolean
}

interface RegisterLspNavigationProviderOptions {
  readonly documents: EditorDocumentStore
  readonly getStatuses: () => readonly LanguageServerStatus[]
  readonly openFileAt: (input: {
    readonly relativePath: string
    readonly name: string
    readonly line: number
    readonly column: number
    readonly length?: number
  }) => void
  readonly nextDefinitionSequence: () => number
  readonly isLatestDefinitionSequence: (sequence: number) => boolean
  readonly nextReferencesSequence: () => number
  readonly isLatestReferencesSequence: (sequence: number) => boolean
}

export function registerLspNavigationProvider(
  options: RegisterLspNavigationProviderOptions
): monaco.IDisposable {
  /*
    LSP が答えられなかったときの落とし先があるのは TypeScript / JavaScript だけで、
    Python には内蔵の定義 / 参照が無い（Session 5-10。lsp/serverAvailability.ts）。
    `.py` を TypeScript worker へ渡すと、TypeScript として解析した位置が返る。
  */
  const definitionProvider: monaco.languages.DefinitionProvider = {
    provideDefinition: async (model, position, token) => {
      const relativePath = options.documents.getPathForModel(model)

      if (
        relativePath !== null &&
        shouldUseLspNavigation(model.getLanguageId(), options.getStatuses())
      ) {
        const definition = await provideLspDefinition(model, position, token, {
          ...options,
          relativePath
        })

        if (definition !== undefined) {
          return definition
        }
      }

      if (!isTypeScriptWorkerLanguage(model.getLanguageId())) {
        return []
      }

      return provideTypeScriptWorkerDefinition(model, position, token)
    }
  }

  const referencesProvider: monaco.languages.ReferenceProvider = {
    provideReferences: async (model, position, context, token) => {
      const relativePath = options.documents.getPathForModel(model)

      if (
        relativePath !== null &&
        shouldUseLspNavigation(model.getLanguageId(), options.getStatuses())
      ) {
        const references = await provideLspReferences(model, position, context, token, {
          ...options,
          relativePath
        })

        if (references !== undefined) {
          return references
        }
      }

      if (!isTypeScriptWorkerLanguage(model.getLanguageId())) {
        return []
      }

      return provideTypeScriptWorkerReferences(model, position, context, token)
    }
  }

  const opener = monaco.editor.registerEditorOpener({
    openCodeEditor: (_source, resource, selectionOrPosition) => {
      const target = toNavigationTarget(resource, selectionOrPosition)

      if (target === null) {
        return false
      }

      options.openFileAt({
        relativePath: target.relativePath,
        name: fileNameOf(target.relativePath),
        line: target.line,
        column: target.column,
        length: target.length
      })

      return true
    }
  })

  const registrations = [
    opener,
    monaco.languages.registerDefinitionProvider('typescript', definitionProvider),
    monaco.languages.registerDefinitionProvider('javascript', definitionProvider),
    monaco.languages.registerDefinitionProvider('python', definitionProvider),
    monaco.languages.registerReferenceProvider('typescript', referencesProvider),
    monaco.languages.registerReferenceProvider('javascript', referencesProvider),
    monaco.languages.registerReferenceProvider('python', referencesProvider)
  ]

  return {
    dispose: () => {
      for (const registration of registrations) {
        registration.dispose()
      }
    }
  }
}

async function provideLspDefinition(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  token: monaco.CancellationToken,
  options: RegisterLspNavigationProviderOptions & { readonly relativePath: string }
): Promise<monaco.languages.Definition | undefined> {
  const version = model.getVersionId()
  const sequence = options.nextDefinitionSequence()
  const result = await fluvix.lsp.definition({
    relativePath: options.relativePath,
    version,
    position: toLspPosition(position)
  })

  if (
    token.isCancellationRequested ||
    !options.isLatestDefinitionSequence(sequence) ||
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

  return toEditorWorkspaceLocations(result.data.definitions).map((location) =>
    toMonacoLocation(model, options.relativePath, location)
  )
}

async function provideLspReferences(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  context: monaco.languages.ReferenceContext,
  token: monaco.CancellationToken,
  options: RegisterLspNavigationProviderOptions & { readonly relativePath: string }
): Promise<monaco.languages.Location[] | undefined> {
  const version = model.getVersionId()
  const sequence = options.nextReferencesSequence()
  const result = await fluvix.lsp.references({
    relativePath: options.relativePath,
    version,
    position: toLspPosition(position),
    includeDeclaration: context.includeDeclaration
  })

  if (
    token.isCancellationRequested ||
    !options.isLatestReferencesSequence(sequence) ||
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

  return toEditorWorkspaceLocations(result.data.references).map((location) =>
    toMonacoLocation(model, options.relativePath, location)
  )
}

async function provideTypeScriptWorkerDefinition(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  token: monaco.CancellationToken
): Promise<monaco.languages.Location[] | undefined> {
  const entries = await requestTypeScriptWorkerEntries(model, position, token, 'definition')

  return entries === undefined ? undefined : entries.map(toWorkerLocation).filter(isLocation)
}

async function provideTypeScriptWorkerReferences(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  context: monaco.languages.ReferenceContext,
  token: monaco.CancellationToken
): Promise<monaco.languages.Location[] | undefined> {
  const entries = await requestTypeScriptWorkerEntries(model, position, token, 'references')

  if (entries === undefined) {
    return undefined
  }

  return entries
    .filter((entry) => context.includeDeclaration || entry.isDefinition !== true)
    .map(toWorkerLocation)
    .filter(isLocation)
}

async function requestTypeScriptWorkerEntries(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  token: monaco.CancellationToken,
  kind: 'definition' | 'references'
): Promise<readonly TypeScriptNavigationEntry[] | undefined> {
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
    return []
  }

  const entries =
    kind === 'definition'
      ? await worker.getDefinitionAtPosition(uri.toString(), offset)
      : await worker.getReferencesAtPosition(uri.toString(), offset)

  if (token.isCancellationRequested || model.isDisposed()) {
    return []
  }

  return Array.isArray(entries) ? (entries as readonly TypeScriptNavigationEntry[]) : undefined
}

function toMonacoLocation(
  sourceModel: monaco.editor.ITextModel,
  sourceRelativePath: string,
  location: EditorWorkspaceLocation
): monaco.languages.Location {
  return {
    uri:
      location.relativePath === sourceRelativePath
        ? sourceModel.uri
        : toNavigationUri(location.relativePath),
    range: toMonacoRange(location.range)
  }
}

function toWorkerLocation(entry: TypeScriptNavigationEntry): monaco.languages.Location | null {
  if (typeof entry.fileName !== 'string' || entry.textSpan === undefined) {
    return null
  }

  const uri = monaco.Uri.parse(entry.fileName)
  const model = monaco.editor.getModel(uri)

  if (model === null) {
    return null
  }

  return {
    uri,
    range: toTextSpanRange(model, entry.textSpan)
  }
}

function toNavigationUri(relativePath: string): monaco.Uri {
  return monaco.Uri.from({
    scheme: 'fluvix',
    authority: 'workspace-navigation',
    path: `/${relativePath}`
  })
}

function toNavigationTarget(
  resource: monaco.Uri,
  selectionOrPosition: monaco.IRange | monaco.IPosition | undefined
): {
  readonly relativePath: string
  readonly line: number
  readonly column: number
  readonly length: number
} | null {
  if (resource.scheme !== 'fluvix' || resource.authority !== 'workspace-navigation') {
    return null
  }

  const relativePath = resource.path.replace(/^\/+/, '')

  if (relativePath === '') {
    return null
  }

  const range = selectionOrPosition

  if (range === undefined) {
    return { relativePath, line: 1, column: 1, length: 0 }
  }

  if ('startLineNumber' in range) {
    return {
      relativePath,
      line: range.startLineNumber,
      column: range.startColumn,
      length: Math.max(0, range.endColumn - range.startColumn)
    }
  }

  return { relativePath, line: range.lineNumber, column: range.column, length: 0 }
}

function toLspPosition(position: monaco.Position): {
  readonly line: number
  readonly character: number
} {
  return {
    line: Math.max(0, position.lineNumber - 1),
    character: Math.max(0, position.column - 1)
  }
}

function toMonacoRange(range: EditorWorkspaceLocation['range']): monaco.IRange {
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

function isLocation(value: monaco.languages.Location | null): value is monaco.languages.Location {
  return value !== null
}

function fileNameOf(relativePath: string): string {
  return relativePath.split('/').pop() ?? relativePath
}
