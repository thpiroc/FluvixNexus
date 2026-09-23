import type { ApprovalActionKind } from '../../security/approvalAction'

/**
 * approval ドメインの IPC 契約（FN Agent の操作の承認。Security Core v1 の STEP6）。
 *
 * ## Renderer は承認できない
 *
 * この契約で Renderer が送れるのは、**「Main が出したこの確認について、利用者が
 * 続行を選んだ」という意思表示だけ**にあたる。`approved: true` を送れば承認に
 * なる欄は型にも無い。続行が届いた後、Main は自分で Native の確認を出し、
 * **そちらの結果で承認を決める**（main/security/approval/）。
 *
 * ```
 * Agent が副作用のある操作を求める
 *    ↓  Main が Policy（STEP1）で ask と判定し、承認を作る
 * approval:requested（イベント。events/approval.ts）    安全な要約だけが載る
 *    ↓  Renderer が利用者へ見せる（第1段階）
 * approval:respond（この契約）                          continue / cancel の意思表示
 *    ↓  Main が Native の確認を出す（第2段階）
 * Main が承認を確定し、後続の Gate が1回だけ使い切る
 * ```
 *
 * window ドメイン（contracts/window.ts）と形が似ているのは偶然ではない ──
 * どちらも**決めるのは Main、見せて尋ねるのは Renderer**という同じ分担にあたる。
 * 違うのは、あちらが「閉じてよいか」を Renderer の判断に委ねているのに対し、
 * こちらは**Renderer の判断を最終にしない**ところで、そのために第2段階がある。
 *
 * ## 承認を使う口はここに無い
 *
 * 承認を実際に使い切る（consume）のは Main の内部だけで、そのチャンネルは作らない。
 * Renderer から承認を使えると、承認した操作を誰が実行するかを Main が決められなくなる。
 */

/**
 * 利用者の意思表示。
 *
 * | 値         | 意味                                     | Main の動き                     |
 * | ---------- | ---------------------------------------- | ------------------------------- |
 * | `continue` | 内容を見た上で先へ進めたい               | Native の確認を出す（第2段階）  |
 * | `cancel`   | やめる                                   | その承認を失効させる            |
 *
 * **`continue` は「承認した」ではない。** 承認になるのは Native の確認を通った後で、
 * 取り消し・× で閉じる・期限切れ・ウィンドウの消失はすべて拒否にあたる。
 */
export type ApprovalIntent = 'continue' | 'cancel'

export interface RespondApprovalRequest {
  /**
   * どの確認に対する意思表示か。
   *
   * 発番するのは Main（予測困難な値）で、Renderer は受け取った値をそのまま返す。
   * Main が出していない id・すでに片付いた id は、**他の承認に一切触れずに**捨てられる。
   */
  readonly approvalId: string
  /**
   * その確認の操作の種類。
   *
   * Renderer が受け取ったものをそのまま返す欄で、**Main はこれを信用しない。**
   * 控えてある種類と違えば、その承認は失効する（生きている確認へ別の操作として
   * 続行を送ってきたことにあたるため）。
   */
  readonly actionKind: ApprovalActionKind
  readonly intent: ApprovalIntent
}

export interface ApprovalIpcContract {
  'approval:respond': {
    request: RespondApprovalRequest
    response: void
  }
}
