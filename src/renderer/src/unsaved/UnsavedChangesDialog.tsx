import { useEffect, useRef, type JSX } from 'react'
import { useI18n } from '../i18n/context'
import { describeLossNote, describeLossPrompt } from './lossMessage'
import type { LossAction, LossChoice, LossItem, UnsavedSaveFailure } from './types'
import './unsaved.css'

/**
 * 失われるものがある直前に出す確認。
 *
 * files/DeleteConfirm.tsx と同じ作りのアプリ内モーダル。ネイティブの
 * `dialog.showMessageBox` を使わないのは、
 *   - Main が Renderer の事情（何が未保存か・何が動いているか）を知る必要が出る
 *   - 見た目がアプリから浮く
 *   - 自動確認から操作できない
 * ため。
 *
 * ## 3つの選択肢
 *
 * | 選択       | 何が起きるか                                     |
 * | ---------- | ------------------------------------------------ |
 * | 保存       | 保存してから続ける。**保存できなければ続けない** |
 * | 保存しない | 失われることを承知で続ける                       |
 * | キャンセル | 何もしない                                       |
 *
 * ## 文面は種別で変わる（Session 3-7-4）
 *
 * この確認が扱うものは2種類ある（未保存の変更と、実行中のターミナル）。
 * 何をしようとしていて何が失われるかの組み立ては lossMessage.ts に置き、
 * ここはその結果を描くだけにしてある ── **同じ器で違うことを言う**以上、
 * 文面の判断は JSX の中に散らさずテストで固定できる場所に置く。
 *
 * ## 既定は「キャンセル」
 *
 * 初期 focus をキャンセルに置く（DeleteConfirm.tsx と同じ）。確認の目的は
 * 誤操作を止めることなので、Enter を押した勢いで失われない側を既定にする。
 *
 * 保存で救えるものが1つも無い場合（ディスクから消えたファイル・実行中の
 * ターミナル）は「保存」を並べない。**押せるのに救えない選択肢**を出すと、
 * 利用者は「保存したのに失われた」と受け取る。
 */

interface UnsavedChangesDialogProps {
  readonly action: LossAction
  readonly items: readonly LossItem[]
  readonly busy: boolean
  readonly error: UnsavedSaveFailure | null
  readonly onChoose: (choice: LossChoice) => void
}

export function UnsavedChangesDialog({
  action,
  items,
  busy,
  error,
  onChoose
}: UnsavedChangesDialogProps): JSX.Element {
  const { t } = useI18n()
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  const { title, body, discardLabel, canSave } = describeLossPrompt(action, items, t)

  return (
    <div
      className="fx-unsaved__backdrop"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          onChoose('cancel')
        }
      }}
    >
      <div
        className="fx-unsaved"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fx-unsaved-title"
        data-testid="unsaved-dialog"
        data-kind={action}
      >
        <h2 className="fx-unsaved__title" id="fx-unsaved-title">
          {title}
        </h2>

        <p className="fx-unsaved__body">{body}</p>

        <ul className="fx-unsaved__list" data-testid="unsaved-list">
          {items.map((item) => {
            const note = describeLossNote(item, t)

            return (
              <li
                key={`${item.kind}:${item.id}`}
                className="fx-unsaved__item"
                data-kind={item.kind}
                data-unsavable={item.unsavable}
              >
                <span className="fx-unsaved__item-name">{item.name}</span>
                <span className="fx-unsaved__item-detail">{item.detail}</span>
                {/* 保存で救えないものは、その理由を並びの中で伝える。 */}
                {note !== null && <span className="fx-unsaved__item-note">{note}</span>}
              </li>
            )
          })}
        </ul>

        {error !== null && (
          <p className="fx-unsaved__error" data-testid="unsaved-error">
            {t('unsaved.saveFailed')}
          </p>
        )}

        <div className="fx-unsaved__actions">
          <button
            type="button"
            className="fx-unsaved__button"
            ref={cancelRef}
            disabled={busy}
            data-testid="unsaved-cancel"
            onClick={() => onChoose('cancel')}
          >
            {t('common.actions.cancel')}
          </button>

          <button
            type="button"
            className="fx-unsaved__button"
            data-variant="danger"
            disabled={busy}
            data-testid="unsaved-discard"
            onClick={() => onChoose('discard')}
          >
            {discardLabel}
          </button>

          {canSave && (
            <button
              type="button"
              className="fx-unsaved__button"
              data-variant="primary"
              disabled={busy}
              data-testid="unsaved-save"
              onClick={() => onChoose('save')}
            >
              {busy ? t('unsaved.saving') : t('unsaved.saveAll')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
