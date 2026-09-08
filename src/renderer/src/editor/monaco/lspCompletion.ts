import type { LanguageServerStatus, LspCompletionTriggerKind } from '@shared/lsp'
import { fluvix } from '../../api/fluvix'
import { shouldUseLspCompletion } from '../lsp/completionAvailability'
import { toEditorCompletionList, type EditorCompletionItem } from '../lsp/completionItems'
import { isTypeScriptWorkerLanguage } from '../lsp/serverAvailability'
import type { EditorDocumentStore } from './documentStore'
import { monaco, setBuiltInCompletionSuppressed } from './monacoSetup'

type EditorCompletionTextEditRange = NonNullable<EditorCompletionItem['textEditRange']>

interface TypeScriptCompletionEntry {
  readonly name: string
  readonly kind?: string
  readonly sortText?: string
  readonly kindModifiers?: string
  readonly replacementSpan?: { readonly start: number; readonly length: number }
}

interface TypeScriptCompletionInfo {
  readonly entries?: readonly TypeScriptCompletionEntry[]
}

interface RegisterLspCompletionProviderOptions {
  readonly documents: EditorDocumentStore
  readonly getStatuses: () => readonly LanguageServerStatus[]
  readonly nextSequence: () => number
  readonly isLatestSequence: (sequence: number) => boolean
}

/**
 * 打っただけで補完が開く文字。**言語ごとに分けてある**（Session 5-10 / 5-11）。
 *
 * Monaco の trigger character は provider の登録単位で決まるので、
 * 1つにまとめると片方の言語に要らない文字が混ざる。
 *
 * ```
 * TypeScript / JavaScript … `.` `"` `'` `` ` `` `/` `@` `<` `#`
 *                           （import のパス・JSX・private field が要る）
 * Python                  … `.` `[` `"` `'`
 *                           （Pyright が名乗った4つ。辞書の key に `[` が要る）
 * C#                      … `.` `'`
 *                           （csharp-ls が名乗った2つ）
 * ```
 *
 * Python 側を TypeScript と同じにしないのは、`<` や `/` が Python では
 * ただの演算子で、打つたびに候補が開くと**入力の邪魔にしかならない**ため。
 * 逆に `[` を TypeScript へ足さないのは、Session 5-9 までの挙動を変えないため
 * になる。
 *
 * C# の `<` も同じ扱いにしてある。ジェネリクスがあるので候補を出したくなるが、
 * **csharp-ls はそれを名乗っていない** ── 名乗っていない文字で要求を出しても、
 * サーバはその位置を trigger として扱わない（`triggerKind: 2` に添えた文字を
 * 見て候補を絞るのはサーバの側）。ここに書いてよいのは
 * 名乗りに載っていた文字だけで、こちらの期待で足す欄ではない。
 */
const TYPESCRIPT_TRIGGER_CHARACTERS = ['.', '"', "'", '`', '/', '@', '<', '#'] as const

/** Pyright が `completionProvider.triggerCharacters` として名乗る4つ。 */
const PYTHON_TRIGGER_CHARACTERS = ['.', '[', '"', "'"] as const

/** csharp-ls が `completionProvider.triggerCharacters` として名乗る2つ。 */
const CSHARP_TRIGGER_CHARACTERS = ['.', "'"] as const

export function setTypeScriptBuiltInCompletionSuppressed(suppressed: boolean): void {
  /*
    Monaco 0.56 の TypeScript mode は `setModeConfiguration()` の変更を
    初回登録後に購読していない。そこで native provider は常に抑止し、
    fallback は下の provider から TypeScript worker を直接呼ぶ。
  */
  void suppressed
  setBuiltInCompletionSuppressed(true)
}

export function registerLspCompletionProvider(
  options: RegisterLspCompletionProviderOptions
): monaco.IDisposable {
  const createProvider = (
    triggerCharacters: readonly string[]
  ): monaco.languages.CompletionItemProvider => ({
    triggerCharacters: [...triggerCharacters],

    provideCompletionItems: async (model, position, context, token) => {
      const relativePath = options.documents.getPathForModel(model)

      /*
        内蔵の TypeScript 補完を抑えるのは、TypeScript / JavaScript の文書の
        ときだけにする。Python の文書を開いただけで TypeScript mode の設定を
        触る理由が無い（触っても壊れはしないが、**関係の無い言語の都合で
        別の言語の設定が動く**形にしない）。
      */
      if (isTypeScriptWorkerLanguage(model.getLanguageId())) {
        setBuiltInCompletionSuppressed(true)
      }

      if (
        relativePath !== null &&
        shouldUseLspCompletion(model.getLanguageId(), options.getStatuses())
      ) {
        const completion = await provideLspCompletion(model, position, context, token, {
          ...options,
          relativePath
        })

        if (completion !== undefined) {
          return completion
        }
      }

      /*
        LSP が答えられなかった。落とし先があるのは TypeScript / JavaScript だけで、
        Python にも C# にも内蔵の補完が無い（Session 5-10 / 5-11。
        lsp/serverAvailability.ts）。**その文書を TypeScript worker へ渡さない**
        ── 渡せば `.py` / `.cs` を TypeScript として解析した候補が並ぶ。
      */
      if (!isTypeScriptWorkerLanguage(model.getLanguageId())) {
        return { suggestions: [] }
      }

      return provideTypeScriptWorkerCompletion(model, position, token)
    }
  })

  const typeScriptProvider = createProvider(TYPESCRIPT_TRIGGER_CHARACTERS)
  const pythonProvider = createProvider(PYTHON_TRIGGER_CHARACTERS)
  const csharpProvider = createProvider(CSHARP_TRIGGER_CHARACTERS)

  const registrations = [
    monaco.languages.registerCompletionItemProvider('typescript', typeScriptProvider),
    monaco.languages.registerCompletionItemProvider('javascript', typeScriptProvider),
    monaco.languages.registerCompletionItemProvider('python', pythonProvider),
    monaco.languages.registerCompletionItemProvider('csharp', csharpProvider)
  ]

  return {
    dispose: () => {
      for (const registration of registrations) {
        registration.dispose()
      }
    }
  }
}

