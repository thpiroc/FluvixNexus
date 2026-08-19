import { useEffect, useRef, type JSX } from 'react'
import '../unsaved/unsaved.css'
import type { TabCloseRequest } from './useTabCloseGuard'

/**
 * 未保存のタブを閉じる前の確認（1枚ぶん）。
 *
 * 見た目は unsaved/UnsavedChangesDialog と同じものを使う（`unsaved.css` を共有）。
 * 分けてあるのは答える単位が違うためで、揃えているのは
 * **同じ意味の選択肢が同じ見え方をする**ようにするため（useTabCloseGuard.ts）。
 *
 * 初期 focus は「キャンセル」。確認の目的は誤操作を止めることなので、
 * Enter を押した勢いで内容が失われない側を既定にする
 * （files/DeleteConfirm.tsx と同じ判断）。
 */

interface TabCloseConfirmProps {
  readonly request: TabCloseRequest
  readonly busy: boolean
  readonly error: string | null
  readonly onSave: () => void
  readonly onDiscard: () => void
  readonly onCancel: () => void
}

export function TabCloseConfirm({
  request,
  busy,
  error,
  onSave,
  onDiscard,
  onCancel
}: TabCloseConfirmProps): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  return (
    <div
      className="fx-unsaved__backdrop"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          onCancel()
        }
      }}
    >
      <div
        className="fx-unsaved"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fx-tab-close-title"
        data-testid="tab-close-dialog"
      >
        <h2 className="fx-unsaved__title" id="fx-tab-close-title">
          {request.tab.name} の変更を保存しますか？
        </h2>

        <p className="fx-unsaved__body">
          {request.unsavable
            ? 'このファイルはディスク上から削除されています。閉じると編集中の内容は失われます。'
            : '保存しない場合、このファイルの未保存の変更は失われます。'}
        </p>

        <ul className="fx-unsaved__list">
          <li className="fx-unsaved__item" data-unsavable={request.unsavable}>
            <span className="fx-unsaved__item-name">{request.tab.name}</span>
            <span className="fx-unsaved__item-detail">{request.tab.relativePath}</span>
          </li>
        </ul>

        {error !== null && (
          <p className="fx-unsaved__error" data-testid="tab-close-error">
            {error}
          </p>
        )}

        <div className="fx-unsaved__actions">
          <button
            type="button"
            className="fx-unsaved__button"
            ref={cancelRef}
            disabled={busy}
            data-testid="tab-close-cancel"
            onClick={onCancel}
          >
            キャンセル
          </button>

          <button
            type="button"
            className="fx-unsaved__button"
            data-variant="danger"
            disabled={busy}
            data-testid="tab-close-discard"
            onClick={onDiscard}
          >
            保存しない
          </button>

          {/*
            保存できる見込みが無いもの（ディスク上から削除済み）には出さない。
            押せるのに必ず失敗する選択肢は、「保存したのに失われた」と受け取られる。
          */}
          {!request.unsavable && (
            <button
              type="button"
              className="fx-unsaved__button"
              data-variant="primary"
              disabled={busy}
              data-testid="tab-close-save"
              onClick={onSave}
            >
              {busy ? '保存中…' : '保存して閉じる'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
