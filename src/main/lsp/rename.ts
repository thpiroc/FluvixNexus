import { realpath, stat } from 'fs/promises'
import {
  isValidLspRenameName,
  type LspPrepareRenameRequest,
  type LspPrepareRenameResponse,
  type LspRenameDocumentEdit,
  type LspRenameRequest,
  type LspRenameResponse,
  type TextDocumentPosition
} from '@shared/lsp'
import { isInsideWorkspace, resolveWorkspacePath } from '../files/workspacePath'
import { createLogger } from '../logger'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import { resolveLspDocumentLanguage } from './documentLanguage'
import { getOpenLspDocument } from './documentSync'
import { resolveWorkspaceDocumentUri } from './documentUri'
import { isLanguageServerAllowed } from './languageServerSettings'
import { requestLanguageServer } from './languageServers'
import { parsePrepareRenameResult, parseRenameResult } from './renameResult'

const log = createLogger('lsp-rename')

export type LspPrepareRenameOutcome =
  LspPrepareRenameResponse | { readonly status: 'outside-workspace' }

export type LspRenameOutcome = LspRenameResponse | { readonly status: 'outside-workspace' }

const LSP_PREPARE_RENAME = 'textDocument/prepareRename'
const LSP_RENAME = 'textDocument/rename'

/** JSON-RPC の「そんな method は無い」。 */
const JSON_RPC_METHOD_NOT_FOUND = -32601

/**
 * Rename の Main 側（Session 5-9）。
 *
 * ## 5-5〜5-8 と同じ入口、1つだけ多い出口
 *
 * 要求を受ける前の確かめ方は他の機能とまったく同じで、`prepareRenameRequest`
 * が navigation.ts / formatting.ts と同じ順に通す。
 *
 * ```
 * Workspace が開いているか → 相対位置が中を指すか → 拡張子がサーバに対応するか
 * → 設定で使うことになっているか → その文書を同期しているか → 版が合っているか
 * ```
 *
 * 違うのは**答えを受け取った後**で、Rename だけは「返ってきた位置が
 * Workspace の中の実在するファイルか」まで確かめる（`filterExistingDocuments`）。
 * 他の機能の答えは見せるだけだが、こちらの答えは**書き換える先**にあたる。
 *
 * ## サーバの失敗を built-in へ落とさない
 *
 * `unavailable` を返すと Renderer は Monaco 内蔵の Rename へ落ちる
 * （renderer/src/editor/monaco/lspRename.ts）。落としてよいのは
 * **サーバが答えられる状態に無い**ときだけで、サーバが「その位置は変えられない」
 * と答えた場合は落とさない ── 落とすと、本物のサーバが断った Rename を
 * tsconfig も node_modules も見ていない内蔵の側が実行することになる。
 *
 * ```
 * サーバが居ない / 立ち上がり中 / 設定で OFF … unavailable（built-in へ落ちる）
 * method が無い（古いサーバ）                … unavailable（built-in へ落ちる）
 * サーバが失敗を返した                       … rejected（落とさない）
 * 位置が変えられない / 答えが扱えない形      … rejected（落とさない）
 * ```
 */
export async function requestLspPrepareRename(
  request: LspPrepareRenameRequest
): Promise<LspPrepareRenameOutcome> {
  const prepared = prepareRenameRequest(request)

  if (prepared.status !== 'ready') {
    return prepared
  }

  const pending = requestLanguageServer(prepared.serverId, LSP_PREPARE_RENAME, {
    textDocument: { uri: prepared.uri },
    position: request.position
  })

  if (pending === null) {
    return { status: 'unavailable' }
  }

  const outcome = await pending
  const freshness = checkFreshness(request)

  if (freshness !== null) {
    return freshness
  }

  if (outcome.status === 'closed') {
    return { status: 'unavailable' }
  }

  if (outcome.status === 'error') {
    return outcome.error.code === JSON_RPC_METHOD_NOT_FOUND
      ? { status: 'unavailable' }
      : { status: 'rejected', reason: 'not-renameable' }
  }

  const parsed = parsePrepareRenameResult(outcome.result)

  if (parsed.status !== 'ok') {
    if (parsed.reason === 'malformed') {
      log.warn(`ignored a malformed "${LSP_PREPARE_RENAME}" response.`)
    }

    return parsed
  }

  return {
    status: 'ok',
    version: request.version,
    range: parsed.range,
    placeholder: parsed.placeholder
  }
}

