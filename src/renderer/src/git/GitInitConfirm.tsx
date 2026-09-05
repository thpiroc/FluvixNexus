import { useEffect, useRef, type JSX } from 'react'
import type { TFunction } from '../i18n/messages'

/**
 * `git init` の確認（Session 3-8-10）。
 *
 * ## 失われるものは無いのに、なぜ尋ねるのか
 *
 * §12.6 の「失われるものがある操作に確認を挟む」には当たらない ──
 * 初期化で消えるものは1つも無い。それでも1枚挟んでいるのは、
 * **どのフォルダが対象なのかを、押す前に確かめられるようにする**ためになる。
 *
 * Git パネルはドッキングで自由に置ける（Workspace Shell）ので、
 * パネルの中に Workspace の名前が出ているとは限らない ── 隣のウィンドウを
 * 見ながら作業しているときに、思っていたのと別のフォルダが
 * リポジトリになるのが、この操作でいちばん起こりうる取り違えにあたる。
 * `.git` を作るのは戻せるが（フォルダを消せばよい）、
 * **戻し方を知っているのは Git を知っている人だけ**になる。
 *
 * だから尋ねるのは1つだけ ── 「このフォルダでよいか」。
 *
 * ## 器は破棄の確認と同じ
 *
 * 形も並びも既定の focus も GitDiscardConfirm.tsx と揃えてある。
 * ただし**既定の focus は「はい」側に置かない**のも同じで、
 * 確認の目的が取り違えを止めることにある以上、Enter を押した勢いで
 * そのまま進まない側を既定にする。
 *
 * ネイティブのダイアログを使わないのも同じ理由（ARCHITECTURE.md §7.7）。
 */

interface GitInitConfirmProps {
  /** 対象の Workspace の表示名。 */
  readonly workspaceName: string
  readonly busy: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
  readonly t: TFunction
}

export function GitInitConfirm({
  workspaceName,
  busy,
  onConfirm,
  onCancel,
  t
}: GitInitConfirmProps): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement | null>(null)

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

  return (
    <div className="fx-git__confirm" role="presentation" onPointerDown={onCancel}>
      <div
        className="fx-git__confirm-panel"
        role="alertdialog"
        aria-modal="true"
        aria-label={t('git.initConfirm.aria')}
        data-testid="git-init-confirm"
        // 背景を押したら閉じるが、パネルの中は閉じる操作にしない。
        onPointerDown={(event) => event.stopPropagation()}
      >
        <p className="fx-git__confirm-message">
          {t('git.initConfirm.message', { name: workspaceName })}
        </p>
        {/*
          この1回で何が起きるかだけを書く。**この後に何をすべきかは書かない** ──
          Commit も GitHub への公開も、利用者が別に選ぶことになる。
        */}
        <p className="fx-git__confirm-note">{t('git.initConfirm.note')}</p>
        <div className="fx-git__confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="fx-git__confirm-button"
            onClick={onCancel}
          >
            {t('git.initConfirm.cancel')}
          </button>
          <button
            type="button"
            className="fx-git__confirm-button"
            data-testid="git-init-apply"
            disabled={busy}
            onClick={onConfirm}
          >
            {t('git.initConfirm.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
