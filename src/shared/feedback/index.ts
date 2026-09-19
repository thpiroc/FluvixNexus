/**
 * フィードバックの契約レイヤー（フィードバック機能 v1 → Notion 保存）。
 *
 * 種別の並びは、画面（renderer/src/feedback/feedbackForm.ts）と
 * 保存する側（main/feedback/）の**両方が同じものを見る**必要がある ──
 * 片方だけに種別を足すと、画面では選べるのに Main が弾く、が生まれる。
 * そのためここに1つだけ置き、画面側は再 export して使う。
 */

/** 選べる種別。並びがそのまま画面の並びになる。 */
export const FEEDBACK_CATEGORY_IDS = ['bug', 'bad', 'good', 'safety', 'other'] as const

export type FeedbackCategoryId = (typeof FEEDBACK_CATEGORY_IDS)[number]

/**
 * Main が受け付ける詳細の長さの上限（文字数）。
 *
 * 画面は上限を設けていない（v1 のまま）。ここは**境界の外から来た値**に対する
 * 保険で、手で書く文章が届かない大きさにしてある。
 */
export const FEEDBACK_DETAIL_MAX_LENGTH = 100_000

/** 保存先の識別子。保存先を足すときはここに1つ足す（例: 'google-drive'）。 */
export type FeedbackDestinationId = 'notion'
