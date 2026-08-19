import { useEffect, useRef, type JSX } from 'react'
import type { FileEntry } from '@shared/files'

/**
 * 削除の確認。
 *
 * ## ネイティブのダイアログを使わない
 *
 * 操作面はアプリ内 UI に置く方針（ARCHITECTURE.md §7.7）に沿う。加えて、
 * ネイティブのダイアログは Main に出させることになり、
 * 「削除するかどうか」という Renderer 側の判断のために IPC の往復が要る。
 *
 * ## ファイルとフォルダで文を分ける
 *
 * フォルダは中身ごと消えるため、確認の重みが違う。中身の数が分かっている
 * （そのフォルダを既に展開している）ときはそれも出す。分からないときに
 * 「空かもしれない」と濁さず、**中身ごと消えることだけを伝える**
 * ── 数を出すために削除の直前にフォルダを読みに行くと、
 * 大きなフォルダで確認が出るまで待たされる。
 *
 * ## ごみ箱であることを伝える
 *
 * 戻せる操作であることが分かると、確認の意味が変わる（「本当に消してよいか」ではなく
 * 「これで合っているか」）。完全削除の経路は持たない
 * （main/files/mutateWorkspaceEntry.ts）。
 */

interface DeleteConfirmProps {
  readonly entry: FileEntry
  /**
   * そのフォルダに読み込み済みで分かっている中身の数。
   * 読んでいない・ファイルの場合は null。
   */
  readonly loadedChildCount: number | null
  readonly busy: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

function describeTarget(entry: FileEntry, loadedChildCount: number | null): string {
  if (entry.type === 'file') {
    return `「${entry.name}」をごみ箱に移動します。`
  }

  if (loadedChildCount === 0) {
    return `フォルダ「${entry.name}」をごみ箱に移動します。`
  }

  if (loadedChildCount === null) {
    return `フォルダ「${entry.name}」を中身ごとごみ箱に移動します。`
  }

  return `フォルダ「${entry.name}」を中身（${loadedChildCount} 件）ごとごみ箱に移動します。`
}

export function DeleteConfirm({
  entry,
  loadedChildCount,
  busy,
  onConfirm,
  onCancel
}: DeleteConfirmProps): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  /*
    初期 focus は「キャンセル」に置く。

    確認を出す目的は誤操作を止めることなので、Enter を押した勢いで
    そのまま削除されない側を既定にする。
  */
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onCancel])

  return (
    <div className="fx-file-confirm" role="presentation" onPointerDown={onCancel}>
      <div
        className="fx-file-confirm__panel"
        role="alertdialog"
        aria-modal="true"
        aria-label="削除の確認"
        data-entry-type={entry.type}
        data-relative-path={entry.relativePath}
        // 背景を押したら閉じるが、パネルの中は閉じる操作にしない。
        onPointerDown={(event) => event.stopPropagation()}
      >
        <p className="fx-file-confirm__message">{describeTarget(entry, loadedChildCount)}</p>
        <p className="fx-file-confirm__note">ごみ箱から元に戻せます。</p>

        <div className="fx-file-confirm__actions">
          <button
            ref={cancelRef}
            type="button"
            className="fx-file-confirm__button"
            onClick={onCancel}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="fx-file-confirm__button"
            data-variant="danger"
            disabled={busy}
            onClick={onConfirm}
          >
            ごみ箱に移動
          </button>
        </div>
      </div>
    </div>
  )
}
