import type { LspDiagnostic } from '../../lsp/diagnostic'
import type { LanguageServerStatus } from '../../lsp/serverStatus'

/**
 * lsp ドメインの Main → Renderer イベント（Session 5-2 / 5-3 / 5-4）。
 *
 * 要求と応答（contracts/lsp.ts）と対になる、Main の側から一方的に流れる通知。
 *
 * ```
 * lsp:sync-requested       開いている文書を送り直してほしい（5-2）
 * lsp:diagnostics          この文書の指摘は今これ（5-3）
 * lsp:diagnostics-cleared  この文書の指摘はもう有効でない（5-3）
 * lsp:status-changed       サーバの状態が変わった（5-4）
 * ```
 *
 * 4つとも**要求と応答の形にならない**。誰も頼んでいないのに届き、
 * いつ来るとも決まっておらず、返事も要らない（shared/ipc/event.ts）。
 *
 * ## なぜ「開き直してくれ」を Main から頼むのか
 *
 * Language Server は、次の2つの時点で**開いている文書を1つも知らない**状態になる。
 *
 * ```
 * 立ち上がった直後      … 初期化（initialize / initialized）が済むまで通知を受け取れない
 * 落ちて立ち直った直後  … 前のプロセスが持っていた文書は、新しいプロセスには無い
 * ```
 *
 * どちらも「Main は開いている文書の一覧を知っているが、**中身は知らない**」という
 * 同じ状況になる。Main が本文を控えていないのは意図したもので、
 * 正本は Monaco の Model（Renderer）1つに保つため ── 控えると、
 * 差分を当てる処理が Main にもう1つでき、必ずどこかで食い違う。
 *
 * そこで中身を持っている側へ「もう一度開いて」と頼む。届いた Renderer は
 * 今開いている文書を `lsp:did-open` で送り直し、Main は**まだ送っていないものだけ**を
 * サーバへ流す（既に届いている文書の重複した `didOpen` は捨てる。
 * main/lsp/documentSync.ts）。
 */

export interface LspSyncRequestedEvent {
  /**
   * どの Workspace についての依頼か。
   *
   * `files:changed` と同じ理由で載せてある（shared/ipc/events/files.ts）。
   * 切り替えの前後で行き違うため、受け手は自分が今開いている Workspace の id と
   * 突き合わせ、違えば捨てる ── 前の Workspace の相対位置を送り直すと、
   * **新しい Workspace の中の別のファイル**を開いたことになる。
   */
  readonly workspaceId: string
}

/**
 * 1つの文書についての指摘（Session 5-3）。
 *
 * ## URI は載せない
 *
 * サーバが指すのは URI だが、この経路に載るのは **Workspace root からの相対位置**
 * だけになる。URI から相対位置へ落とすのは Main で（main/lsp/documentUri.ts）、
 * **Workspace の外を指す URI はそこで断られ、この経路には現れない。**
 *
 * Renderer が受け取るものだけを見ても、指せるのは今開いている Workspace の中の
 * ファイルに限られる ── 読み書きの経路（§9.3）と同じ線が診断にも引かれている。
 *
 * ## 届いた分で置き換える
 *
 * LSP の `publishDiagnostics` は**その文書の全件**を毎回送る仕様で、
 * 差分ではない。したがって受け手は「足す」のではなく**入れ替える**。
 * 指摘が無くなった文書には空の配列が届く（それが「直った」の伝え方になる）。
 */
export interface LspDiagnosticsEvent {
  /** どの Workspace についての指摘か（`lsp:sync-requested` と同じ理由）。 */
  readonly workspaceId: string
  readonly relativePath: string
  /**
   * この指摘が計算された時点の文書の版。サーバが言わなかった場合は null。
   *
   * Main は**自分が最後に送った版と食い違う指摘を捨てる**ので、ここへ来るのは
   * 「その時点では正しかった」ものだけになる（main/lsp/diagnostics.ts）。
   * それでも載せているのは、受け手が**古い指摘で新しい指摘を上書きしない**ため
   * ── イベントは片道で、届く順序を受け手側で確かめる手段が他に無い。
   */
  readonly version: number | null
  readonly diagnostics: readonly LspDiagnostic[]
}

/**
 * もう有効でなくなった指摘（Session 5-3）。
 *
 * 空の `diagnostics` を送るのとは意味が違う。
 *
 * ```
 * lsp:diagnostics（空）       … サーバが「この文書に問題は無い」と言った
 * lsp:diagnostics-cleared     … サーバがもう答えられない（落ちた・終わった・切り替わった）
 * ```
 *
 * 分けてあるのは、**受け手の次の一手が違う**ため。前者は「問題が無い」状態を
 * 表示し続ければよいが、後者では**Monaco 内蔵の指摘へ戻す**判断が要る
 * （renderer/src/editor/lsp/useDiagnostics.ts）── サーバが答えられない間、
 * 何も出ないままにすると STEP 4 までより悪くなる。
 */
export interface LspDiagnosticsClearedEvent {
  readonly workspaceId: string
  /**
   * 対象の相対位置。**空なら「今持っているものすべて」**。
   *
   * サーバが1本落ちた場合はその担当ぶんだけが並び、Workspace が切り替わった
   * 場合は空になる（どれが残っているかを数え直す意味が無いため）。
   */
  readonly relativePaths: readonly string[]
}

/**
 * サーバの状態が変わった（Session 5-4）。
 *
 * ## 3本ぶんをまとめて送る
 *
 * 変わった1本だけを送る形にしない。受け手が持つのは「今の一覧」だけで足り、
 * **差分を当てる処理を Renderer に作らない**ためにほかならない
 * ── 診断が毎回その文書の全件を送るのと同じ考え方になる。
 *
 * ## `workspaceId` を載せない
 *
 * 他の3つと違い、この通知は Workspace に紐づかない。**サーバの状態は
 * アプリ全体のもの**で、切り替えの前後で行き違っても捨てる理由が無い
 * （切り替えで全部終わるので、届くのは常に「今の状態」になる）。
 *
 * ## 載らないもの
 *
 * 実行ファイル・引数・作業ディレクトリ・pid・終了コード・失敗の中身は
 * 1つも載らない（shared/lsp/serverStatus.ts）。載るのは表の行の名前と、
 * 6つの状態のどれか1つだけになる。
 */
export interface LspStatusChangedEvent {
  /** 3本ぶん（並びは `LANGUAGE_SERVER_IDS`）。 */
  readonly servers: readonly LanguageServerStatus[]
}

export interface LspIpcEventContract {
  'lsp:sync-requested': LspSyncRequestedEvent
  'lsp:diagnostics': LspDiagnosticsEvent
  'lsp:diagnostics-cleared': LspDiagnosticsClearedEvent
  'lsp:status-changed': LspStatusChangedEvent
}
