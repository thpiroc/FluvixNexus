import { useEffect, useRef, type JSX } from 'react'
import type { UnsavedActionKind, UnsavedChoice, UnsavedItem } from './types'
import './unsaved.css'

/**
 * 未保存の内容を失う直前に出す確認。
 *
 * files/DeleteConfirm.tsx と同じ作りのアプリ内モーダル。ネイティブの
 * `dialog.showMessageBox` を使わないのは、
 *   - Main が Renderer の事情（何が未保存か）を知る必要が出る
 *   - 見た目がアプリから浮く
 *   - 自動確認から操作できない
 * ため。
 *
 * ## 3つの選択肢
 *
 * | 選択     | 何が起きるか                                             |
 * | -------- | -------------------------------------------------------- |
 * | 保存     | 保存してから続ける。**保存できなければ続けない**         |
 * | 保存しない | 未保存の内容を捨てて続ける                              |
 * | キャンセル | 何もしない                                              |
 *
 * ## 既定は「キャンセル」
 *
 * 初期 focus をキャンセルに置く（DeleteConfirm.tsx と同じ）。確認の目的は
 * 誤操作を止めることなので、Enter を押した勢いで内容が失われない側を既定にする。
 *
 * 保存できる見込みが無いもの（ディスクから消えたファイル）しか無い場合は、
 * 「保存」を並べない。**押せるのに必ず失敗する選択肢**を出すと、
 * 利用者は「保存したのに失われた」と受け取る。
 */

interface UnsavedChangesDialogProps {
  readonly kind: UnsavedActionKind
  readonly items: readonly UnsavedItem[]
  readonly busy: boolean
  readonly error: string | null
  readonly onChoose: (choice: UnsavedChoice) => void
}

/** 何をしようとしているかで文面を変える（「何が起きるか」を先に伝える）。 */
function describeAction(kind: UnsavedActionKind): string {
  switch (kind) {
    case 'close-workspace':
      return 'Workspace を閉じると、次のファイルの未保存の変更が失われます。'

    case 'switch-workspace':
      return '別の Workspace へ切り替えると、次のファイルの未保存の変更が失われます。'

    case 'close-window':
      return 'Fluvix Nexus を終了すると、次のファイルの未保存の変更が失われます。'
  }
}

export function UnsavedChangesDialog({
  kind,
  items,
  busy,
  error,
  onChoose
}: UnsavedChangesDialogProps): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  // 1件でも保存できる見込みがあるときだけ「保存」を出す。
  const canSave = items.some((item) => !item.unsavable)

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
        data-kind={kind}
      >
        <h2 className="fx-unsaved__title" id="fx-unsaved-title">
          保存されていない変更があります
        </h2>

        <p className="fx-unsaved__body">{describeAction(kind)}</p>

        <ul className="fx-unsaved__list" data-testid="unsaved-list">
          {items.map((item) => (
            <li key={item.id} className="fx-unsaved__item" data-unsavable={item.unsavable}>
              <span className="fx-unsaved__item-name">{item.name}</span>
              <span className="fx-unsaved__item-detail">{item.detail}</span>
              {/* 保存できないものは、その理由を並びの中で伝える。 */}
              {item.unsavable && (
                <span className="fx-unsaved__item-note">ディスク上から削除されています</span>
              )}
            </li>
          ))}
        </ul>

        {error !== null && (
          <p className="fx-unsaved__error" data-testid="unsaved-error">
            {error}
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
            キャンセル
          </button>

          <button
            type="button"
            className="fx-unsaved__button"
            data-variant="danger"
            disabled={busy}
            data-testid="unsaved-discard"
            onClick={() => onChoose('discard')}
          >
            保存しない
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
              {busy ? '保存中…' : 'すべて保存'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
