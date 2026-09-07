import type { FileEncoding, FileRevision } from '@shared/files'
import type { LanguageServerStatus, LspRenameDocumentEdit, LspRenameRejection } from '@shared/lsp'
import { fluvix } from '../../api/fluvix'
import { shouldUseLspRename } from '../lsp/renameAvailability'
import {
  applyRenameEditsToText,
  toEditorRenameEdits,
  type EditorRenameEdit
} from '../lsp/renameEdits'
import type { EditorDocumentStore } from './documentStore'
import { monaco, setBuiltInRenameSuppressed } from './monacoSetup'

/**
 * Rename の provider（Session 5-9）。
 *
 * ## Monaco へ「適用してくれ」と渡せない答えがある
 *
 * Monaco の bulk edit は、**Model がある文書にしか当てられない**
 * （standalone の実装は、Model の無い URI を渡されるとその場で例外を投げる。
 * editor/standalone/browser/standaloneServices.js の `StandaloneBulkEditService`）。
 * ところが Rename の答えには、タブとして開いていないファイルが普通に混ざる。
 *
 * そこで、この provider は**適用まで自分で持つ**。
 *
 * ```
 * 開いているファイル   … Model へ直接当てる（Monaco の bulk edit と同じ手順）
 * 開いていないファイル … 既存の保存経路（files:read-file → files:write-file）で書く
 * ```
 *
 * Monaco へ返すのは空の WorkspaceEdit になる。返す形を分けない
 * ── 片方を Monaco に、片方を自分で、にすると**適用の順序を決められない**。
 * 全部を自分で持てば「確かめ終わってから当てる」に一本化できる。
 *
 * ## 当てる順序
 *
 * ```
 * 1. サーバへ要求し、答えを受け取る
 * 2. 開いている文書ぶんを、範囲まで確かめて変換する（まだ当てない）
 * 3. 開いていないファイルを読み、置き換えた後の全文を作る（まだ書かない）
 * 4. 版が動いていないか、もう一度見る  ← ここまでは何も変えていない
 * 5. 開いている Model へまとめて当てる（同期。途中に await が無い）
 * 6. 開いていないファイルを書く
 * ```
 *
 * 4 までに1つでも通らなければ、**何も変えずに断る**。Rename は
 * 「全部変わるか、何も変わらないか」でなければ、参照が片側だけ変わった
 * コードが残る（main/lsp/renameResult.ts の冒頭と同じ判断）。
 *
 * 5 を同期で行うのは、開いている文書どうしの間に割り込みを作らないため。
 * 残る隙間は 6 だけで、そこで書けなかったファイルは名前を挙げて知らせる。
 *
 * ## Renderer に fs は増えていない
 *
 * 読み書きはどちらも既存の files ドメインを通る。渡すのは相対位置だけで、
 * Workspace の外は Main が断る（main/files/workspacePath.ts）。
 * この provider が新しく得た権限は1つも無い。
 *
 * ## 内蔵の Rename との二重適用が起きない理由
 *
 * Monaco の Rename は provider を順に試し、**断られたら次へ回す**。
 * したがって内蔵と並べたままにすると、本物のサーバが断った Rename を
 * 内蔵が実行しうる。登録している間ずっと内蔵を止め、fallback は
 * この provider の中から TypeScript worker を直接呼ぶ形にしてある
 * （整形と同じ組み立て。monaco/lspFormatting.ts）。
 */

/** 断った理由に、この層でしか起きないものを足したもの。 */
export type RenameFailure = LspRenameRejection | 'stale' | 'write-failed'

interface TypeScriptRenameInfo {
  readonly canRename?: boolean
  readonly localizedErrorMessage?: string
  readonly displayName?: string
  readonly fileToRename?: string
  readonly triggerSpan?: { readonly start: number; readonly length: number }
}

interface TypeScriptRenameLocation {
  readonly fileName?: string
  readonly textSpan?: { readonly start: number; readonly length: number }
}

interface RegisterLspRenameProviderOptions {
  readonly documents: EditorDocumentStore
  readonly getStatuses: () => readonly LanguageServerStatus[]
  /** 断りの1行（i18n は React 側が持つ。lsp/useRename.ts）。 */
  readonly describeFailure: (failure: RenameFailure, files?: readonly string[]) => string
  readonly nextPrepareSequence: () => number
  readonly isLatestPrepareSequence: (sequence: number) => boolean
  readonly nextRenameSequence: () => number
  readonly isLatestRenameSequence: (sequence: number) => boolean
}

type ProviderOptions = RegisterLspRenameProviderOptions & { readonly relativePath: string }

