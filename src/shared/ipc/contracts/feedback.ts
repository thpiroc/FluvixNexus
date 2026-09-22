import type { FeedbackCategoryId, FeedbackDestinationId } from '../../feedback'

/**
 * feedback ドメインの IPC 契約（フィードバックの Notion 保存）。
 *
 * ## 要求に載るのは、利用者が画面で入れた2つだけ
 *
 *   種別 … 閉じた集合（shared/feedback）
 *   詳細 … 前後の空白を落とした本文
 *
 * 送信日時・アプリのバージョン・OS は **Main が付ける。** Renderer から
 * 受け取ると、画面の側が何でも書けてしまう（そして Main の方が正しい値を持っている）。
 *
 * 保存先（Notion の token・Database ID）も要求に欄が無い ── 秘密情報は
 * Main の外へ出さない（main/feedback/feedbackConfig.ts）。
 */
export interface SubmitFeedbackRequest {
  readonly category: FeedbackCategoryId
  readonly detail: string
}

/**
 * 送信の応答。
 *
 * `savedTo` が空なのは**保存先が1つも設定されていない**場合で、失敗ではない
 * （v1 の「受け付けるだけ」と同じ振る舞い）。どこか1つでも保存に失敗した場合は、
 * 応答ではなく IPC の失敗として返る。
 */
export interface SubmitFeedbackResponse {
  readonly savedTo: readonly FeedbackDestinationId[]
}

export interface FeedbackIpcContract {
  'feedback:submit': {
    request: SubmitFeedbackRequest
    response: SubmitFeedbackResponse
  }
}
