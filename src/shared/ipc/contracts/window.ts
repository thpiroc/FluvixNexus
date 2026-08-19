/**
 * window ドメインの IPC 契約（ウィンドウを閉じてよいかの確認）。
 *
 * ## なぜ Main から尋ねる形なのか
 *
 * 「未保存の変更があるか」を知っているのは Renderer（Monaco の Model を持つ側）だけで、
 * 「ウィンドウを閉じるか / アプリを終了するか」を決めるのは Main だけ
 * （ARCHITECTURE.md §1 の責務表）。どちらか一方に寄せると、
 *
 *   Main が持つ  … Renderer が編集のたびに Main へ dirty を送り続けることになる
 *                  （常に往復し、しかも一瞬ずれる）
 *   Renderer が決める … 閉じる操作（× / Alt+F4 / app.quit）を Renderer は捕まえられない
 *
 * となる。そこで**閉じる操作を Main が握ったまま、判断だけを Renderer へ尋ねる**。
 *
 * ```
 * ウィンドウの × / アプリ終了
 *    ↓  Main が close を止める（preventDefault）
 * window:close-requested（イベント。events/window.ts）
 *    ↓  Renderer が未保存を確認して利用者に尋ねる
 * window:respond-close（この契約）
 *    ↓  allow なら Main が改めて閉じる
 * ```
 *
 * ## 応答が返らない場合
 *
 * Renderer が応答できない状態（読み込み前・スクリプトが止まっている）でも
 * **閉じられなくなってはいけない。** Main 側に時間の上限を置き、
 * 過ぎたら閉じる（main/windows/closeGuard.ts）。閉じられないアプリの方が、
 * 未保存を1回取りこぼすより悪い。
 *
 * その上限は「利用者が選ぶ時間」ではなく「**Renderer が受け取ったと言うまで**」の
 * 上限であることが要点で、そのために `decision` に `'deciding'` がある。
 * 尋ねている最中に上限で閉じてしまうと、確認を出した意味が無い。
 *
 * OS のシャットダウン・強制終了・プロセスのクラッシュでは、この経路自体が
 * 走らないことがある（docs/ARCHITECTURE.md §12.7）。
 */

/**
 * 閉じてよいかの返事。
 *
 * | 値          | 意味                                                   | Main の動き            |
 * | ----------- | ------------------------------------------------------ | ---------------------- |
 * | `deciding`  | 受け取った。これから利用者に尋ねる                     | 時間の上限を解除して待つ |
 * | `allow`     | 閉じてよい（未保存が無い / 保存した / 破棄を選んだ）   | 改めて閉じる           |
 * | `cancel`    | 閉じない（利用者が取り消した）                         | 何もしない             |
 */
export type WindowCloseDecision = 'deciding' | 'allow' | 'cancel'

export interface RespondWindowCloseRequest {
  /**
   * どの確認に対する応答か。
   *
   * 「前回の確認への遅れた応答」で今のウィンドウが閉じてしまわないようにする。
   * 発番するのは Main で、Renderer は受け取った値をそのまま返すだけ。
   */
  readonly requestId: string
  readonly decision: WindowCloseDecision
}

export interface WindowIpcContract {
  'window:respond-close': {
    request: RespondWindowCloseRequest
    response: void
  }
}