export function registerLspRenameProvider(
  options: RegisterLspRenameProviderOptions
): monaco.IDisposable {
  setBuiltInRenameSuppressed(true)

  const provider: monaco.languages.RenameProvider = {
    resolveRenameLocation: async (model, position, token) => {
      const relativePath = options.documents.getPathForModel(model)

      if (
        relativePath !== null &&
        shouldUseLspRename(model.getLanguageId(), options.getStatuses())
      ) {
        const location = await provideLspRenameLocation(model, position, token, {
          ...options,
          relativePath
        })

        if (location !== undefined) {
          return location
        }
      }

      return provideTypeScriptWorkerRenameLocation(model, position, token)
    },

    provideRenameEdits: async (model, position, newName, token) => {
      const relativePath = options.documents.getPathForModel(model)

      if (
        relativePath !== null &&
        shouldUseLspRename(model.getLanguageId(), options.getStatuses())
      ) {
        const edits = await provideLspRenameEdits(model, position, newName, token, {
          ...options,
          relativePath
        })

        if (edits !== undefined) {
          return edits
        }
      }

      return provideTypeScriptWorkerRenameEdits(model, position, newName, token)
    }
  }

  const registrations = [
    monaco.languages.registerRenameProvider('typescript', provider),
    monaco.languages.registerRenameProvider('javascript', provider)
  ]

  return {
    dispose: () => {
      for (const registration of registrations) {
        registration.dispose()
      }

      setBuiltInRenameSuppressed(false)
    }
  }
}

/* ------------------------------------------------------------ prepareRename */

/**
 * その位置で名前を変えられるか。
 *
 * `undefined` を返すと呼び出し側が内蔵へ落とす。落とすのは
 * **サーバが答えられる状態に無い**ときだけで、サーバが「変えられない」と
 * 答えた場合は断りとして返す（main/lsp/rename.ts と同じ線）。
 */
async function provideLspRenameLocation(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  token: monaco.CancellationToken,
  options: ProviderOptions
): Promise<(monaco.languages.RenameLocation & monaco.languages.Rejection) | undefined> {
  const version = model.getVersionId()
  const sequence = options.nextPrepareSequence()
  const result = await fluvix.lsp.prepareRename({
    relativePath: options.relativePath,
    version,
    position: toLspPosition(position)
  })

  if (
    token.isCancellationRequested ||
    !options.isLatestPrepareSequence(sequence) ||
    model.getVersionId() !== version
  ) {
    return rejectLocation(model, position, options.describeFailure('stale'))
  }

  if (!result.ok || result.data.status === 'unavailable') {
    return undefined
  }

  if (result.data.status === 'stale') {
    return rejectLocation(model, position, options.describeFailure('stale'))
  }

  if (result.data.status === 'rejected') {
    return rejectLocation(model, position, options.describeFailure(result.data.reason))
  }

  const { range, placeholder } = result.data

  /*
    範囲が無い（`defaultBehavior`）ときは、この場の単語を使う。
    Main は文書の本文を持たないため範囲を作れず、切り出せるのは
    **本文を持っている側**だけになる（shared/lsp/rename.ts）。
  */
  if (range === null) {
    const word = model.getWordAtPosition(position)

    if (word === null) {
      return rejectLocation(model, position, options.describeFailure('not-renameable'))
    }

    return {
      range: {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn
      },
      text: placeholder ?? word.word
    }
  }

  const converted = toEditorRenameEdits([{ range, text: '' }], toDocumentShape(model))

  if (converted === null) {
    return rejectLocation(model, position, options.describeFailure('malformed'))
  }

  const editorRange = converted[0]!.range

  return {
    range: editorRange,
    text: placeholder ?? model.getValueInRange(editorRange)
  }
}

/* -------------------------------------------------------------------- rename */

async function provideLspRenameEdits(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  newName: string,
  token: monaco.CancellationToken,
  options: ProviderOptions
): Promise<(monaco.languages.WorkspaceEdit & monaco.languages.Rejection) | undefined> {
  const version = model.getVersionId()
  const sequence = options.nextRenameSequence()
  const result = await fluvix.lsp.rename({
    relativePath: options.relativePath,
    version,
    position: toLspPosition(position),
    newName
  })

  if (
    token.isCancellationRequested ||
    !options.isLatestRenameSequence(sequence) ||
    model.getVersionId() !== version
  ) {
    return { edits: [], rejectReason: options.describeFailure('stale') }
  }

  if (!result.ok || result.data.status === 'unavailable') {
    return undefined
  }

  if (result.data.status === 'stale') {
    return { edits: [], rejectReason: options.describeFailure('stale') }
  }

  if (result.data.status === 'rejected') {
    return { edits: [], rejectReason: options.describeFailure(result.data.reason) }
  }

  return applyRenamePlan(result.data.documents, token, options)
}