async function provideLspCompletion(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  context: monaco.languages.CompletionContext,
  token: monaco.CancellationToken,
  options: RegisterLspCompletionProviderOptions & { readonly relativePath: string }
): Promise<monaco.languages.CompletionList | undefined> {
  const version = model.getVersionId()
  const sequence = options.nextSequence()
  const result = await fluvix.lsp.completion({
    relativePath: options.relativePath,
    version,
    position: {
      line: Math.max(0, position.lineNumber - 1),
      character: Math.max(0, position.column - 1)
    },
    ...toLspCompletionContext(context)
  })

  if (
    token.isCancellationRequested ||
    !options.isLatestSequence(sequence) ||
    model.getVersionId() !== version
  ) {
    return { suggestions: [] }
  }

  if (!result.ok || result.data.status === 'unavailable') {
    return undefined
  }

  if (result.data.status === 'stale') {
    return { suggestions: [] }
  }

  const completion = toEditorCompletionList(result.data.completion)

  return {
    incomplete: completion.incomplete,
    suggestions: completion.items.map((item) => toMonacoCompletionItem(model, position, item))
  }
}

async function provideTypeScriptWorkerCompletion(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  token: monaco.CancellationToken
): Promise<monaco.languages.CompletionList | undefined> {
  const languageId = model.getLanguageId()
  const getWorker =
    languageId === 'javascript'
      ? monaco.typescript.getJavaScriptWorker
      : monaco.typescript.getTypeScriptWorker
  const word = model.getWordUntilPosition(position)
  const defaultRange: monaco.IRange = {
    startLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endLineNumber: position.lineNumber,
    endColumn: word.endColumn
  }
  const uri = model.uri
  const offset = model.getOffsetAt(position)
  const workerAccessor = await getWorker()
  const worker = await workerAccessor(uri)

  if (token.isCancellationRequested || model.isDisposed()) {
    return { suggestions: [] }
  }

  const info = (await worker.getCompletionsAtPosition(uri.toString(), offset)) as
    TypeScriptCompletionInfo | undefined

  if (token.isCancellationRequested || model.isDisposed()) {
    return { suggestions: [] }
  }

  if (!Array.isArray(info?.entries)) {
    return undefined
  }

  return {
    suggestions: info.entries.map((entry) =>
      toTypeScriptWorkerCompletionItem(model, position, entry, defaultRange)
    )
  }
}

function toTypeScriptWorkerCompletionItem(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  entry: TypeScriptCompletionEntry,
  defaultRange: monaco.IRange
): monaco.languages.CompletionItem {
  return {
    label: entry.name,
    kind: toTypeScriptWorkerCompletionItemKind(entry.kind),
    insertText: entry.name,
    range:
      entry.replacementSpan === undefined
        ? defaultRange
        : toReplacementSpanRange(model, entry.replacementSpan),
    ...(entry.sortText === undefined ? {} : { sortText: entry.sortText }),
    ...(typeof entry.kindModifiers === 'string' && entry.kindModifiers.includes('deprecated')
      ? { tags: [monaco.languages.CompletionItemTag.Deprecated] }
      : {})
  }
}

