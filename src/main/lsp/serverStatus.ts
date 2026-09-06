import { IPC_EVENT_CHANNELS } from '@shared/ipc'
import {
  LANGUAGE_SERVER_IDS,
  resolveLanguageServerStatus,
  type LanguageServerStatus
} from '@shared/lsp'
import { emitIpcEvent } from '../ipc/events'
import {
  isLanguageServerAllowed,
  onLanguageServerPreferencesChange
} from './languageServerSettings'
import {
  getLanguageServerRuntimeStatus,
  onLanguageServerRuntimeStatusChange
} from './languageServers'

/**
 * サーバの状態を Renderer へ届ける層（Session 5-4）。
 *
 * ```
 * main/lsp/languageServers.ts        プロセスの状態（既にある事実から導く）
 * main/lsp/languageServerSettings.ts 使ってよいか
 *    ↓  この2つを重ねる
 * ここ                               画面に出す状態にして配る
 *    ↓  lsp:status-changed / lsp:get-status
 * Renderer                           ステータスバーに1つ出す
 * ```
 *
 * 重ね方そのもの（設定で切ってあればプロセスの状態を見ない）は
 * shared/lsp/serverStatus.ts の `resolveLanguageServerStatus` が持つ ──
 * Renderer 側にも同じ判断が要る場面は無いが、**「切ってある」が
 * 他の状態より前に来る**という決めごとを2箇所に書かないためにここへは置かない。
 *
 * ## 出すのは名前と状態だけ
 *
 * ```
 * 出すもの     … typescript / python / csharp と、6つの状態のどれか
 * 出さないもの … 実行ファイル・引数・作業ディレクトリ・pid・終了コード・失敗の中身
 * ```
 *
 * 「立たなかった」ことは伝わるが、何が立たなかったのかは伝わらない
 * （shared/lsp/serverStatus.ts）。詳細は Main のログの持ち物になる。
 *
 * ## まとめて配る
 *
 * 出来事1つにつき1本ではなく、**そのときの3本ぶんをまとめて**送る。
 * 受け手が持つのは「今の一覧」だけで足り、差分を当てる必要が無い
 * （診断の `publishDiagnostics` が毎回全件を送るのと同じ考え方）。
 *
 * 起動直後は状態が続けて動く（立てた → 初期化した → 話せる）。1つずつ送ると
 * その回数だけ Renderer が描き直すので、**同じ tick の中の変化は1本にまとめる**
 * ── まとめた後に読むのはそのときの状態なので、間に何度変わっても結果は変わらない。
 */

/** 今の状態（3本ぶん。並びは `LANGUAGE_SERVER_IDS`）。 */
export function getLanguageServerStatuses(): readonly LanguageServerStatus[] {
  return LANGUAGE_SERVER_IDS.map((serverId) => ({
    serverId,
    status: resolveLanguageServerStatus(
      getLanguageServerRuntimeStatus(serverId),
      isLanguageServerAllowed(serverId)
    )
  }))
}

/** 送る予定があるか（同じ tick の中の変化を1本にまとめる）。 */
let scheduled = false

function scheduleBroadcast(): void {
  if (scheduled) {
    return
  }

  scheduled = true

  queueMicrotask(() => {
    scheduled = false

    emitIpcEvent(IPC_EVENT_CHANNELS.LSP_STATUS_CHANGED, { servers: getLanguageServerStatuses() })
  })
}

/**
 * 状態を配り始める（アプリの起動時に1度だけ）。
 *
 * 購読をここで張るのは、それぞれの出来事に対して何をするかがこの層の判断であるため
 * （startLanguageServerHosting / startLanguageServerDocumentSync と同じ形）。
 *
 * **Workspace の切り替えは購読しない。** 切り替えではサーバが終わり、
 * その終了がプロセスの状態の変化として必ず届く（languageServers.ts）──
 * 別に購読すると、同じ出来事で2度配ることになる。
 */
export function startLanguageServerStatusReporting(): void {
  onLanguageServerRuntimeStatusChange(() => {
    scheduleBroadcast()
  })

  onLanguageServerPreferencesChange(() => {
    scheduleBroadcast()
  })
}
