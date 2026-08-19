import { lazy, Suspense, useCallback, useState, type JSX } from 'react'
import type { EditorTabState } from './editorTabState'
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
 * 出せるのは「Editor の内容はここにある」という事実だけで、
 * 書き戻す先を選ぶ（Save As）のは Session 3-6 以降。
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
  readonly readDiskContent: (relativePath: string) => Promise<EditorDiskContent>
}

export function EditorConflictBar({
  relativePath,
  state,
  editorContent,
  busy,
  onReload,
  onOverwrite,
  readDiskContent
}: EditorConflictBarProps): JSX.Element {
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
        <p className="fx-editor__conflict-title">
          このファイルはディスク上から削除されました。編集中の内容はここにだけ残っています。
        </p>
      </div>
    )
  }

  return (
    <div className="fx-editor__conflict" data-state="conflict" data-testid="editor-conflict">
      <p className="fx-editor__conflict-title">
        このファイルはアプリの外で変更されました。未保存の変更があるため、自動では反映していません。
      </p>

      <div className="fx-editor__conflict-actions">
        <button
          type="button"
          className="fx-editor__conflict-button"
          disabled={busy}
          data-testid="conflict-reload"
          // 何を失うかを、押す前に読める場所に置く。
          title="ディスク上の内容を読み込みます。Editor 上の未保存の変更は失われます。"
          onClick={onReload}
        >
          Reload<span className="fx-editor__conflict-note">未保存の変更を破棄</span>
        </button>

        <button
          type="button"
          className="fx-editor__conflict-button"
          disabled={comparing}
          data-testid="conflict-compare"
          aria-pressed={comparison !== null}
          title="ディスク上の内容と、Editor 上の内容を並べて比べます。"
          onClick={toggleCompare}
        >
          Compare
          <span className="fx-editor__conflict-note">
            {comparison !== null ? '閉じる' : '差分を見る'}
          </span>
        </button>

        <button
          type="button"
          className="fx-editor__conflict-button"
          disabled={busy}
          data-testid="conflict-overwrite"
          title="Editor 上の内容でディスクを書き換えます。ディスク側の変更は失われます。"
          onClick={onOverwrite}
        >
          上書き保存<span className="fx-editor__conflict-note">ディスク側の変更を破棄</span>
        </button>
      </div>

      {comparing && <p className="fx-editor__note">ディスク上の内容を読み込んでいます…</p>}

      {comparison !== null && comparison.status !== 'ok' && (
        <p className="fx-editor__note" data-variant="error">
          {comparison.status === 'missing'
            ? 'ディスク上から削除されているため、比べられません。'
            : comparison.message}
        </p>
      )}

      {comparison !== null && comparison.status === 'ok' && (
        <div className="fx-editor__diff-frame">
          <div className="fx-editor__diff-legend">
            <span>左: ディスク上の内容</span>
            <span>右: Editor 上の内容（未保存）</span>
          </div>

          <Suspense fallback={<p className="fx-editor__note">差分を準備しています…</p>}>
            <MonacoDiffEditor
              relativePath={relativePath}
              diskContent={comparison.content}
              editorContent={editorContent}
            />
          </Suspense>
        </div>
      )}
    </div>
  )
}
