import { IPC_EVENT_CHANNELS } from '@shared/ipc'
import type { TextDocumentContentChange } from '@shared/lsp'
import { emitIpcEvent } from '../ipc/events'
import { createLogger } from '../logger'
import {
  getCurrentWorkspaceFolder,
  onWorkspaceFolderChange
} from '../workspaceFolder/currentWorkspaceFolder'
import { resolveLspDocumentLanguage } from './documentLanguage'
import { resolveWorkspaceDocumentUri } from './documentUri'
import type { LanguageServerId } from './languageServerCatalog'
import {
  isLanguageServerReady,
  notifyLanguageServer,
  onLanguageServerStateChange,
  startLanguageServer
} from './languageServers'
import { OpenDocumentRegistry, type OpenLspDocument } from './openDocuments'
import {
  createDidChangeParams,
  createDidCloseParams,
  createDidOpenParams,
  createDidSaveParams,
  LSP_DID_CHANGE,
  LSP_DID_CLOSE,
  LSP_DID_OPEN,
  LSP_DID_SAVE
} from './textDocumentNotifications'

/**
 * 開いている文書と Language Server をつなぐ層（Session 5-2）。
 *
 * ```
 * Renderer（Monaco の Model の生き死に）
 *    ↓  relativePath + 版 + 中身 / 差分
 * main/ipc/handlers/lsp.ts     境界の外から来た値を確かめる
 *    ↓
 * ここ                          行き先を決め、サーバを立て、控え、電文にする
 *    ↓  method + params
 * main/lsp/languageServers.ts   立っているプロセスへ書き出す
 * ```
 *
 * 判断のうち**純粋なもの**は分けてある（この層は噛み合わせだけを持つ）。
 *
 * ```
 * documentLanguage.ts          拡張子 → どのサーバへ・どの languageId で
 * documentUri.ts               相対位置 → URI（Workspace の外なら null）
 * openDocuments.ts             開いている / 伝え終えた、の控え
 * textDocumentNotifications.ts 通知1通の形
 * ```
 *
 * ## サーバを立てるのはここ
 *
 * `startLanguageServer` を呼ぶ唯一の場所になる。**Renderer からサーバを名指しできる
 * 口は無い**（shared/ipc/contracts/lsp.ts）ので、起動はいつも
 * 「この拡張子のファイルが開かれた」の結果として起きる
 * ── DESIGN.md の STEP 5 引き継ぎがそのままここに落ちている。
 *
 * ## 本文を持たない
 *
 * この層は文書の中身を1文字も持たない（openDocuments.ts）。
 * 正本は Monaco の Model 1つで、差分を当てる処理を Main にもう1つ作らない。
 *
 * その代わり、サーバが文書を知らない状態になったとき（初期化前・立て直し後）は
 * **持っている側へ開き直しを頼む**（`lsp:sync-requested`）。
 *
 * ```
 * サーバが ready になった
 *    ↓  まだ伝えていない文書があるか
 * emitIpcEvent('lsp:sync-requested', { workspaceId })
 *    ↓
 * Renderer が開いている文書を didOpen で送り直す
 *    ↓
 * ここが「まだ伝えていない」ものだけを流す（既に届いているものは捨てる）
 * ```
 *
 * ## Workspace が変われば、控えも空にする
 *
 * サーバは切り替えで終わる（languageServers.ts）。控えを残すと、その相対位置は
 * **新しい Workspace の中の別のファイル**を指す ── documentStore.disposeAll が
 * Renderer 側で同じことをしているのと同じ理由になる。
 */

const log = createLogger('lsp-sync')

const documents = new OpenDocumentRegistry()

/**
 * 文書1件を扱った結果。
 *
 * `outside-workspace` を `untracked` と分けてあるのは**次の一手が違う**ため。
 * 前者は要求そのものが境界を越えており（呼び出し側が失敗として返す）、
 * 後者は「その言語のサーバが無い」という平常の答えになる。
 */
