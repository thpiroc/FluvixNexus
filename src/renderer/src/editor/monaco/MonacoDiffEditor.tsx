import { useEffect, useRef, type JSX } from 'react'
import { useTheme } from '../../theme/context'
import { resolveEditorLanguageId } from './language'
import { applyMonacoTheme, DIFF_EDITOR_OPTIONS, monaco, setupMonaco } from './monacoSetup'

/**
 * 2つの中身を並べて見せる器（読み取り専用）。
 *
 * MonacoEditor.tsx と同じく Monaco の実体を import するため、
 * **遅延して読み込まれる**（呼ぶ側が React.lazy する）。どちらの呼び出し元でも
 * 「利用者が差分を見たいと言ったとき」にしか出ないので、それまで読み込む必要が無い。
 *
 * ## 呼ぶ側は2つある（Session 3-8-9 で1つ増えた）
 *
 *   editor/EditorConflictBar.tsx … ディスク側と Editor 側（Session 3-5）
 *   git/GitDiffOverlay.tsx       … Git の1行の変更前と変更後（Session 3-8-9）
 *
 * **この器はどちらの事情も知らない。** 受け取るのは「左に出す中身」と
 * 「右に出す中身」の2つだけで、それが HEAD なのか index なのかディスクなのかは
 * 呼ぶ側が言葉にする（`fx-editor__diff-legend` / `fx-git__diff-legend`）──
 * ここに用途ごとの分岐を置くと、3つ目の呼び出し元で必ず増える。
 *
 * 高さも決めない。器の大きさを決めるのは**それを置いた側**にあたる
 * （Conflict では固定の高さ、Git では面の残り全部）。
 *
 * ## ここは編集しない
 *
 * 見せるだけで、どちらの Model も documentStore の持ち物ではない。
 * 比べるためだけの Model を作り、この器と一緒に捨てる。
 *
 * 右を編集可能にすると「差分の画面で直して保存する」経路ができ、保存の入口が
 * 2つになる。直すのは元のエディタで行う形にしてある。
 *
 * **Auto Save の対象にもならない。** 保存が触るのは documentStore が持っている
 * Model だけで（editor/autoSave.ts / useEditorSession.ts）、ここで作る2つは
 * そこに登録されない ── 差分を開いている間に保存が走ることも、閉じたときに
 * 何かが書き戻されることも無い。
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
 * 比べる中身は文字列として受け取り、その写しで Model を作る。借りると、
 *   - Diff Editor が dispose されるときに、開いているファイルの Model まで捨てうる
 *   - 同じ Model が2つのエディタに載り、片方を閉じたときの扱いが増える
 * ことになる。差分は「その瞬間の写し」で足りる。
 */

/** 比べるためだけの Model の URI に付ける通し番号（MonacoEditor.tsx と同じ理由）。 */
let diffSequence = 0

interface MonacoDiffEditorProps {
  /** 何のファイルの差分か（言語の判定に使う）。 */
  readonly relativePath: string
  /** 左に出す中身（変更の前）。 */
  readonly original: string
  /** 右に出す中身（変更の後）。 */
  readonly modified: string
}

export function MonacoDiffEditor({
  relativePath,
  original,
  modified
}: MonacoDiffEditorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { settings: appearance } = useTheme()

  /*
    Theme を当てる（Session 4-4）。Monaco のテーマはアプリに1つなので、
    通常のエディタと同じ `applyMonacoTheme` をそのまま呼ぶ ── 差分だけ別の
    配色にしない（同じファイルを見ているのに、器で色が変わるのは道具として不自然）。
  */
  useEffect(() => {
    setupMonaco()
    applyMonacoTheme(appearance.theme)
  }, [appearance.theme])

  useEffect(() => {
    const container = containerRef.current

    if (container === null) {
      return
    }

    setupMonaco()

    diffSequence += 1
    const languageId = resolveEditorLanguageId(relativePath)

    const originalModel = monaco.editor.createModel(
      original,
      languageId,
      monaco.Uri.from({
        scheme: 'fluvix',
        authority: 'diff',
        path: `/${diffSequence}/original/${relativePath}`
      })
    )

    const modifiedModel = monaco.editor.createModel(
      modified,
      languageId,
      monaco.Uri.from({
        scheme: 'fluvix',
        authority: 'diff',
        path: `/${diffSequence}/modified/${relativePath}`
      })
    )

    const diffEditor = monaco.editor.createDiffEditor(container, DIFF_EDITOR_OPTIONS)
    diffEditor.setModel({ original: originalModel, modified: modifiedModel })

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
      originalModel.dispose()
      modifiedModel.dispose()
    }
  }, [relativePath, original, modified])

  return (
    <div
      className="fx-editor__diff"
      data-testid="editor-diff"
      data-relative-path={relativePath}
      ref={containerRef}
    />
  )
}