function toReplacementSpanRange(
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

function toLspCompletionContext(context: monaco.languages.CompletionContext): {
  readonly triggerKind?: LspCompletionTriggerKind
  readonly triggerCharacter?: string
} {
  switch (context.triggerKind) {
    case monaco.languages.CompletionTriggerKind.TriggerCharacter:
      return typeof context.triggerCharacter === 'string' && context.triggerCharacter.length === 1
        ? { triggerKind: 'trigger-character', triggerCharacter: context.triggerCharacter }
        : { triggerKind: 'trigger-character' }

    case monaco.languages.CompletionTriggerKind.TriggerForIncompleteCompletions:
      return { triggerKind: 'trigger-for-incomplete-completions' }

    default:
      return { triggerKind: 'invoked' }
  }
}

function toMonacoCompletionItem(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  item: EditorCompletionItem
): monaco.languages.CompletionItem {
  return {
    label: item.label,
    kind: toMonacoCompletionItemKind(item.kind),
    insertText: item.insertText,
    range:
      item.textEditRange === null
        ? defaultRange(model, position)
        : toMonacoRange(item.textEditRange),
    ...(item.detail === null ? {} : { detail: item.detail }),
    ...(item.documentation === null ? {} : { documentation: item.documentation }),
    ...(item.sortText === null ? {} : { sortText: item.sortText }),
    ...(item.filterText === null ? {} : { filterText: item.filterText }),
    ...(item.insertTextFormat === 'snippet'
      ? { insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet }
      : {}),
    ...(item.commitCharacters.length === 0 ? {} : { commitCharacters: [...item.commitCharacters] }),
    ...(item.preselect ? { preselect: true } : {})
  }
}

function defaultRange(model: monaco.editor.ITextModel, position: monaco.Position): monaco.IRange {
  const word = model.getWordUntilPosition(position)

  return {
    startLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endLineNumber: position.lineNumber,
    endColumn: position.column
  }
}

function toMonacoRange(
  range: EditorCompletionTextEditRange
): monaco.IRange | monaco.languages.CompletionItemRanges {
  if ('insert' in range) {
    return {
      insert: toMonacoSingleRange(range.insert),
      replace: toMonacoSingleRange(range.replace)
    }
  }

  return toMonacoSingleRange(range)
}

function toMonacoSingleRange(
  range: Exclude<EditorCompletionTextEditRange, { readonly insert: unknown }>
): monaco.IRange {
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

function toTypeScriptWorkerCompletionItemKind(
  kind: string | undefined
): monaco.languages.CompletionItemKind {
  switch (kind) {
    case 'primitive type':
    case 'keyword':
      return monaco.languages.CompletionItemKind.Keyword

    case 'var':
    case 'local var':
      return monaco.languages.CompletionItemKind.Variable

    case 'property':
    case 'getter':
    case 'setter':
      return monaco.languages.CompletionItemKind.Field

    case 'function':
    case 'method':
    case 'construct':
    case 'call':
    case 'index':
      return monaco.languages.CompletionItemKind.Function

    case 'enum':
      return monaco.languages.CompletionItemKind.Enum

    case 'module':
      return monaco.languages.CompletionItemKind.Module

    case 'class':
      return monaco.languages.CompletionItemKind.Class

    case 'interface':
      return monaco.languages.CompletionItemKind.Interface

    case 'warning':
      return monaco.languages.CompletionItemKind.File

    default:
      return monaco.languages.CompletionItemKind.Property
  }
}

function toMonacoCompletionItemKind(
  kind: EditorCompletionItem['kind']
): monaco.languages.CompletionItemKind {
  switch (kind) {
    case 'method':
      return monaco.languages.CompletionItemKind.Method
    case 'function':
      return monaco.languages.CompletionItemKind.Function
    case 'constructor':
      return monaco.languages.CompletionItemKind.Constructor
    case 'field':
      return monaco.languages.CompletionItemKind.Field
    case 'variable':
      return monaco.languages.CompletionItemKind.Variable
    case 'class':
      return monaco.languages.CompletionItemKind.Class
    case 'struct':
      return monaco.languages.CompletionItemKind.Struct
    case 'interface':
      return monaco.languages.CompletionItemKind.Interface
    case 'module':
      return monaco.languages.CompletionItemKind.Module
    case 'property':
      return monaco.languages.CompletionItemKind.Property
    case 'event':
      return monaco.languages.CompletionItemKind.Event
    case 'operator':
      return monaco.languages.CompletionItemKind.Operator
    case 'unit':
      return monaco.languages.CompletionItemKind.Unit
    case 'value':
      return monaco.languages.CompletionItemKind.Value
    case 'constant':
      return monaco.languages.CompletionItemKind.Constant
    case 'enum':
      return monaco.languages.CompletionItemKind.Enum
    case 'enum-member':
      return monaco.languages.CompletionItemKind.EnumMember
    case 'keyword':
      return monaco.languages.CompletionItemKind.Keyword
    case 'snippet':
      return monaco.languages.CompletionItemKind.Snippet
    case 'color':
      return monaco.languages.CompletionItemKind.Color
    case 'file':
      return monaco.languages.CompletionItemKind.File
    case 'reference':
      return monaco.languages.CompletionItemKind.Reference
    case 'folder':
      return monaco.languages.CompletionItemKind.Folder
    case 'type-parameter':
      return monaco.languages.CompletionItemKind.TypeParameter
    case 'text':
    case null:
      return monaco.languages.CompletionItemKind.Text
  }
}