export type LspDocumentOutcome = 'tracked' | 'untracked' | 'outside-workspace'

/* --------------------------------------------------------------- 開く */

/**
 * 文書を開いたことを受け取る。
 *
 * 2度目以降（開き直しの依頼に対する返事）でも呼ばれる。**既に伝え終えている
 * 文書へ2通目の `didOpen` は送らない** ── 仕様上、開いている文書をもう一度
 * 開くのは誤りで、サーバによっては解析結果が二重になる。
 */
export function openLspDocument(
  relativePath: string,
  version: number,
  content: string
): LspDocumentOutcome {
  const workspace = getCurrentWorkspaceFolder()

  if (workspace === null) {
    return 'untracked'
  }

  const uri = resolveWorkspaceDocumentUri(workspace.rootPath, relativePath)

  if (uri === null) {
    return 'outside-workspace'
  }

  const language = resolveLspDocumentLanguage(relativePath)

  // その拡張子に対応するサーバが表に無い（`.md` / `.txt` など）。
  if (language === null) {
    return 'untracked'
  }

  const document = documents.register({
    relativePath,
    serverId: language.serverId,
    languageId: language.languageId,
    uri,
    version
  })

  if (document.synced) {
    // 既に届いている（開き直しの依頼に対する、余分な返事）。
    return 'tracked'
  }

  /*
    立っていなければ立てる。**この PC に入っていなければ立たない**が、
    それは「その言語だけが使えない」で済ませる（languageServerCatalog.ts）
    ── 控えは残す。後で立ち上がれば、そのときに開き直せる。
  */
  if (!isLanguageServerReady(language.serverId)) {
    const outcome = startLanguageServer(language.serverId)

    if (outcome.status !== 'started' && outcome.status !== 'already-running') {
      log.debug(`${relativePath} is not synchronized yet: ${outcome.status}`)
    }

    // 初期化が済んでいない。準備ができた時点で開き直しを頼む。
    return 'tracked'
  }

  send(document, LSP_DID_OPEN, createDidOpenParams(uri, language.languageId, version, content))

  return 'tracked'
}

/* ------------------------------------------------------------- 変わった */

/**
 * 中身が変わったことを受け取る。
 *
 * まだ伝えていない文書の差分は**捨てる**。送っても「開いていない文書への変更」
 * としてサーバに断られるだけで、埋めるのは開き直し（全文）になる。
 */
export function changeLspDocument(
  relativePath: string,
  version: number,
  changes: readonly TextDocumentContentChange[]
): void {
  const document = documents.get(relativePath)

  if (document === null || !document.synced) {
    return
  }

  if (send(document, LSP_DID_CHANGE, createDidChangeParams(document.uri, version, changes))) {
    /*
      送れたぶんだけ版を進める（Session 5-3）。これが診断の古さを判断する基準になる
      ── サーバが見ている中身と、こちらが控えている版が一致している必要がある
      （main/lsp/openDocuments.ts の setVersion）。
    */
    documents.setVersion(relativePath, version)
  }
}

/* --------------------------------------------------------------- 保存 */

/**
 * ディスクへ書けたことを受け取る。
 *
 * 版番号を取らない（保存は中身を変えないため版が動かない。
 * shared/ipc/contracts/lsp.ts）。
 */
export function saveLspDocument(relativePath: string): void {
  const document = documents.get(relativePath)

  if (document === null || !document.synced) {
    return
  }

  send(document, LSP_DID_SAVE, createDidSaveParams(document.uri))
}

/* --------------------------------------------------------------- 閉じる */

/**
 * 文書を閉じたことを受け取る。
 *
 * 知らない位置でも失敗にしない ── 片付けは何度呼ばれても同じ結果になるべきで、
 * 「もう無い」は片付けの目的から見れば成功にほかならない
 * （terminal:dispose / stopLanguageServer と同じ）。
 */
