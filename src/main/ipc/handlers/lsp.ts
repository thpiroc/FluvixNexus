import {
  IPC_CHANNELS,
  type ChangeLspDocumentRequest,
  type CloseLspDocumentRequest,
  type LspCompletionRequest,
  type LspCompletionResponse,
  type LspHoverRequest,
  type LspHoverResponse,
  type LspStatusResponse,
  type OpenLspDocumentRequest,
  type OpenLspDocumentResponse,
  type SaveLspDocumentRequest
} from '@shared/ipc'
import {
  isTextDocumentContentChange,
  isTextDocumentVersion,
  LSP_DOCUMENT_MAX_CONTENT_CHANGES,
  LSP_DOCUMENT_MAX_TEXT_LENGTH,
  type LspCompletionTriggerKind,
  type TextDocumentPosition,
  type TextDocumentContentChange
} from '@shared/lsp'
import { normalizeWorkspaceRelativePath } from '../../files/workspacePath'
import {
  changeLspDocument,
  closeLspDocument,
  openLspDocument,
  saveLspDocument
} from '../../lsp/documentSync'
import { requestLspCompletion } from '../../lsp/completion'
import { requestLspHover } from '../../lsp/hover'
import { getLanguageServerStatuses } from '../../lsp/serverStatus'
import { IpcError, invalidRequest } from '../errors'
import { handleIpc } from '../registry'

/**
 * lsp ドメインのハンドラ（Session 5-2 ── Document Synchronization）。
 *
 * このファイルが持つのは2つだけで、サーバとの話は main/lsp/ に閉じている
 * （terminal ドメインと同じ分担）。
 *   - 境界の外から来た値（相対位置・版・本文・差分）を確かめる
 *   - ドメインの結末を IPC の失敗分類へ翻訳する
 *
 * ## 確かめるものが3つある
 *
 * ```
 * 相対位置 … Workspace の中を指しているか（`..`・絶対パス・ドライブ相対を弾く）
 * 版       … 0 以上の整数か
 * 本文と差分 … 文字列か・長さと件数が上限の中か
 * ```
 *
 * 相対位置の検証に Files ドメインと**同じ関数**を使うのが要点になる
 * （main/files/workspacePath.ts）。別の検証を書き起こすと、片方だけに穴が空く。
 *
 * ## 上限を確かめる理由
 *
 * ここは、Renderer から来た文字列を**そのまま子プロセスの標準入力へ流す**経路になる
 * （`terminal:write` と同じ性質）。中身は見ないが、長さと件数だけは確かめる
 * ── 桁違いの値をそのまま電文にすると、その1通で JSON-RPC の上限に当たる。
 *
 * ## 同期で書き出す
 *
 * どのハンドラも `await` を含まない。**到着の順序をそのまま送信の順序にする**ため
 * ── `didOpen` の途中で `didChange` が割り込むと、サーバは
 * 「開いていない文書への変更」を受け取ることになる（shared/ipc/contracts/lsp.ts）。
 */
export function registerLspHandlers(): void {
  handleIpc(
    IPC_CHANNELS.LSP_DID_OPEN,
    (request: OpenLspDocumentRequest): OpenLspDocumentResponse => {
      const relativePath = normalizeDocumentPath(request?.relativePath)
      const version = normalizeVersion(request?.version)
      const content = request?.content

      if (typeof content !== 'string') {
        throw invalidRequest('the document content must be a string.')
      }

      if (content.length > LSP_DOCUMENT_MAX_TEXT_LENGTH) {
        throw invalidRequest(
          `the document content is too long (max ${LSP_DOCUMENT_MAX_TEXT_LENGTH} characters).`
        )
      }

      const outcome = openLspDocument(relativePath, version, content)

      if (outcome === 'outside-workspace') {
        throw outsideWorkspace()
      }

      return { tracked: outcome === 'tracked' }
    }
  )

  handleIpc(IPC_CHANNELS.LSP_DID_CHANGE, (request: ChangeLspDocumentRequest): void => {
    const relativePath = normalizeDocumentPath(request?.relativePath)
    const version = normalizeVersion(request?.version)
    const changes = normalizeChanges(request?.changes)

    changeLspDocument(relativePath, version, changes)
  })

  handleIpc(IPC_CHANNELS.LSP_DID_SAVE, (request: SaveLspDocumentRequest): void => {
    saveLspDocument(normalizeDocumentPath(request?.relativePath))
  })

  handleIpc(IPC_CHANNELS.LSP_DID_CLOSE, (request: CloseLspDocumentRequest): void => {
    /*
      知らない位置でも失敗にしない（main/lsp/documentSync.ts）。
      それでも相対位置の検証は通す ── 検証を飛ばしてよい経路を1つでも作ると、
      「どの口なら何を渡せるか」が場所ごとに変わる。
    */
    closeLspDocument(normalizeDocumentPath(request?.relativePath))
  })

  handleIpc(
    IPC_CHANNELS.LSP_COMPLETION,
    async (request: LspCompletionRequest): Promise<LspCompletionResponse> => {
      const outcome = await requestLspCompletion({
        relativePath: normalizeDocumentPath(request?.relativePath),
        version: normalizeVersion(request?.version),
        position: normalizePosition(request?.position),
        ...normalizeCompletionContext(request?.triggerKind, request?.triggerCharacter)
      })

      if (outcome.status === 'outside-workspace') {
        throw outsideWorkspace()
      }

      return outcome
    }
  )

  handleIpc(IPC_CHANNELS.LSP_HOVER, async (request: LspHoverRequest): Promise<LspHoverResponse> => {
    const outcome = await requestLspHover({
      relativePath: normalizeDocumentPath(request?.relativePath),
      version: normalizeVersion(request?.version),
      position: normalizePosition(request?.position)
    })

    if (outcome.status === 'outside-workspace') {
      throw outsideWorkspace()
    }

    return outcome
  })

  /*
    サーバの状態（Session 5-4）。**要求に欄が1つも無い** ── どのサーバの
    状態を返すかも Renderer は言わず、返るのは常に3本ぶんになる。

    確かめるものが無いのは、境界の外から来る値が無いためにほかならない
    （`system:app-info` と同じ形）。逆向き ── 返す側 ── で守っているものは
    main/lsp/serverStatus.ts の冒頭にあり、載るのは表の行の名前と状態だけで、
    実行ファイルも pid も終了コードも出て行かない。
  */
  handleIpc(IPC_CHANNELS.LSP_GET_STATUS, (): LspStatusResponse => {
    return { servers: getLanguageServerStatuses() }
  })
}

