import { fluvix } from '../api/fluvix'
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

/**
 * Main を経由して、設定済みの保存先（Notion など）へ送る。
 *
 * どこへ送るか・秘密情報は Main が持ち（main/feedback/）、ここは種別と詳細を
 * 渡すだけ。保存先が設定されていなければ Main は何もせず成功を返す
 * ── 画面から見た振る舞いは `localFeedbackSender` と同じになる。
 */
export const ipcFeedbackSender: FeedbackSender = {
  send: async (submission) => {
    const result = await fluvix.feedback.submit({
      category: submission.category,
      detail: submission.detail
    })

    return result.ok ? { ok: true } : { ok: false }
  }
}
