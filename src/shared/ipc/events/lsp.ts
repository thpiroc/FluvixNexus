/**
 * lsp ドメインの Main → Renderer イベント（Session 5-2）。
 *
 * 要求と応答（contracts/lsp.ts）と対になる、Main の側から一方的に流れる通知。
 * Session 5-2 で載せるのは1つだけで、**診断（`textDocument/publishDiagnostics`）は
 * ここにまだ無い**（Session 5-3）。
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

export interface LspIpcEventContract {
  'lsp:sync-requested': LspSyncRequestedEvent
}
