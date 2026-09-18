import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react'
import { useI18n } from '../i18n/context'
import type { TranslationKey } from '../i18n/messages'
import {
  EMPTY_FEEDBACK_DRAFT,
  FEEDBACK_CATEGORY_IDS,
  validateFeedbackDraft,
  type FeedbackCategoryId,
  type FeedbackDraft,
  type FeedbackDraftErrors
} from './feedbackForm'
import { localFeedbackSender, type FeedbackSender } from './feedbackSender'
import './feedback.css'

interface FeedbackOverlayProps {
  /**
   * 入力途中の内容。**持ち主は Shell**（WorkspaceShell.tsx）。
   *
   * 面の中に持つと、Esc や × で閉じた瞬間に長く書いた詳細が消える。
   * 閉じても開き直せば続きから書ける ── 捨てるのは送信できたときだけ。
   */
  readonly draft: FeedbackDraft
  readonly onDraftChange: (draft: FeedbackDraft) => void
  readonly onClose: () => void
  /** 送り先。省略時は v1 の「受け付けるだけ」（feedbackSender.ts）。 */
  readonly sender?: FeedbackSender
}

/** 最後の送信の結果。次に入力を変えるまで出しておく。 */
type SubmitOutcome = 'none' | 'accepted' | 'failed'

/**
 * フィードバックを書く面（フィードバック機能 v1）。
 *
 * Settings と同じく**窓いっぱいに重ねる面**にしてある（settings/SettingsOverlay.tsx）
 * ── どのパネルのものでもなく、パネルを閉じた人からも入口が消えない。
 * 見た目の組み立て（上に細いバー・その下に読む幅を絞った本体）も Settings に揃えた。
 *
 * ## この面が持つもの / 持たないもの
 *
 *   持つ    … 検証の結果を出すか、送信中か、最後の送信の結果（どれも表示のための状態）
 *   持たない … 何が送れる入力か（feedbackForm.ts）・どこへ送るか（feedbackSender.ts）
 *
 * ## 検証の結果は、送信を1度押してから出す
 *
 * 開いた瞬間から「未選択です」「空です」を並べると、まだ何もしていない人を
 * 責めることになる。1度押した後は入力に合わせてその場で消える。
 */