/**
 * 文書を指す相対位置として受け取れる形か。
 *
 * Workspace の外を指す形（`..`・絶対パス・ドライブ相対）はここで落ちる。
 * root（空文字）も落とす ── フォルダは文書ではない。
 *
 * **ここを通っただけでは足りない。** 実際に URI へ落とすときに、
 * 解決した絶対パスが Workspace の中にあることをもう一度確かめる
 * （main/lsp/documentUri.ts）。文字列の検査と、組み立てた結果の検査は別のもので、
 * 両方を通して初めて「外へ出られない」と言える（Files ドメインと同じ形）。
 */
function normalizeDocumentPath(value: unknown): string {
  const relativePath = normalizeWorkspaceRelativePath(value)

  if (relativePath === null || relativePath === '') {
    throw invalidRequest('the document path is missing or not inside the workspace.')
  }

  return relativePath
}

function normalizeVersion(value: unknown): number {
  if (!isTextDocumentVersion(value)) {
    throw invalidRequest('the document version must be a non-negative integer.')
  }

  return value
}

function normalizeChanges(value: unknown): readonly TextDocumentContentChange[] {
  if (!Array.isArray(value)) {
    throw invalidRequest('the document changes must be given as an array.')
  }

  if (value.length > LSP_DOCUMENT_MAX_CONTENT_CHANGES) {
    throw invalidRequest(
      `too many document changes in one notification (max ${LSP_DOCUMENT_MAX_CONTENT_CHANGES}).`
    )
  }

  let length = 0

  for (const change of value) {
    if (!isTextDocumentContentChange(change)) {
      throw invalidRequest('a document change has an unexpected shape.')
    }

    length += change.text.length
  }

  if (length > LSP_DOCUMENT_MAX_TEXT_LENGTH) {
    throw invalidRequest(
      `the document changes are too long (max ${LSP_DOCUMENT_MAX_TEXT_LENGTH} characters).`
    )
  }

  return value as readonly TextDocumentContentChange[]
}

function normalizePosition(value: unknown): TextDocumentPosition {
  if (typeof value !== 'object' || value === null) {
    throw invalidRequest('the document position has an unexpected shape.')
  }

  const position = value as { readonly line: unknown; readonly character: unknown }

  if (!isTextDocumentVersion(position.line) || !isTextDocumentVersion(position.character)) {
    throw invalidRequest('the document position must use non-negative integers.')
  }

  return { line: position.line, character: position.character }
}

function normalizeCompletionContext(
  rawTriggerKind: unknown,
  rawTriggerCharacter: unknown
): {
  readonly triggerKind?: LspCompletionTriggerKind
  readonly triggerCharacter?: string
} {
  if (rawTriggerKind === undefined) {
    return {}
  }

  if (
    rawTriggerKind !== 'invoked' &&
    rawTriggerKind !== 'trigger-character' &&
    rawTriggerKind !== 'trigger-for-incomplete-completions'
  ) {
    throw invalidRequest('the completion trigger kind is not supported.')
  }

  if (rawTriggerCharacter === undefined) {
    return { triggerKind: rawTriggerKind }
  }

  if (typeof rawTriggerCharacter !== 'string' || rawTriggerCharacter.length !== 1) {
    throw invalidRequest('the completion trigger character must be a single character.')
  }

  return { triggerKind: rawTriggerKind, triggerCharacter: rawTriggerCharacter }
}

/**
 * Workspace の外を指していた。
 *
 * INVALID_REQUEST ではなく PERMISSION_DENIED にしてあるのは、
 * **要求の形は正しい**ため ── 越えてはいけない線を越えていることを、
 * 形の誤りと同じ分類に混ぜない（Files ドメインの扱いと揃えてある）。
 */
function outsideWorkspace(): IpcError {
  return new IpcError('PERMISSION_DENIED', 'the document is outside the workspace folder.')
}
