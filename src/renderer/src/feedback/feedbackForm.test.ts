import { describe, expect, it } from 'vitest'
import {
  EMPTY_FEEDBACK_DRAFT,
  FEEDBACK_CATEGORY_IDS,
  isFeedbackCategoryId,
  validateFeedbackDraft
} from './feedbackForm'

describe('feedbackForm', () => {
  it('種別は5つで、画面に並ぶ順に持つ', () => {
    expect(FEEDBACK_CATEGORY_IDS).toEqual(['bug', 'bad', 'good', 'safety', 'other'])
  })

  it('既知の種別だけを種別として扱う', () => {
    for (const category of FEEDBACK_CATEGORY_IDS) {
      expect(isFeedbackCategoryId(category)).toBe(true)
    }

    expect(isFeedbackCategoryId('feature')).toBe(false)
    expect(isFeedbackCategoryId(null)).toBe(false)
    expect(isFeedbackCategoryId(1)).toBe(false)
  })

  it('空の下書きは種別と詳細の両方が問題になる', () => {
    expect(validateFeedbackDraft(EMPTY_FEEDBACK_DRAFT)).toEqual({
      ok: false,
      errors: { category: 'required', detail: 'empty' }
    })
  })

  it('種別が未選択なら送れない', () => {
    expect(validateFeedbackDraft({ category: null, detail: '落ちました' })).toEqual({
      ok: false,
      errors: { category: 'required' }
    })
  })

  it('詳細が空なら送れない', () => {
    expect(validateFeedbackDraft({ category: 'bug', detail: '' })).toEqual({
      ok: false,
      errors: { detail: 'empty' }
    })
  })

  it('空白・改行・全角空白だけの詳細は送れない', () => {
    for (const detail of [' ', '   ', '\n\n', '\t \r\n', '　　']) {
      expect(validateFeedbackDraft({ category: 'good', detail })).toEqual({
        ok: false,
        errors: { detail: 'blank' }
      })
    }
  })

  it('知らない種別は未選択として扱う', () => {
    const draft = { category: 'feature', detail: 'x' } as unknown as Parameters<
      typeof validateFeedbackDraft
    >[0]

    expect(validateFeedbackDraft(draft)).toEqual({ ok: false, errors: { category: 'required' } })
  })

  it('正しい入力は前後の空白だけを落として送信の形にする', () => {
    expect(
      validateFeedbackDraft({ category: 'safety', detail: '\n  1行目\n\n  2行目  \n' })
    ).toEqual({
      ok: true,
      submission: { category: 'safety', detail: '1行目\n\n  2行目' }
    })
  })

  it('長い詳細もそのまま送信の形になる', () => {
    const detail = 'あ'.repeat(20_000)

    expect(validateFeedbackDraft({ category: 'other', detail })).toEqual({
      ok: true,
      submission: { category: 'other', detail }
    })
  })
})
