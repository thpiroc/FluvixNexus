/**
 * フィードバックの入力と、その検証（フィードバック機能 v1）。
 *
 * React にも送り先にも依存しない ── 画面（FeedbackOverlay.tsx）は
 * ここで決めた「何を選べるか」「何なら送れるか」を並べるだけで、
 * 送り先（feedbackSender.ts）はここを通った `FeedbackSubmission` だけを受け取る。
 *
 * 分けてあるのは、送り先が将来変わっても（GitHub Issue・メールなど）
 * **何が送れる入力か**の判断を画面と送り先の両方に書かずに済むようにするため。
 */

import { FEEDBACK_CATEGORY_IDS, type FeedbackCategoryId } from '@shared/feedback'

/**
 * 選べる種別。並びがそのまま画面の並びになる。
 * 保存する側（Main）も同じ並びを見るため、定義は shared/feedback に置いてある。
 */
export { FEEDBACK_CATEGORY_IDS, type FeedbackCategoryId }

/** 入力途中の状態。種別は未選択（`null`）から始まる。 */
export interface FeedbackDraft {
  readonly category: FeedbackCategoryId | null
  readonly detail: string
}

export const EMPTY_FEEDBACK_DRAFT: FeedbackDraft = { category: null, detail: '' }

/** 検証を通った、送り先へ渡す形。 */
export interface FeedbackSubmission {
  readonly category: FeedbackCategoryId
  /** 前後の空白を落とした詳細（中の改行・空白はそのまま）。 */
  readonly detail: string
}

/**
 * 入力の問題。
 *
 * 詳細の「空」と「空白だけ」を分けてあるのは、利用者から見て直し方が違うため
 * ── 空白だけの人は「書いたつもり」になっていることがある。
 */
export interface FeedbackDraftErrors {
  readonly category?: 'required'
  readonly detail?: 'empty' | 'blank'
}

export type FeedbackValidation =
  | { readonly ok: true; readonly submission: FeedbackSubmission }
  | { readonly ok: false; readonly errors: FeedbackDraftErrors }

export function isFeedbackCategoryId(value: unknown): value is FeedbackCategoryId {
  return typeof value === 'string' && (FEEDBACK_CATEGORY_IDS as readonly string[]).includes(value)
}

export function validateFeedbackDraft(draft: FeedbackDraft): FeedbackValidation {
  const category = isFeedbackCategoryId(draft.category) ? draft.category : null
  const detail = draft.detail.trim()

  const errors: { category?: 'required'; detail?: 'empty' | 'blank' } = {}

  if (category === null) {
    errors.category = 'required'
  }

  if (draft.detail.length === 0) {
    errors.detail = 'empty'
  } else if (detail.length === 0) {
    errors.detail = 'blank'
  }

  if (category === null || errors.detail !== undefined) {
    return { ok: false, errors }
  }

  return { ok: true, submission: { category, detail } }
}
