import { useEffect, useRef, type JSX } from 'react'
import type { GitDiscardTarget, GitFileChange } from '@shared/git'
import { describeGitDiscardWarning } from './gitChanges'

/**
 * 破棄の確認（Session 3-8-9）。
 *
 * ## Git の操作で、確認を挟むのはここだけ
 *
 * Stage / Unstage も Commit も Push も、押しても失われるものが無い（あるいは
 * 失われるなら git が断る）。確認を挟むのは**押した人にしか止められないもの**に
 * 限ってあり（§12.6）、Git ではこの1つになる。
 *
 * ## 形は Files の削除確認と同じ
 *
 * 器も並びも既定の focus も files/DeleteConfirm.tsx と揃えてある ── 同じ
 * 「消してよいか」を尋ねる面が、パネルごとに違う形で出る理由が無い。
 * ネイティブのダイアログを使わないのも同じ理由（ARCHITECTURE.md §7.7）。
 *
 * ## 文言はグループで割れる
 *
 * 未追跡はごみ箱へ行く（戻せる）、変更は元へ戻る（書きかけは戻せない）。
 * **同じ文言で済ませない** ── 片方に必ず嘘をつくことになる
 * （gitChanges.ts の `describeGitDiscardWarning`）。
 *
 * ## 止まっている場合は、押せる場所を出さない
 *
 * Editor に未保存の変更があるファイルでは、破棄そのものを出さずに理由だけを出す
 * （`blocker`）。**disabled のボタンを添えない**のは、押せない理由が
 * 「今は忙しい」ではなく「先に別のことをする必要がある」だから ── 待っても
 * 押せるようにはならない（一覧の競合の行に操作を置いていないのと同じ判断）。
 */

interface GitDiscardConfirmProps {
  readonly group: GitDiscardTarget['group']
  readonly change: GitFileChange
  /** 破棄させない理由。無ければ null（gitChanges.ts の `findGitDiscardBlocker`）。 */
  readonly blocker: string | null
  readonly busy: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

export function GitDiscardConfirm({
  group,
  change,
  blocker,
  busy,
  onConfirm,
  onCancel
}: GitDiscardConfirmProps): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  /*
    初期 focus は「キャンセル」に置く（files/DeleteConfirm.tsx と同じ）。
    確認を出す目的は誤操作を止めることなので、Enter を押した勢いで
    そのまま破棄されない側を既定にする。
  */
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      onCancel()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onCancel])

  const warning = describeGitDiscardWarning(group, change)

  return (
    <div className="fx-git__confirm" role="presentation" onPointerDown={onCancel}>
      <div
        className="fx-git__confirm-panel"
        role="alertdialog"
        aria-modal="true"
        aria-label="変更の破棄の確認"
        data-testid="git-discard-confirm"
        data-group={group}
        data-relative-path={change.relativePath}
        // 背景を押したら閉じるが、パネルの中は閉じる操作にしない。
        onPointerDown={(event) => event.stopPropagation()}
      >
        {blocker === null ? (
          <>
            <p className="fx-git__confirm-message">{warning.message}</p>
            <p className="fx-git__confirm-note">{warning.note}</p>
          </>
        ) : (
          <p className="fx-git__confirm-message" data-testid="git-discard-blocked">
            {blocker}
          </p>
        )}

        <div className="fx-git__confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="fx-git__confirm-button"
            onClick={onCancel}
          >
            {blocker === null ? 'キャンセル' : '閉じる'}
          </button>
          {blocker === null ? (
            <button
              type="button"
              className="fx-git__confirm-button"
              data-variant="danger"
              data-testid="git-discard-apply"
              disabled={busy}
              onClick={onConfirm}
            >
              {warning.confirmLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
