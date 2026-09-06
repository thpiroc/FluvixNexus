import { IPC_EVENT_CHANNELS } from '@shared/ipc'
import { emitIpcEvent } from '../ipc/events'
import { createLogger } from '../logger'
import {
  getCurrentWorkspaceFolder,
  onWorkspaceFolderChange
} from '../workspaceFolder/currentWorkspaceFolder'
import { getOpenLspDocument, listOpenLspDocumentPaths } from './documentSync'
import { toWorkspaceRelativePath } from './documentUri'
import type { LanguageServerId } from './languageServerCatalog'
import { onLanguageServerNotification, onLanguageServerStateChange } from './languageServers'
import { parsePublishDiagnosticsParams } from './publishDiagnostics'

/**
 * サーバが出した指摘を Renderer へ届ける層（Session 5-3）。
 *
 * ```
 * Language Server
 *    ↓  textDocument/publishDiagnostics（URI + 版 + 指摘の配列）
 * main/lsp/languageServers.ts   届いた通知を、聞いている相手へ回す
 *    ↓
 * ここ                          読む・境界を確かめる・古さを見る・相対位置へ落とす
 *    ↓  emitIpcEvent('lsp:diagnostics', { workspaceId, relativePath, version, … })
 * Renderer                      Monaco の marker にする
 * ```
 *
 * 判断のうち**純粋なもの**は分けてある（この層は噛み合わせだけを持つ）。
 *
 * ```
 * publishDiagnostics.ts  相手の JSON を読む（1件ずつ確かめ、上限で切る）
 * documentUri.ts         URI → 相対位置（Workspace の外なら null）
 * openDocuments.ts       今その文書に伝えてある版
 * ```
 *
 * ## 通す前に4つ確かめる
 *
 * 診断は**サーバが好きな URI に対して好きなときに送れる**。したがって
 * 届いたものをそのまま Renderer へ流さない。
 *
 * | 確かめること            | 通らなかったら       | なぜ                                              |
 * | ----------------------- | -------------------- | ------------------------------------------------- |
 * | 電文として読めるか      | 1通まるごと捨てる    | 形が違うものを Renderer まで運ばない              |
 * | Workspace の中の URI か | 捨てる（警告を残す） | **Renderer は外を指せない**という線を入口でも守る |
 * | 開いている文書か        | 捨てる               | Model が無ければ marker の置き場所が無い          |
 * | 担当しているサーバか    | 捨てる               | 別のサーバの意見で、担当の指摘を消さない          |
 * | 今の版に対するものか    | 捨てる               | 古い位置に線を引くと、直した箇所に赤が残る        |
 *
 * **URI そのものは突き合わせない。** サーバは同じ場所を別の表記で返す
 * （ドライブレターの大小・符号化の仕方）ので、同じ文書だと言える根拠は
 * 解決した後の相対位置にする（下記）。
 *
 * ## 古い指摘を捨てる（stale 判定）
 *
 * `publishDiagnostics` には、計算に使った文書の版が載ることがある。
 * こちらは**サーバへ最後に伝えた版**を控えているので（openDocuments.ts）、
 * 突き合わせて食い違えば捨てる。
 *
 * ```
 * 版 5 を伝える  →  打鍵で版 6 を伝える  →  版 5 の指摘が届く  →  捨てる
 *                                       →  版 6 の指摘が届く  →  通す
 * ```
 *
 * **打ち続けている間、指摘は止まる。** それでよい ── 位置が1文字ずれた赤線は、
 * 出ないことより分かりにくい。打鍵が止まればサーバが計算し直し、次の版で届く。
 *
 * 版を言わないサーバもある（仕様上は任意）。その場合は突き合わせようが無いので通す
 * ── 受け手側にも順序の確かめがある（renderer/src/editor/lsp/diagnosticStore.ts）。
 *
 * ## 開いていない文書の指摘は捨てる
 *
 * サーバはプロジェクト全体を解析するため、**開いていないファイル**についても
 * 指摘を送ってくる（tsserver / pyright とも実際に送る）。Session 5-3 では捨てる。
 *
 *   - 置き場所が無い（Monaco の marker は Model に付く。Model はタブが持つ）
 *   - 溜め込むと、開いてもいないファイルぶんの指摘を Main が抱え続ける
 *
 * 一覧として見せる面（Problems）を作るときに、溜める場所と一緒に足す（Session 5-4 以降）。
 *
 * ## 「無くなった」と「答えられない」を分ける
 *
 * ```
 * lsp:diagnostics（空の配列）  … サーバが「この文書に問題は無い」と言った
 * lsp:diagnostics-cleared      … サーバがもう答えられない（落ちた・終わった・切り替わった）
 * ```
 *
 * 受け手の次の一手が違うため、別のイベントにしてある（shared/ipc/events/lsp.ts）。
 * 後者では Renderer が **Monaco 内蔵の指摘へ戻す** ── サーバが居ない間、
 * 何も出ないままにすると STEP 4 までより悪くなる。
 */

const log = createLogger('lsp-diagnostics')

/* --------------------------------------------------------------- 受け取る */

