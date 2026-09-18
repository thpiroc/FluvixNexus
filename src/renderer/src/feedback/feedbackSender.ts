import type { FeedbackSubmission } from './feedbackForm'

/**
 * フィードバックの送り先（フィードバック機能 v1）。
 *
 * 画面（FeedbackOverlay.tsx）はこの形しか知らない。送り先を足すときは
 * この interface を満たすものを作って画面へ渡すだけでよく、画面・検証
 * （feedbackForm.ts）には触らずに済む。
 *
 * 将来 Main を経由して外へ出す場合も、ここで `window.fluvix` の IPC を呼ぶ
 * 実装を1つ足す形になる（Renderer から直接ネットワークへは出さない）。
 */
export interface FeedbackSender {
  send(submission: FeedbackSubmission): Promise<FeedbackSendResult>
}

export type FeedbackSendResult = { readonly ok: true } | { readonly ok: false }

/**
 * v1 の送り先: **受け付けるだけ**。
 *
 * どこへも送らず、保存もしない（外部サービス・ファイル・ログのいずれにも書かない）。
 * 画面が「受け付けました」を出すための成功を返すだけの仮の実装。
 */
export const localFeedbackSender: FeedbackSender = {
  send: async () => ({ ok: true })
}
