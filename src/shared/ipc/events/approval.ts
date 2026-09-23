import type { ApprovalActionKind } from '../../security/approvalAction'

/**
 * approval ドメインの Main → Renderer イベント（Security Core v1 の STEP6）。
 *
 * 経緯と流れは contracts/approval.ts の冒頭にある。
 *
 * ## 載るのは安全な要約だけ
 *
 * 書き込む本文・Diff 本文・コマンドの出力・絶対パス・Secret は**型にも無い。**
 * `commandSummary` は Main 側で STEP3 の Mask を通した後の1行にあたる
 * （main/security/approval/approvalSummary.ts）。変更の内容そのものを見せる画面
 * （Diff UI）は STEP7 で、そのときも本文は Renderer が別の経路で読む形にする。
 */

export interface ApprovalRequestedEvent {
  /** この確認の識別子。Renderer は `approval:respond` にそのまま返す。 */
  readonly approvalId: string
  readonly actionKind: ApprovalActionKind
  /** 短い対象名（File Write は Workspace 相対 Path、Terminal はコマンド名）。 */
  readonly subject: string
  /** Workspace 相対の位置（Terminal は `cwd`。root は `null`）。 */
  readonly workspacePath: string | null
  /** Mask 済みのコマンドの1行（File Write は `null`）。 */
  readonly commandSummary: string | null
  /**
   * 期限（Main の時計の epoch ミリ秒）。
   *
   * **残り時間の表示のためだけの値にあたる。** 期限が来たかどうかを決めるのは
   * 常に Main で、Renderer が「まだ期限内だ」と名乗る経路は無い。
   */
  readonly expiresAt: number
}

export interface ApprovalIpcEventContract {
  'approval:requested': ApprovalRequestedEvent
}