interface OpenDocumentPlan {
  readonly model: monaco.editor.ITextModel
  readonly versionId: number
  readonly edits: readonly EditorRenameEdit[]
}

interface ClosedDocumentPlan {
  readonly relativePath: string
  /** 置き換えた後の全文。 */
  readonly content: string
  /** 読んだ時点の版。書くときに添えて、外での書き換えを Main に見張らせる。 */
  readonly baseRevision: FileRevision | null
  /** 読んだ時点の文字コード。そのまま書き戻す（BOM を落とさないため）。 */
  readonly encoding: FileEncoding | null
}

/**
 * 確かめてから当てる（このファイルの冒頭の6段）。
 */
async function applyRenamePlan(
  documents: readonly LspRenameDocumentEdit[],
  token: monaco.CancellationToken,
  options: ProviderOptions
): Promise<monaco.languages.WorkspaceEdit & monaco.languages.Rejection> {
  const open: OpenDocumentPlan[] = []
  const closedTargets: LspRenameDocumentEdit[] = []

  // 2. 開いている文書ぶんを、範囲まで確かめて変換する。
  for (const document of documents) {
    const model = options.documents.getModel(document.relativePath)

    if (model === null || model.isDisposed()) {
      closedTargets.push(document)
      continue
    }

    const edits = toEditorRenameEdits(document.edits, toDocumentShape(model))

    if (edits === null) {
      return { edits: [], rejectReason: options.describeFailure('malformed') }
    }

    open.push({ model, versionId: model.getVersionId(), edits })
  }

  // 3. 開いていないファイルを読み、置き換えた後の全文を作る。
  const closed: ClosedDocumentPlan[] = []

  for (const document of closedTargets) {
    const read = await fluvix.files.readFile({ relativePath: document.relativePath })

    if (!read.ok || read.data.status !== 'ok' || read.data.content === null) {
      return {
        edits: [],
        rejectReason: options.describeFailure('write-failed', [document.relativePath])
      }
    }

    const content = applyRenameEditsToText(read.data.content, document.edits)

    if (content === null) {
      return { edits: [], rejectReason: options.describeFailure('malformed') }
    }

    closed.push({
      relativePath: document.relativePath,
      content,
      baseRevision: read.data.revision,
      encoding: read.data.encoding
    })
  }

  // 4. ここまでで何も変えていない。取り消された / 版が動いたなら、やめる。
  if (token.isCancellationRequested) {
    return { edits: [], rejectReason: options.describeFailure('stale') }
  }

  for (const entry of open) {
    if (entry.model.isDisposed() || entry.model.getVersionId() !== entry.versionId) {
      return { edits: [], rejectReason: options.describeFailure('stale') }
    }
  }

  // 5. 開いている Model へまとめて当てる（await を挟まない）。
  for (const entry of open) {
    entry.model.pushStackElement()
    entry.model.pushEditOperations(
      [],
      entry.edits.map((edit) => ({ range: edit.range, text: edit.text })),
      () => null
    )
    entry.model.pushStackElement()
  }

  // 6. 開いていないファイルを書く。
  const failed: string[] = []

  for (const entry of closed) {
    const written = await fluvix.files.writeFile({
      relativePath: entry.relativePath,
      content: entry.content,
      // 読んだときの版を添える。外で書き換えられていれば Main が書かずに返す。
      baseRevision: entry.baseRevision,
      encoding: entry.encoding
    })

    if (!written.ok || written.data.status !== 'written') {
      failed.push(entry.relativePath)
    }
  }

  return failed.length === 0
    ? { edits: [] }
    : { edits: [], rejectReason: options.describeFailure('write-failed', failed) }
}

/* ------------------------------------------------- TypeScript worker の fallback */

/**
 * Monaco 内蔵の Rename（TypeScript worker）。
 *
 * 内蔵の provider をそのまま使わず呼び出す形にしてあるのは、Monaco から見える
 * Rename provider を1本に保つため（monaco/monacoSetup.ts の
 * `setBuiltInRenameSuppressed`）。手順は内蔵の実装と同じで、
 * **Model がある文書だけ**が対象になる ── worker は tsconfig も
 * node_modules も見ないため、そもそも Workspace 全体を知らない。
 */
