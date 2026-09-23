import { useEffect, useRef, type JSX } from 'react'
import { useI18n } from '../i18n/context'
import { diffLineMark, type AgentFileWritePrompt } from './agentFileWritePrompt'
import './agentFileWrite.css'

/**
 * FN Agent の変更を見せる確認（Security Core v1 の STEP7。第1段階）。
 *
 * unsaved/UnsavedChangesDialog.tsx と同じ作りのアプリ内モーダル。**これは承認では
 * ない** ── ここで「続ける」を選んでも書き込みは起きず、Main が改めて Native の
 * 確認を出す（第2段階。main/security/approval/approvalDialog.ts）。
 *
 * ```
 * この画面      何が変わるかを見せて、先へ進めるかを尋ねる
 * Native 確認   Renderer が描けない場所で、最後の1歩を尋ねる
 * ```
 *
 * ## 見るだけ
 *
 * **内容を編集できる要素を置かない**（input も textarea も contentEditable も無い）。
 * 直したい場合は一度取り消し、新しい提案として出し直してもらう ── 画面で直せる形に
 * すると、「承認した内容」を Renderer が作れることになり、Main が持つ提案本文と
 * 二重になる。
 *
 * ## Diff は届いたものを並べるだけ
 *
 * 行は Main が Mask して制御文字を潰して切った後の文字列で、**そのまま文字として
 * 描く**（`dangerouslySetInnerHTML` は使わない）。行の中身で画面の並びを
 * 組み替えられないよう、印（`+` / `-`）と行番号は Diff の中身とは別の要素に置く。
 *
 * ## 既定は「取り消す」
 *
 * 初期 focus を取り消しに置く（DeleteConfirm.tsx / UnsavedChangesDialog.tsx と同じ）。
 * Esc も取り消しにあたる。**返事をしなければ、Main 側で 5 分後に失効する。**
 */

interface AgentFileWriteDialogProps {
  readonly prompt: AgentFileWritePrompt
  readonly busy: boolean
  readonly onContinue: () => void
  readonly onCancel: () => void
}

export function AgentFileWriteDialog({
  prompt,
  busy,
  onContinue,
  onCancel
}: AgentFileWriteDialogProps): JSX.Element {
  const { t } = useI18n()
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [prompt.approvalId])

  const { diff } = prompt

  return (
    <div
      className="fx-agent-write__backdrop"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          onCancel()
        }
      }}
    >
      <div
        className="fx-agent-write"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fx-agent-write-title"
        data-testid="agent-file-write-dialog"
      >
        <h2 className="fx-agent-write__title" id="fx-agent-write-title">
          {t('agent.fileWrite.title')}
        </h2>

        <p className="fx-agent-write__body">
          {prompt.newFile ? t('agent.fileWrite.bodyNew') : t('agent.fileWrite.bodyExisting')}
        </p>

        <p className="fx-agent-write__path" data-testid="agent-file-write-path">
          <span className="fx-agent-write__path-label">{t('agent.fileWrite.pathLabel')}</span>
          <span className="fx-agent-write__path-value">{prompt.workspacePath}</span>
          {prompt.newFile && (
            <span className="fx-agent-write__badge">{t('agent.fileWrite.newBadge')}</span>
          )}
        </p>

        <div className="fx-agent-write__diff-head">
          <span>{t('agent.fileWrite.diffLabel')}</span>
          <span className="fx-agent-write__counts" data-testid="agent-file-write-counts">
            {t('agent.fileWrite.counts', {
              added: diff.addedCount,
              removed: diff.removedCount
            })}
          </span>
        </div>

        {diff.lines.length === 0 ? (
          <p className="fx-agent-write__empty">{t('agent.fileWrite.noChange')}</p>
        ) : (
          <ol className="fx-agent-write__diff" data-testid="agent-file-write-diff">
            {diff.lines.map((line, index) => (
              <li
                key={`${line.kind}:${line.oldLine ?? '-'}:${line.newLine ?? '-'}:${index}`}
                className="fx-agent-write__line"
                data-kind={line.kind}
              >
                <span className="fx-agent-write__line-number">{line.oldLine ?? ''}</span>
                <span className="fx-agent-write__line-number">{line.newLine ?? ''}</span>
                <span className="fx-agent-write__line-mark">{diffLineMark(line.kind)}</span>
                <span className="fx-agent-write__line-text">{line.text}</span>
              </li>
            ))}
          </ol>
        )}

        {diff.truncated && (
          <p className="fx-agent-write__note" data-testid="agent-file-write-truncated">
            {t('agent.fileWrite.truncated')}
          </p>
        )}

        {diff.secretMasked && (
          <p className="fx-agent-write__note" data-testid="agent-file-write-masked">
            {t('agent.fileWrite.secretMasked')}
          </p>
        )}

        <p className="fx-agent-write__note">{t('agent.fileWrite.readOnlyNote')}</p>

        <div className="fx-agent-write__actions">
          <button
            type="button"
            className="fx-agent-write__button"
            ref={cancelRef}
            disabled={busy}
            title={t('agent.fileWrite.cancelTitle')}
            data-testid="agent-file-write-cancel"
            onClick={onCancel}
          >
            {t('agent.fileWrite.cancel')}
          </button>

          <button
            type="button"
            className="fx-agent-write__button"
            data-variant="primary"
            disabled={busy}
            title={t('agent.fileWrite.continueTitle')}
            data-testid="agent-file-write-continue"
            onClick={onContinue}
          >
            {t('agent.fileWrite.continue')}
          </button>
        </div>
      </div>
    </div>
  )
}
