import type { TextDocumentContentChange } from '../../lsp/document'
import type { LspCompletionRequest, LspCompletionResponse } from '../../lsp/completion'
import type { LspHoverRequest, LspHoverResponse } from '../../lsp/hover'
import type { LanguageServerStatus } from '../../lsp/serverStatus'

export type { LspCompletionRequest, LspCompletionResponse } from '../../lsp/completion'
export type { LspHoverRequest, LspHoverResponse } from '../../lsp/hover'

/**
 * lsp ドメインの IPC 契約（Session 5-2 ── Document Synchronization、5-4 で状態を1本）。
 *
 * ## この契約に無いもの
 *
 * ```
 * 実行ファイル・引数・作業ディレクトリ … 無い（表は main/lsp/languageServerCatalog.ts）
 * 絶対パス・URI                        … 無い（組み立てるのは main/lsp/documentUri.ts）
 * どのサーバへ送るか                   … 無い（決めるのは main/lsp/documentLanguage.ts）
 * 任意の LSP method / params           … 無い（口は5つだけ）
 * サーバを起動 / 停止する口            … 無い（Session 5-4 でも増えていない）
 * ```
 *
 * ## 状態を「読む」口はあるが、「変える」口は無い（Session 5-4）
 *
 * `lsp:get-status` が返すのは名前と状態だけで、**そこから何かを起こすことはできない**。
 * 使うかどうかを変えるのは settings ドメイン（`settings:save-section`）で、
 * その結果としてサーバが止まる / 立つのを決めるのは Main になる
 * （main/lsp/languageServerSettings.ts）── Renderer が
 * 「このサーバを起動して」と言える口は、この Session でも作っていない。
 *
 * Terminal は「表のどの行か」（shellId）までは渡せる形にしたが、こちらはその欄すら無い
 * ── **起動のきっかけは「開いた文書の言語」であって、サーバそのものではない**
 * （DESIGN.md の STEP 5 引き継ぎ）。Renderer が言えるのは
 * 「この相対位置のファイルを開いた / 変えた / 保存した / 閉じた」までに留まる。
 *
 * したがって、この4つの口が増えても
 * 「Renderer からの要求で任意の実行ファイルが動く」形は作られない。
 *
 * ## 相対位置は Workspace の中だけ
 *
 * どの要求も受け取るのは `relativePath` 1つで、基点は Main が持つ現在の Workspace になる
 * （Files ドメインと同じ線）。`..`・絶対パス・ドライブ相対は Main が断り
 * （main/files/workspacePath.ts）、Workspace の外を指す相対位置は
 * URI へ落ちる前に PERMISSION_DENIED になる。
 *
 * ## 版番号は「未保存かどうか」ではない
 *
 * `version` は Monaco の Model が持つ版（`getVersionId()`）で、編集のたびに増える。
 * 未保存の判定に使う `getAlternativeVersionId()` は Undo で戻るため、
 * **この欄には渡らない**（戻る数を LSP の版として送ると、サーバは
 * 「古い版が後から来た」として以降の変更を捨てる）。
 * `lsp:did-save` に版の欄が無いのも同じ理由で、保存は版を動かさない。
 *
 * ## 送りっぱなしにしない
 *
 * 4つとも応答を待つ形（invoke）にしてある。`lsp:did-open` だけは
 * 応答に意味があり（この文書をサーバが見るかどうか）、残り3つは void を返す。
 * それでも invoke にしているのは、**到着の順序が保たれる**ため ──
 * Main 側のハンドラは同期で電文を書き出すので、
 * `didOpen` → `didChange` の順に送ったものが入れ替わることはない。
 */

export interface OpenLspDocumentRequest {
  /** Workspace root からの相対位置。 */
  readonly relativePath: string
  /** 開いた時点の Model の版。 */
  readonly version: number
  /** 開いた時点の全文。 */
  readonly content: string
}

export interface OpenLspDocumentResponse {
  /**
   * この文書を Language Server が見ているか。
   *
   * false になるのは、その拡張子に対応するサーバが表に無い（`.md` / `.txt`）、
   * この PC に入っていない、Workspace が開かれていない、のいずれか。
   * 受け取った側は**以降の通知を送らなくてよい**
   * ── 送っても Main が捨てるだけなので、往復を省くための答えになる。
   *
   * `true` は「サーバへ届いた」ではなく「見る対象である」を意味する。
   * 起動や初期化が終わっていない間の通知は Main が保留し、
   * 準備ができた時点で `lsp:sync-requested` で開き直しを求める
   * （shared/ipc/events/lsp.ts）。
   */
  readonly tracked: boolean
}

export interface ChangeLspDocumentRequest {
  readonly relativePath: string
  /** 変更を適用した**後**の版。 */
  readonly version: number
  /**
   * 変更の並び（前から順に適用する形）。
   *
   * 差分で表せない編集（改行コードの変更・全置換）は、範囲を持たない1件になる
   * （shared/lsp/document.ts）。
   */
  readonly changes: readonly TextDocumentContentChange[]
}

export interface SaveLspDocumentRequest {
  readonly relativePath: string
}

export interface CloseLspDocumentRequest {
  readonly relativePath: string
}

/**
 * サーバの状態（Session 5-4）。
 *
 * 画面が開いた時点の状態を1度読むためのもので、以降は
 * `lsp:status-changed` が届く（shared/ipc/events/lsp.ts）。
 * **要求と応答の口も持つ**のは、イベントが「変わったときだけ」流れるため
 * ── 何も変わらないまま画面が開いた場合、購読だけでは何も出せない
 * （`workspace-folder:get-current` と同じ形）。
 */
export interface LspStatusResponse {
  /** 3本ぶん（並びは `LANGUAGE_SERVER_IDS`）。 */
  readonly servers: readonly LanguageServerStatus[]
}

export interface LspIpcContract {
  'lsp:did-open': {
    request: OpenLspDocumentRequest
    response: OpenLspDocumentResponse
  }
  'lsp:did-change': {
    request: ChangeLspDocumentRequest
    response: void
  }
  'lsp:did-save': {
    request: SaveLspDocumentRequest
    response: void
  }
  'lsp:did-close': {
    request: CloseLspDocumentRequest
    response: void
  }
  'lsp:completion': {
    request: LspCompletionRequest
    response: LspCompletionResponse
  }
  'lsp:hover': {
    request: LspHoverRequest
    response: LspHoverResponse
  }
  'lsp:get-status': {
    request: void
    response: LspStatusResponse
  }
}
