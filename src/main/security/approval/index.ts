/**
 * Main-side Approval Manager の API（Security Core v1 の STEP6）。
 *
 * FN Agent が副作用のある操作（File Write / Terminal）を求めたときの承認を、
 * **Main が所有して決める**ための層。
 *
 * ```
 * requestApproval(request)              承認を求める（二段階が終わるまで解決しない）
 * respondToApproval(response, window)   Renderer の意思表示を受ける（IPC handler だけが呼ぶ）
 * consumeApproval(id, request)          実行の直前に1回だけ使い切る（STEP7 / STEP8 が呼ぶ）
 * cancelPendingApprovals()              残っている承認をすべて取り消す（STEP9。Agent の停止）
 * APPROVAL_TTL_MS                       有効期限（5 分）
 * ```
 *
 * ## 決めてあること
 *
 * ```
 * 対象       file.write / terminal.run（@shared/security の APPROVAL_ACTION_KINDS）
 * 二段階     Renderer の確認 ＋ Main の Native 確認。Renderer だけでは成立しない
 * 所在       Main の process のメモリだけ。ディスクへ書かない・再起動で消える
 * id         crypto.randomUUID()。**宛先であって Token ではない**
 * binding    action ＋ 対象の綴り / command・args・cwd ＋ 本文の SHA-256
 * 1回きり     consume で失効。取り消し・期限切れ・不一致・失敗もすべて失効
 * 期限       5 分。時刻は Main の時計だけで判断する
 * Audit      approval.requested / approved / denied（安全な要約だけ）
 * ```
 *
 * ## ここに無いもの
 *
 * **承認を飛ばす・自動で承認する・承認を偽装する API は無い。**
 * `forceApprove` / `autoApprove` / `bypassApproval` / `markApproved` /
 * `approveAll` にあたる引数も関数も無く、Renderer が `approved: true` と
 * 名乗れる欄も型に無い（受け取るのは `'continue'` / `'cancel'` の意思表示まで）。
 *
 * **`consumeApproval` は Preload へも IPC へも出さない。** Renderer が承認を
 * 使い切れる口を作ると、実行する側が誰なのかが決められなくなる。
 * 公開する名前は approvalSurface.test.ts が固定している。
 *
 * ## ここが持たないもの
 *
 * 承認した内容の実行（File Write は STEP7、Command Runner は STEP8）と、
 * 変更の内容を見せる画面（Diff UI。STEP7）。External Send（STEP5）は
 * **承認の対象ではない**（DESIGN.md §6.4）。
 */
export { APPROVAL_TTL_MS } from './approvalManager'
export {
  cancelPendingApprovals,
  consumeApproval,
  requestApproval,
  respondToApproval
} from './currentApprovalManager'

export type {
  ApprovalConsumeResult,
  ApprovalDenialReason,
  ApprovalIntent,
  ApprovalOutcome,
  ApprovalRequestNotice
} from './approvalManager'
export type { ApprovalSafeSummary } from './approvalSummary'
export type { RawApprovalRequest } from './approvalAction'