export async function requestLspRename(request: LspRenameRequest): Promise<LspRenameOutcome> {
  /*
    名前を先に確かめる。サーバへ送ってから断るより、送らずに断つ方が
    「境界の外から来た文字列は、越えるところで確かめる」に沿う
    （main/ipc/handlers/lsp.ts も同じ検証を通すが、こちらは
    別の入口から呼ばれても同じ結末になるように置いてある）。
  */
  if (!isValidLspRenameName(request.newName)) {
    return { status: 'rejected', reason: 'invalid-name' }
  }

  const prepared = prepareRenameRequest(request)

  if (prepared.status !== 'ready') {
    return prepared
  }

  const pending = requestLanguageServer(prepared.serverId, LSP_RENAME, {
    textDocument: { uri: prepared.uri },
    position: request.position,
    newName: request.newName
  })

  if (pending === null) {
    return { status: 'unavailable' }
  }

  const outcome = await pending
  const freshness = checkFreshness(request)

  if (freshness !== null) {
    return freshness
  }

  if (outcome.status === 'closed') {
    return { status: 'unavailable' }
  }

  if (outcome.status === 'error') {
    return outcome.error.code === JSON_RPC_METHOD_NOT_FOUND
      ? { status: 'unavailable' }
      : { status: 'rejected', reason: 'server-error' }
  }

  const parsed = parseRenameResult(prepared.rootPath, outcome.result)

  if (parsed.status !== 'ok') {
    if (parsed.reason === 'malformed') {
      log.warn(`ignored a malformed "${LSP_RENAME}" response.`)
    } else {
      log.warn(`refused a "${LSP_RENAME}" response (${parsed.reason}).`)
    }

    return parsed
  }

  const documents = await filterExistingDocuments(prepared.rootPath, parsed.documents)

  if (documents === null) {
    log.warn(`refused a "${LSP_RENAME}" response that pointed outside the workspace.`)
    return { status: 'rejected', reason: 'outside-workspace' }
  }

  /*
    ファイルを読み書きしている間に文書が変わっていないか、最後にもう一度見る。
    ここで古くなっていれば適用しない ── Renderer 側でも同じ判断をするが、
    **どちらか一方だけに任せない**（IPC の往復を挟むほど間が空く）。
  */
  const settled = checkFreshness(request)

  if (settled !== null) {
    return settled
  }

  return { status: 'ok', version: request.version, documents }
}

/* --------------------------------------------------------------- 事前の確認 */

type PreparedRenameRequest =
  | {
      readonly status: 'ready'
      readonly rootPath: string
      readonly uri: string
      readonly serverId: 'typescript'
    }
  | { readonly status: 'outside-workspace' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'stale' }

function prepareRenameRequest(request: {
  readonly relativePath: string
  readonly version: number
  readonly position: TextDocumentPosition
}): PreparedRenameRequest {
  const workspace = getCurrentWorkspaceFolder()

  if (workspace === null) {
    return { status: 'unavailable' }
  }

  const uri = resolveWorkspaceDocumentUri(workspace.rootPath, request.relativePath)

  if (uri === null) {
    return { status: 'outside-workspace' }
  }

  const language = resolveLspDocumentLanguage(request.relativePath)

  if (language === null || language.serverId !== 'typescript') {
    return { status: 'unavailable' }
  }

  if (!isLanguageServerAllowed(language.serverId)) {
    return { status: 'unavailable' }
  }

  const document = getOpenLspDocument(request.relativePath)

  if (document === null || !document.synced || document.serverId !== language.serverId) {
    return { status: 'unavailable' }
  }

  if (document.version !== request.version) {
    return { status: 'stale' }
  }

  return { status: 'ready', rootPath: workspace.rootPath, uri, serverId: language.serverId }
}

function checkFreshness(request: {
  readonly relativePath: string
  readonly version: number
}): { readonly status: 'stale' } | null {
  const current = getOpenLspDocument(request.relativePath)

  return current === null || current.version !== request.version ? { status: 'stale' } : null
}

/* ------------------------------------------------ 書き換え先が実在するか */

/**
 * 返ってきた相対位置が、**Workspace の中に実在する普通のファイル**かを確かめる。
 *
 * 1件でも通らなければ null（＝ Rename ごと断る。部分適用にしない）。
 *
 * ## 文字列の判断だけでは足りない
 *
 * `toWorkspaceRelativePath`（main/lsp/documentUri.ts）は文字列として
 * Workspace の中かを見るが、realpath は取らない。診断や定義の位置は
 * **見せるだけ**なのでそれで足りていた ── Rename は書く側なので、
 * ファイルを開く経路（main/files/readWorkspaceFile.ts）と同じく実体まで見る。
 *
 * ```
 * 中の symlink が外を指している … 断る（realpath が外に出る）
 * フォルダ / デバイス            … 断る（isFile() でない）
 * 消えている                     … 断る（stat が ENOENT）
 * ```
 *
 * 実際に書くのは Renderer から `files:write-file` を通る経路で、そちらでも
 * 同じ検証が走る。二重に見えるが、**ここで断つと「書けない位置を渡してから
 * 失敗する」ではなく「渡さない」になる** ── 部分適用を作らないために、
 * 適用が始まる前に全件が揃っていることを確かめておく必要がある。
 */
async function filterExistingDocuments(
  rootPath: string,
  documents: readonly LspRenameDocumentEdit[]
): Promise<readonly LspRenameDocumentEdit[] | null> {
  if (documents.length === 0) {
    return documents
  }

  let realRootPath: string

  try {
    realRootPath = await realpath(rootPath)
  } catch {
    return null
  }

  for (const document of documents) {
    const absolutePath = resolveWorkspacePath(rootPath, document.relativePath)

    if (absolutePath === null) {
      return null
    }

    try {
      const realPath = await realpath(absolutePath)

      if (!isInsideWorkspace(realRootPath, realPath)) {
        return null
      }

      if (!(await stat(realPath)).isFile()) {
        return null
      }
    } catch {
      // 消えている・権限が無い・辿れない。どれも「書いてよい先」ではない。
      return null
    }
  }

  return documents
}
