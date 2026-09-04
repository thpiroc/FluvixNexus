import { useEffect, useRef, type JSX } from 'react'
import { useI18n } from '../i18n/context'
import '../unsaved/unsaved.css'
import type { TerminalTab } from './terminalTabsModel'

/**
 * 実行中のターミナルを閉じる前の確認（1枚ぶん・Session 3-7-4）。
 *
 * 見た目は unsaved/UnsavedChangesDialog と同じものを使う（`unsaved.css` を共有）。
 * 分けてあるのは答える単位が違うためで、揃えているのは**同じ意味の選択肢が
 * 同じ見え方をする**ようにするため（useTerminalCloseGuard.ts）。
 *
 * ## 「保存」にあたる道が無い
 *
 * 未保存のファイルには「保存して閉じる」という3つめの道があるが、
 * 走っているプロセスにそれは無い。並ぶのは「閉じる」と「キャンセル」の2つで、
 * **押せるのに何も救えない選択肢**（「保存」）を出さないのは
 * editor/TabCloseConfirm.tsx と同じ判断にあたる。
 *
 * 初期 focus は「キャンセル」。確認の目的は誤操作を止めることなので、
 * Enter を押した勢いで動いているものが消えない側を既定にする
 * （files/DeleteConfirm.tsx と同じ）。
 *
 * ## 何が動いているかは書かない
 *
 * Renderer は実行中のプロセスの名前を持っていない（Main が持ち帰らない。
 * main/terminal/childProcesses.ts）。書けるのは「動いているものがある」までで、
 * 中身は端末の画面そのものに出ている ── **確認の裏に見えているもの**を
 * 文字で言い直す必要は無い。
 */

interface TerminalCloseConfirmProps {
  readonly tab: TerminalTab
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

export function TerminalCloseConfirm({
  tab,
  onConfirm,
  onCancel
}: TerminalCloseConfirmProps): JSX.Element {
  const { t } = useI18n()
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  const name = tab.shellName ?? t('terminal.tabs.fallbackName')

  return (
    <div
      className="fx-unsaved__backdrop"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onCancel()
        }
      }}
    >
      <div
        className="fx-unsaved"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fx-terminal-close-title"
        data-testid="terminal-close-dialog"
      >
        <h2 className="fx-unsaved__title" id="fx-terminal-close-title">
          {t('terminal.closeConfirm.title', { name })}
        </h2>

        <p className="fx-unsaved__body">{t('terminal.closeConfirm.body')}</p>

        <ul className="fx-unsaved__list">
          <li className="fx-unsaved__item" data-kind="running-terminal">
            <span className="fx-unsaved__item-name">{name}</span>
            <span className="fx-unsaved__item-note">{t('terminal.closeConfirm.runningNote')}</span>
          </li>
        </ul>

        <div className="fx-unsaved__actions">
          <button
            type="button"
            className="fx-unsaved__button"
            ref={cancelRef}
            data-testid="terminal-close-cancel"
            onClick={onCancel}
          >
            {t('common.actions.cancel')}
          </button>

          <button
            type="button"
            className="fx-unsaved__button"
            data-variant="danger"
            data-testid="terminal-close-confirm"
            onClick={onConfirm}
          >
            {t('terminal.closeConfirm.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