export function closeLspDocument(relativePath: string): void {
  const document = documents.remove(relativePath)

  if (document === null || !document.synced) {
    return
  }

  notifyLanguageServer(document.serverId, LSP_DID_CLOSE, createDidCloseParams(document.uri))
}

/* ------------------------------------------------------------- 控えを見る */

/**
 * 控えている文書1件（Session 5-3）。
 *
 * 診断を受け取る側（main/lsp/diagnostics.ts）が使う。**書き換える口は無い**
 * ── 控えを動かせるのは、この層に届く4つの出来事だけに保つ。
 *
 * 返るものに URI と版が入っているのは、届いた診断が
 * 「この文書のもので、今の中身に対するものか」を確かめるのに要るため。
 */
export function getOpenLspDocument(relativePath: string): OpenLspDocument | null {
  return documents.get(relativePath)
}

/**
 * そのサーバが担当している文書の位置（Session 5-3）。
 *
 * サーバが終わったときに、どの文書の診断がもう有効でないかを数えるのに使う。
 */
export function listOpenLspDocumentPaths(serverId: LanguageServerId): readonly string[] {
  return documents.listPaths(serverId)
}

/* ----------------------------------------------------------------- 送る */

/**
 * 1通送り、`didOpen` が通ったことを控える。
 *
 * 書けなかった場合（終了とほぼ同時に送った）は控えを進めない ── 進めると、
 * サーバが知らない文書を「伝え終えた」ものとして扱い、以降の差分が
 * 宙に浮いたまま届かなくなる。立ち直りの時点で開き直しの対象に入る。
 */
function send(document: OpenLspDocument, method: string, params: Record<string, unknown>): boolean {
  const sent = notifyLanguageServer(document.serverId, method, params)

  if (!sent) {
    log.debug(`"${method}" was not delivered for ${document.relativePath}.`)
    return false
  }

  if (method === LSP_DID_OPEN) {
    documents.markSynced(document.relativePath)
  }

  return true
}

/* --------------------------------------------------------------- 入口 */

/**
 * サーバの状態と Workspace の切り替えに追従し始める（アプリの起動時に1度だけ）。
 *
 * 購読をここで張るのは、**それぞれの出来事に対して何をするかがこの層の判断**
 * であるため（startLanguageServerHosting と同じ形）。
 */
export function startLanguageServerDocumentSync(): void {
  onLanguageServerStateChange((id, state) => {
    if (state === 'stopped') {
      /*
        そのプロセスはもう文書を知らない。控えは消さず「まだ伝えていない」へ戻す
        ── Editor ではまだ開いており、立ち直った後の開き直しの対象になる。
      */
      documents.markServerStopped(id)
      return
    }

    // 話せるようになった。伝えていない文書があるなら、中身を持つ側へ頼む。
    if (documents.hasUnsynced(id)) {
      requestResync()
    }
  })

  onWorkspaceFolderChange(() => {
    /*
      サーバは切り替えで終わる（languageServers.ts）ので、送る相手はもう居ない。
      控えだけを空にする ── 残すと、その相対位置が新しい Workspace の中の
      別のファイルを指す。
    */
    const cleared = documents.clear()

    if (cleared.length > 0) {
      log.debug(`dropped ${cleared.length} open document(s): the workspace folder changed.`)
    }
  })
}

/**
 * 開いている文書を送り直してほしい、と Renderer へ頼む。
 *
 * Workspace が開かれていなければ何もしない（送り直す相手も対象も無い）。
 * `workspaceId` を載せるのは、切り替えと行き違ったときに受け手が捨てられるように
 * するため（shared/ipc/events/lsp.ts）。
 */
function requestResync(): void {
  const workspace = getCurrentWorkspaceFolder()

  if (workspace === null) {
    return
  }

  emitIpcEvent(IPC_EVENT_CHANNELS.LSP_SYNC_REQUESTED, { workspaceId: workspace.id })
}