export function FeedbackOverlay({
  draft,
  onDraftChange,
  onClose,
  sender = localFeedbackSender
}: FeedbackOverlayProps): JSX.Element {
  const { t } = useI18n()
  const idPrefix = useId()
  const categoryErrorId = `${idPrefix}-category-error`
  const detailErrorId = `${idPrefix}-detail-error`

  const [attempted, setAttempted] = useState(false)
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<SubmitOutcome>('none')

  const categoryGroupRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLTextAreaElement>(null)

  // 送信中に閉じられた後で state を触らない。
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  const errors: FeedbackDraftErrors = attempted
    ? (() => {
        const result = validateFeedbackDraft(draft)

        return result.ok ? {} : result.errors
      })()
    : {}

  /*
    Esc で閉じる（Settings と同じ打鍵）。

    **日本語入力の変換中は閉じない。** 変換中の Esc は「変換をやめる」で、
    そこで面ごと閉じると書いていた文を失ったように見える（下書きは Shell に
    残るが、利用者は閉じるつもりで押していない）。
  */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) {
        return
      }

      event.preventDefault()
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const updateDraft = (next: FeedbackDraft): void => {
    setOutcome('none')
    onDraftChange(next)
  }

  const selectCategory = (category: FeedbackCategoryId): void => {
    updateDraft({ ...draft, category })
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    if (sending) {
      return
    }

    const result = validateFeedbackDraft(draft)

    if (!result.ok) {
      setAttempted(true)
      setOutcome('none')

      // 最初に直すべき場所へ focus を移す（上から順に）。
      if (result.errors.category !== undefined) {
        categoryGroupRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
      } else {
        detailRef.current?.focus()
      }

      return
    }

    setSending(true)
    setOutcome('none')

    let accepted = false

    try {
      accepted = (await sender.send(result.submission)).ok
    } catch {
      accepted = false
    }

    if (!mountedRef.current) {
      return
    }

    setSending(false)

    if (!accepted) {
      // 送れなかった入力は消さない（書き直させない）。
      setOutcome('failed')
      return
    }

    setAttempted(false)
    setOutcome('accepted')
    onDraftChange(EMPTY_FEEDBACK_DRAFT)
  }

  return (
    <div
      className="fx-feedback"
      data-testid="feedback"
      role="dialog"
      aria-modal="false"
      aria-label={t('feedback.title')}
    >
      <div className="fx-feedback__bar">
        <span className="fx-feedback__title">{t('feedback.title')}</span>
        <button
          type="button"
          className="fx-feedback__close"
          data-testid="feedback-close"
          onClick={onClose}
          title={t('feedback.closeTitle')}
          aria-label={t('feedback.closeLabel')}
        >
          ×
        </button>
      </div>

      <div className="fx-feedback__body">
        <form className="fx-feedback__form" noValidate onSubmit={(event) => void submit(event)}>
          <div className="fx-feedback__heading">
            <h2 className="fx-feedback__heading-title">{t('feedback.title')}</h2>
            <p className="fx-feedback__heading-note">{t('feedback.description')}</p>
          </div>

          <section className="fx-feedback__field">
            <span className="fx-feedback__label" id={`${idPrefix}-category-label`}>
              {t('feedback.categoryLabel')}
            </span>
            <div
              ref={categoryGroupRef}
              className="fx-feedback__categories"
              role="radiogroup"
              aria-labelledby={`${idPrefix}-category-label`}
              aria-invalid={errors.category !== undefined}
              aria-describedby={errors.category !== undefined ? categoryErrorId : undefined}
              data-testid="feedback-category"
            >
              {FEEDBACK_CATEGORY_IDS.map((category) => (
                <button
                  key={category}
                  type="button"
                  role="radio"
                  className="fx-feedback__category"
                  data-testid={`feedback-category-${category}`}
                  data-active={category === draft.category}
                  aria-checked={category === draft.category}
                  disabled={sending}
                  onClick={() => selectCategory(category)}
                >
                  {t(categoryLabelKey(category))}
                </button>
              ))}
            </div>
            {errors.category !== undefined && (
              <p
                className="fx-feedback__error"
                id={categoryErrorId}
                role="alert"
                data-testid="feedback-category-error"
              >
                {t('feedback.errors.categoryRequired')}
              </p>
            )}
          </section>

          <section className="fx-feedback__field">
            <label className="fx-feedback__label" htmlFor={`${idPrefix}-detail`}>
              {t('feedback.detailLabel')}
            </label>
            <textarea
              ref={detailRef}
              id={`${idPrefix}-detail`}
              className="fx-feedback__detail"
              data-testid="feedback-detail"
              rows={12}
              value={draft.detail}
              placeholder={t('feedback.detailPlaceholder')}
              aria-invalid={errors.detail !== undefined}
              aria-describedby={errors.detail !== undefined ? detailErrorId : undefined}
              readOnly={sending}
              spellCheck={false}
              onChange={(event) => updateDraft({ ...draft, detail: event.target.value })}
            />
            {errors.detail !== undefined && (
              <p
                className="fx-feedback__error"
                id={detailErrorId}
                role="alert"
                data-testid="feedback-detail-error"
              >
                {t(
                  errors.detail === 'blank'
                    ? 'feedback.errors.detailBlank'
                    : 'feedback.errors.detailEmpty'
                )}
              </p>
            )}
          </section>

          <div className="fx-feedback__actions">
            <button
              type="submit"
              className="fx-feedback__submit"
              data-testid="feedback-submit"
              disabled={sending}
            >
              {t(sending ? 'feedback.sending' : 'feedback.submit')}
            </button>

            {/*
              結果は aria-live の領域に出す。受け付けた直後は入力が空に戻るので、
              「消えた」ではなく「受け付けた」ことが読めるようにしておく。
            */}
            <p
              className="fx-feedback__status"
              role="status"
              data-testid="feedback-status"
              data-outcome={outcome}
            >
              {outcome === 'accepted' && t('feedback.accepted')}
              {outcome === 'failed' && t('feedback.failed')}
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}

function categoryLabelKey(category: FeedbackCategoryId): TranslationKey {
  return `feedback.categories.${category}`
}
