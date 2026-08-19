import { useEffect, useRef, type JSX } from 'react'
import { resolveEditorLanguageId } from './language'
import { DIFF_EDITOR_OPTIONS, monaco, setupMonaco } from './monacoSetup'

/**
 * Conflict の Compare（ディスク側と Editor 側の差分）。
 *
 * MonacoEditor.tsx と同じく Monaco の実体を import するため、
 * **遅延して読み込まれる**（呼ぶ側が React.lazy する）。Compare は
 * Conflict になったときにしか出ないので、それまで読み込む必要が無い。
 *
 * ## ここは編集しない
 *
 * 見せるだけで、どちらの Model も documentStore の持ち物ではない。
 * 比べるためだけの Model を作り、この器と一緒に捨てる。
 *
 *   左（original）… 今ディスクにある中身
 *   右（modified）… Editor で編集中の中身
 *
 * 右を編集可能にすると「差分の画面で直して保存する」経路ができ、
 * 保存の入口が2つになる。**選ぶのは Reload / Overwrite のどちらか**に
 * 留め、直すのは元のエディタで行う形にしてある。
 *
 * ## 開発時にだけ出る例外について
 *
 * 開発ビルドでは React.StrictMode が effect を意図的に2回走らせる
 * （mount → cleanup → mount）。1回目で作った Model は即座に捨てられるが、
 * Monaco が Worker へ投げた差分の計算はまだ飛んでいて、
 * 戻ってきたときには Model が無い ── Monaco 側がそこを null 検査せずに
 * `no diff result available` を投げる（`diffProviderFactoryService.js`）。
 *
 * **配布ビルドでは起きない**（StrictMode の二重呼び出しは React の開発ビルドだけ）。
 * 表示にも影響しない ── 2回目の mount が作った Model で差分は正しく出る。
 * こちらから止める手立てが無い（計算を始めるのも取り消すのも Monaco の中）ため、
 * 開発時の既知の挙動として扱う。docs/DEVELOPMENT.md §4 にも書いてある。
 *
 * ## Model を documentStore から借りない
 *
 * 編集中の中身は文字列として受け取り、その写しで Model を作る。借りると、
 *   - Diff Editor が dispose されるときに、開いているファイルの Model まで捨てうる
 *   - 同じ Model が2つのエディタに載り、片方を閉じたときの扱いが増える
 * ことになる。差分は「その瞬間の写し」で足りる。
 */

/** 比べるためだけの Model の URI に付ける通し番号（MonacoEditor.tsx と同じ理由）。 */
let diffSequence = 0

interface MonacoDiffEditorProps {
  /** 何のファイルの差分か（言語の判定に使う）。 */
  readonly relativePath: string
  /** 今ディスクにある中身。 */
  readonly diskContent: string
  /** Editor で編集中の中身。 */
  readonly editorContent: string
}

export function MonacoDiffEditor({
  relativePath,
  diskContent,
  editorContent
}: MonacoDiffEditorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current

    if (container === null) {
      return
    }

    setupMonaco()

    diffSequence += 1
    const languageId = resolveEditorLanguageId(relativePath)

    const original = monaco.editor.createModel(
      diskContent,
      languageId,
      monaco.Uri.from({
        scheme: 'fluvix',
        authority: 'diff',
        path: `/${diffSequence}/disk/${relativePath}`
      })
    )

    const modified = monaco.editor.createModel(
      editorContent,
      languageId,
      monaco.Uri.from({
        scheme: 'fluvix',
        authority: 'diff',
        path: `/${diffSequence}/editor/${relativePath}`
      })
    )

    const diffEditor = monaco.editor.createDiffEditor(container, DIFF_EDITOR_OPTIONS)
    diffEditor.setModel({ original, modified })

    return () => {
      /*
        **先に Model を外してから捨てる。**

        差分の計算は Worker で走っており、器を先に捨てると
        「計算が終わったのに結果を渡す先が無い」状態になる
        （Monaco が `no diff result available` を投げる）。
        `setModel(null)` で先に切り離しておくと、飛んでいる計算の結果は
        黙って捨てられる。dev のように読み込みが遅い環境ほど当たりやすい。
      */
      diffEditor.setModel(null)
      diffEditor.dispose()

      // 作ったものは全部捨てる。ここの Model は誰とも共有していない。
      original.dispose()
      modified.dispose()
    }
  }, [relativePath, diskContent, editorContent])

  return (
    <div
      className="fx-editor__diff"
      data-testid="editor-diff"
      data-relative-path={relativePath}
      ref={containerRef}
    />
  )
}