async function provideTypeScriptWorkerRenameLocation(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  token: monaco.CancellationToken
): Promise<(monaco.languages.RenameLocation & monaco.languages.Rejection) | undefined> {
  const worker = await getTypeScriptWorker(model)

  if (worker === null || token.isCancellationRequested || model.isDisposed()) {
    return undefined
  }

  const offset = model.getOffsetAt(position)
  const info = (await worker.getRenameInfo(model.uri.toString(), offset, {
    allowRenameOfImportPath: false
  })) as TypeScriptRenameInfo | undefined

  if (token.isCancellationRequested || model.isDisposed()) {
    return undefined
  }

  if (info === undefined || info.canRename === false || info.triggerSpan === undefined) {
    return undefined
  }

  return {
    range: toSpanRange(model, info.triggerSpan),
    text: info.displayName ?? model.getValueInRange(toSpanRange(model, info.triggerSpan))
  }
}

async function provideTypeScriptWorkerRenameEdits(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  newName: string,
  token: monaco.CancellationToken
): Promise<(monaco.languages.WorkspaceEdit & monaco.languages.Rejection) | undefined> {
  const worker = await getTypeScriptWorker(model)

  if (worker === null || token.isCancellationRequested || model.isDisposed()) {
    return undefined
  }

  const fileName = model.uri.toString()
  const offset = model.getOffsetAt(position)
  const info = (await worker.getRenameInfo(fileName, offset, {
    allowRenameOfImportPath: false
  })) as TypeScriptRenameInfo | undefined

  if (token.isCancellationRequested || model.isDisposed()) {
    return { edits: [] }
  }

  if (info === undefined) {
    return undefined
  }

  if (info.canRename === false) {
    return { edits: [], rejectReason: info.localizedErrorMessage }
  }

  // ファイルそのものの改名は、この Session でも扱わない（LSP 側と同じ線）。
  if (info.fileToRename !== undefined) {
    return undefined
  }

  const locations = (await worker.findRenameLocations(fileName, offset, false, false, false)) as
    readonly TypeScriptRenameLocation[] | undefined

  if (token.isCancellationRequested || model.isDisposed()) {
    return { edits: [] }
  }

  if (!Array.isArray(locations)) {
    return undefined
  }

  const edits: monaco.languages.IWorkspaceTextEdit[] = []

  for (const location of locations) {
    if (typeof location.fileName !== 'string' || location.textSpan === undefined) {
      continue
    }

    const target = monaco.editor.getModel(monaco.Uri.parse(location.fileName))

    /*
      Model の無いファイルは worker からは書き換えられない
      （bulk edit が当てられない。このファイルの冒頭）。1件でも欠ければ
      片側だけ変わった状態になるため、部分適用にせず断る。
    */
    if (target === null) {
      return undefined
    }

    edits.push({
      resource: target.uri,
      versionId: undefined,
      textEdit: { range: toSpanRange(target, location.textSpan), text: newName }
    })
  }

  return { edits }
}

async function getTypeScriptWorker(
  model: monaco.editor.ITextModel
): Promise<monaco.typescript.TypeScriptWorker | null> {
  const getWorker =
    model.getLanguageId() === 'javascript'
      ? monaco.typescript.getJavaScriptWorker
      : monaco.typescript.getTypeScriptWorker

  try {
    const accessor = await getWorker()

    return await accessor(model.uri)
  } catch {
    // worker が用意できない（言語が外された・作り直しの途中）。
    return null
  }
}

/* -------------------------------------------------------------------- 素材 */

function toDocumentShape(model: monaco.editor.ITextModel): {
  readonly lineCount: number
  readonly getLineMaxColumn: (lineNumber: number) => number
} {
  return {
    lineCount: model.getLineCount(),
    getLineMaxColumn: (lineNumber) => model.getLineMaxColumn(lineNumber)
  }
}

function rejectLocation(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  rejectReason: string
): monaco.languages.RenameLocation & monaco.languages.Rejection {
  const word = model.getWordAtPosition(position)

  return {
    range: {
      startLineNumber: position.lineNumber,
      startColumn: word?.startColumn ?? position.column,
      endLineNumber: position.lineNumber,
      endColumn: word?.endColumn ?? position.column
    },
    text: word?.word ?? '',
    rejectReason
  }
}

function toSpanRange(
  model: monaco.editor.ITextModel,
  span: { readonly start: number; readonly length: number }
): monaco.IRange {
  const start = model.getPositionAt(span.start)
  const end = model.getPositionAt(span.start + Math.max(0, span.length))

  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column
  }
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
