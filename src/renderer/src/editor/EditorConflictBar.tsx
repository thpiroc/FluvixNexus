import { lazy, Suspense, useCallback, useState, type JSX } from 'react'
import type { EditorTabState } from './editorTabState'
import { useI18n } from '../i18n/context'
import { describeEditorFailure } from './editorError'
import type { EditorDiskContent } from './useEditorSession'

/**
 * ディスク側と食い違っているときに出す選択肢。
 *
 * ## 黙って決めない
 *
 * Editor 側にもディスク側にも変更がある状態で、アプリが片方を選ぶことはしない。
 * **どちらが要るかを知っているのは利用者だけ**で、しかも間違えると取り返せない。
 * そのため3つを並べ、選ばれるまで何もしない。
 *
 * | 選択      | 何が起きるか                                             | 失うもの       |
 * | --------- | -------------------------------------------------------- | -------------- |
 * | Reload    | ディスクの内容を取り込む                                 | Editor の変更  |
 * | Compare   | 2つを並べて見る（何も変えない）                          | なし           |
 * | 上書き    | Editor の内容でディスクを書き換える                      | ディスクの変更 |
 *
 * **Reload と上書きは、押す前に何を失うかが分かるようにしてある**（ボタンの説明文）。
 * 「押してから気づく」形にすると、Compare を挟む意味が薄れる。
 *
 * ## 削除されている場合は選択肢が違う
 *
 * ディスクから消えているなら、比べる相手も読み直す先も無い。
 * 出せるのは**書き戻す先を選ぶ（別名で保存）1つだけ**になる（Session 4-2）。
 *
 * ここが「押せる選択肢が1つも無い」状態だったのが、このタブの内容が
 * 確実に失われる唯一の経路だった ── 閉じる前の確認が
 * 「救えません」と出していたのも同じ理由（unsaved/lossMessage.ts の `unsavable`）。
 *
 * **Reload と Compare は出さない。** どちらも相手がディスク側の内容で、
 * それが無いのがこの状態そのものになる。押せるのに必ず失敗する選択肢を出さないのは、
 * 閉じる前の確認と同じ約束。
 */

const MonacoDiffEditor = lazy(async () => {
  const module = await import('./monaco/MonacoDiffEditor')

  return { default: module.MonacoDiffEditor }
})

interface EditorConflictBarProps {
  readonly relativePath: string
  readonly state: Extract<EditorTabState, 'conflict' | 'deleted'>
  /** 今 Editor にある中身（Compare の右側）。 */
  readonly editorContent: string
  readonly busy: boolean
  readonly onReload: () => void
  readonly onOverwrite: () => void
  /** 別名で保存（Session 4-2）。削除されたタブの内容を救い出す唯一の経路。 */
  readonly onSaveAs: () => void
  readonly readDiskContent: (relativePath: string) => Promise<EditorDiskContent>
}

export function EditorConflictBar({
  relativePath,
  state,
  editorContent,
  busy,
  onReload,
  onOverwrite,
  onSaveAs,
  readDiskContent
}: EditorConflictBarProps): JSX.Element {
  const { t } = useI18n()
  const [comparison, setComparison] = useState<EditorDiskContent | null>(null)
  const [comparing, setComparing] = useState(false)

  const toggleCompare = useCallback((): void => {
    if (comparison !== null) {
      setComparison(null)
      return
    }

    setComparing(true)

    /*
      比べるたびに読み直す。控えておくと、Compare を閉じて開き直したときに
      **もう古くなっている中身**を「今ディスクにあるもの」として見せることになる。
    */
    void readDiskContent(relativePath).then((disk) => {
      setComparing(false)
      setComparison(disk)
    })
  }, [comparison, readDiskContent, relativePath])

  if (state === 'deleted') {
    return (
      <div className="fx-editor__conflict" data-state="deleted" data-testid="editor-conflict">
        <p className="fx-editor__conflict-title">{t('editor.conflict.deletedTitle')}</p>

        <div className="fx-editor__conflict-actions">
          <button
            type="button"
            className="fx-editor__conflict-button"
            disabled={busy}
            data-testid="conflict-save-as"
            title={t('editor.conflict.saveAsTitle')}
            onClick={onSaveAs}
          >
            {t('editor.saveAs.button')}
            <span className="fx-editor__conflict-note">{t('editor.conflict.saveAsNote')}</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fx-editor__conflict" data-state="conflict" data-testid="editor-conflict">
      <p className="fx-editor__conflict-title">{t('editor.conflict.title')}</p>

      <div className="fx-editor__conflict-actions">
        <button
          type="button"
          className="fx-editor__conflict-button"
          disabled={busy}
          data-testid="conflict-reload"
          // 何を失うかを、押す前に読める場所に置く。
          title={t('editor.conflict.reloadTitle')}
          onClick={onReload}
        >
          Reload<span className="fx-editor__conflict-note">{t('editor.conflict.reloadNote')}</span>
        </button>

        <button
          type="button"
          className="fx-editor__conflict-button"
          disabled={comparing}
          data-testid="conflict-compare"
          aria-pressed={comparison !== null}
          title={t('editor.conflict.compareTitle')}
          onClick={toggleCompare}
        >
          Compare
          <span className="fx-editor__conflict-note">
            {comparison !== null
              ? t('editor.conflict.compareClose')
              : t('editor.conflict.compareOpen')}
          </span>
        </button>

        <button
          type="button"
          className="fx-editor__conflict-button"
          disabled={busy}
          data-testid="conflict-overwrite"
          title={t('editor.conflict.overwriteTitle')}
          onClick={onOverwrite}
        >
          {t('editor.conflict.overwrite')}
          <span className="fx-editor__conflict-note">{t('editor.conflict.overwriteNote')}</span>
        </button>
      </div>

      {comparing && <p className="fx-editor__note">{t('editor.conflict.loadingDisk')}</p>}

      {comparison !== null && comparison.status !== 'ok' && (
        <p className="fx-editor__note" data-variant="error">
          {comparison.status === 'missing'
            ? t('editor.conflict.missingCompare')
            : describeEditorFailure(comparison.failure, t)}
        </p>
      )}

      {comparison !== null && comparison.status === 'ok' && (
        <div className="fx-editor__diff-frame">
          <div className="fx-editor__diff-legend">
            <span>{t('editor.conflict.left')}</span>
            <span>{t('editor.conflict.right')}</span>
          </div>

          <Suspense
            fallback={<p className="fx-editor__note">{t('editor.conflict.preparingDiff')}</p>}
          >
            <MonacoDiffEditor
              relativePath={relativePath}
              original={comparison.content}
              modified={editorContent}
            />
          </Suspense>
        </div>
      )}
    </div>
  )
}