/** サーバが指摘を送ってくる通知。 */
const PUBLISH_DIAGNOSTICS = 'textDocument/publishDiagnostics'

function handlePublishDiagnostics(serverId: LanguageServerId, params: unknown): void {
  const workspace = getCurrentWorkspaceFolder()

  /*
    Workspace が閉じられた直後。サーバは終わっている最中で、まだ届くことがある。
    載せる workspaceId が無く、受け手にも表示する Model が無い。
  */
  if (workspace === null) {
    return
  }

  const published = parsePublishDiagnosticsParams(params)

  if (published === null) {
    log.warn(`ignored a malformed "${PUBLISH_DIAGNOSTICS}" from ${serverId}.`)
    return
  }

  const relativePath = toWorkspaceRelativePath(workspace.rootPath, published.uri)

  if (relativePath === null) {
    /*
      Workspace の外・`file:` 以外の scheme・読めない符号化。
      **ここで止まるので、Renderer には届かない。**
      警告に URI そのものを載せない（サーバが送ってきた任意の文字列で、
      ログの1行を組み立てる材料にしない）。
    */
    log.warn(`ignored diagnostics from ${serverId} for a document outside the workspace.`)
    return
  }

  const document = getOpenLspDocument(relativePath)

  // 開いていないファイル（プロジェクト全体の解析結果）。上記のとおり捨てる。
  if (document === null) {
    log.debug(`ignored diagnostics for a document that is not open: ${relativePath}`)
    return
  }

  /*
    その文書を担当していないサーバからの指摘。**別のサーバの意見で
    marker を入れ替えない** ── 入れ替えると、担当サーバの指摘が黙って消える。
  */
  if (document.serverId !== serverId) {
    log.debug(
      `ignored diagnostics from ${serverId} for a document it does not own: ${relativePath}`
    )
    return
  }

  /*
    ここで `document.uri` と `published.uri` を文字列として比べてはいけない。

    **サーバは同じ場所を別の表記で返す。** typescript-language-server は
    ドライブレターを小文字に直して返す（こちらが `file:///D%3A/…` で送っても
    `file:///d%3A/…` で返ってくる）ほか、符号化の仕方もサーバごとに違う。
    文字列で比べると、正しい診断がすべて捨てられる ── 実際に繋いで確かめた。

    同じ文書だと言える根拠は、**解決した後の相対位置**にする。
    そこまでの経路（toWorkspaceRelativePath）が、大文字小文字も符号化も
    OS の規則で正規化したうえで Workspace の中に収まることを確かめている。
  */

  if (published.version !== null && published.version !== document.version) {
    // 古い版に対する指摘（上記の stale 判定）。
    log.debug(
      `ignored stale diagnostics for ${relativePath}: ` +
        `published=${published.version} current=${document.version}`
    )

    return
  }

  emitIpcEvent(IPC_EVENT_CHANNELS.LSP_DIAGNOSTICS, {
    workspaceId: workspace.id,
    relativePath,
    version: published.version,
    diagnostics: published.diagnostics
  })
}

/* ----------------------------------------------------------------- 片付け */

/**
 * そのサーバが答えられなくなった。
 *
 * 担当していた文書の指摘は、もう「今の中身に対するもの」ではない。
 * **残すと、直したはずの赤線が消えないまま固まる。**
 */
function clearForServer(serverId: LanguageServerId): void {
  const workspace = getCurrentWorkspaceFolder()

  if (workspace === null) {
    return
  }

  const relativePaths = listOpenLspDocumentPaths(serverId)

  if (relativePaths.length === 0) {
    return
  }

  emitIpcEvent(IPC_EVENT_CHANNELS.LSP_DIAGNOSTICS_CLEARED, {
    workspaceId: workspace.id,
    relativePaths
  })
}

/* --------------------------------------------------------------- 入口 */

/**
 * 診断の受け取りを始める（アプリの起動時に1度だけ）。
 *
 * 購読をここで張るのは、それぞれの出来事に対して何をするかがこの層の判断であるため
 * （startLanguageServerHosting / startLanguageServerDocumentSync と同じ形）。
 */
export function startLanguageServerDiagnostics(): void {
  onLanguageServerNotification((serverId, method, params) => {
    if (method !== PUBLISH_DIAGNOSTICS) {
      return false
    }

    handlePublishDiagnostics(serverId, params)

    return true
  })

  onLanguageServerStateChange((serverId, state) => {
    if (state === 'stopped') {
      clearForServer(serverId)
    }
  })

  onWorkspaceFolderChange((workspace) => {
    /*
      切り替え。**位置を数え直さずに「全部」と言う**（空の配列）。
      前の Workspace の相対位置は、新しい Workspace では別のファイルを指すので、
      並べても意味が無い（shared/ipc/events/lsp.ts）。

      閉じた場合（workspace が null）は送らない ── 受け手も Workspace を
      持たない状態になり、Model ごと捨てている。
    */
    if (workspace === null) {
      return
    }

    emitIpcEvent(IPC_EVENT_CHANNELS.LSP_DIAGNOSTICS_CLEARED, {
      workspaceId: workspace.id,
      relativePaths: []
    })
  })
}
