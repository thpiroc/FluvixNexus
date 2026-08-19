import { useEffect, useRef, type JSX } from 'react'
import type { FileEncoding, FileLineEnding, FileRevision } from '@shared/files'
import type { EditorRevealRequest } from '../editorReveal'
import type { EditorDocumentSource, EditorDocumentStore } from './documentStore'
import { resolveEditorLanguageId } from './language'
import { EDITOR_OPTIONS, monaco, setupMonaco } from './monacoSetup'

/**
 * Monaco Editor の器。
 *
 * ## エディタは1つ、Model は開いた数だけ
 *
 * タブごとにエディタを作らない。作るのは1つだけで、タブを切り替えたら
 * **その Model を差し替える**（VS Code と同じ形）。
 *
 * ```
 * MonacoEditor（1つ）
 *    └── setModel(…)  ← タブを切り替えるたびに差し替わる
 *          documentStore が持つ Model（ファイルの数だけ）
 * ```
 *
 * この形にすると、
 *   - 編集内容と **Undo / Redo 履歴が Model 側に付く**ので、切り替えても消えない
 *   - タブが増えてもエディタのインスタンスは増えない（DOM も1つのまま）
 *   - Find / Replace などのウィジェットの状態が、切り替えのたびに作り直されない
 *
 * カーソル・選択・スクロール位置だけは Model ではなく**エディタ側**の状態なので、
 * 離れる前に控えて戻ってきたときに復元する（documentStore の viewState）。
 *
 * ## Model を作りも捨てもしない
 *
 * ここがするのは「見せる」ことだけ。Model の生成と破棄は documentStore の責務で、
 * その持ち主は Provider（Workspace Shell の外側）。この分担があるため、
 * **Editor パネルを閉じても未保存の編集が消えない**（documentStore.ts の冒頭）。
 *
 * ## ここに来るのは 'ready' のときだけ
 *
 * 読み込み中・バイナリ・大きすぎる・読めなかった、は EditorDocumentView が出す。
 * テキストとして出せないものを Monaco へ渡さないのは、
 * バイナリを無理に文字列化すると化けた内容を「編集して保存できる」状態にしてしまうため。
 */

/**
 * Model の URI に付ける通し番号。
 *
 * URI を relativePath だけから作ると、**改名の後に同じ名前のファイルが作られた**場合に
 * 衝突する（Monaco は同じ URI の Model を2つ作れず例外になる）。改名では
 * ストア側の鍵だけを付け替えて Model はそのまま使い続けるため、
 * 古い名前の URI が残ることがある。
 *
 * 鍵が relativePath であることは変わらない ── URI は Monaco の内部識別子で、
 * TypeScript サービスがファイル名として読む以上の意味を持たない
 * （末尾を実際の名前にしてあるのは、`.tsx` を JSX として読ませるため）。
 */
let modelSequence = 0

/**
 * Model を作る（documentStore から渡される `EditorModelFactory`）。
 *
 * Monaco の作法（言語 id・URI・改行）を知っているのは器の側だけ、という分担
 * （documentStore.ts の冒頭）。
 */
function createEditorModel(
  relativePath: string,
  source: EditorDocumentSource
): monaco.editor.ITextModel {
  modelSequence += 1

  const model = monaco.editor.createModel(
    source.content,
    resolveEditorLanguageId(relativePath),
    monaco.Uri.from({
      // file: にしない。実在するファイルの絶対位置ではないため
      //（Renderer は絶対パスを持たない。ARCHITECTURE.md §9.2）。
      scheme: 'fluvix',
      authority: 'workspace',
      path: `/${modelSequence}/${relativePath}`
    })
  )

  /*
    改行を読んだときの形に固定する。

    Monaco は中身から改行を推定するが、改行を1つも含まないファイルでは既定になる。
    Windows を対象にしているため、そこは読み込み側の判断
    （main/files/fileContent.ts の detectLineEnding）に合わせる。
    保存で書き戻すのは `model.getValue()` ＝ この EOL で連結した文字列なので、
    ここが「開いたときの形を保つ」の実体になる。
  */
  model.setEOL(
    source.lineEnding === 'crlf'
      ? monaco.editor.EndOfLineSequence.CRLF
      : monaco.editor.EndOfLineSequence.LF
  )

  return model
}

interface MonacoEditorProps {
  /** 開いているファイルの位置。Model の鍵。 */
  readonly relativePath: string
  readonly content: string
  readonly lineEnding: FileLineEnding
  readonly encoding: FileEncoding
  readonly revision: FileRevision | null
  readonly documents: EditorDocumentStore
  /**
   * 見せてほしい位置（editor/editorReveal.ts）。無ければ null。
   *
   * 渡ってくるのは**このファイルに対する依頼だけ**（絞るのは EditorWorkArea.tsx）。
   */
  readonly reveal?: EditorRevealRequest | null
  /** 位置を見せ終えたことを伝える。 */
  readonly onRevealed?: () => void
}

export function MonacoEditor({
  relativePath,
  content,
  lineEnding,
  encoding,
  revision,
  documents,
  reveal = null,
  onRevealed
}: MonacoEditorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  /** 今エディタに載っている位置。離れるときに viewState を控える相手。 */
  const mountedPathRef = useRef<string | null>(null)

  /*
    エディタの生成と破棄。

    Model には触れない（依存に relativePath を入れていないのはそのため）。
    パネルを閉じる / Dock で動かすとここは作り直されるが、
    そのときに消えるのは器だけで、中身は documentStore に残る。
  */
  useEffect(() => {
    const container = containerRef.current

    if (container === null) {
      return
    }

    setupMonaco()

    const editor = monaco.editor.create(container, EDITOR_OPTIONS)
    editorRef.current = editor

    /*
      ストアへ参照を預ける。中身を差し替える（Reload・外部変更の取り込み）ときに、
      見ていた位置を控えて戻すのに要る。持ち主はあくまでこちらで、
      預けるのは「今画面に出ているのはこれ」という参照だけ。
    */
    documents.attachEditor(editor)

    return () => {
      // 作り直された後も同じ位置へ戻れるように、消える前に控える。
      if (mountedPathRef.current !== null) {
        documents.saveViewState(mountedPathRef.current, editor)
      }

      documents.attachEditor(null)
      mountedPathRef.current = null
      editorRef.current = null

      /*
        エディタだけを捨てる。`editor.dispose()` は自分が作った Model しか捨てないため、
        documentStore が持つ Model はそのまま残る。
      */
      editor.dispose()
    }
  }, [documents])

  /*
    見せる Model の差し替え（タブの切り替え）。

    「離れる前に控える → 差し替える → 戻ってきた位置を復元する」の順を守る。
    控えるのを後回しにすると、切り替えた先の位置を前のファイルの控えとして書いてしまう。
  */
  useEffect(() => {
    const editor = editorRef.current

    if (editor === null) {
      return
    }

    const previousPath = mountedPathRef.current

    if (previousPath === relativePath) {
      return
    }

    if (previousPath !== null) {
      documents.saveViewState(previousPath, editor)
    }

    const model = documents.acquire(
      relativePath,
      { content, lineEnding, encoding, revision },
      createEditorModel
    )

    mountedPathRef.current = relativePath
    editor.setModel(model)
    documents.restoreViewState(relativePath, editor)

    /*
      切り替えた直後は打てる状態にしておく。
      タブをクリックした流れで文字を打ち始められないと、切り替えのたびに
      もう一度エディタをクリックすることになる。
    */
    editor.focus()
  }, [documents, relativePath, content, lineEnding, revision])

  /*
    依頼された位置を見せる（全文検索の結果を押したとき。Session 3-6-5）。

    **Model を載せる effect の後に置いてある**のが要点。React は宣言した順に
    effect を走らせるため、新しく開いたファイルでも「Model を載せる → 位置へ飛ぶ」
    の順が保たれる（先に置くと、まだ前のファイルが載っているエディタへ
    行番号だけを渡すことになる）。

    依頼は**1回きり**。適用したら `onRevealed` で消してもらう（editorReveal.ts）
    ── 残しておくと、タブを切り替えて戻るたびに同じ場所へ引き戻される。

    行・桁は Renderer から見れば境界の外の値（Main が数えたもの）なので、
    Model の範囲に収める。ファイルがアプリの外で短くなっていた場合でも、
    存在しない行へ飛ばそうとして例外にならない。
  */
  useEffect(() => {
    const editor = editorRef.current

    if (editor === null || reveal === null || reveal.relativePath !== relativePath) {
      return
    }

    // Model がまだ載っていない（上の effect が走る前）。次の描画で改めて来る。
    if (mountedPathRef.current !== relativePath) {
      return
    }

    const model = editor.getModel()

    if (model === null) {
      return
    }

    const position = model.validatePosition({
      lineNumber: reveal.line,
      column: reveal.column
    })

    /*
      一致した範囲を選択したまま見せる。preview に付けた印と同じ範囲になるので、
      飛んだ先で「どれが一致なのか」を目で探し直さずに済む。
    */
    const end = model.validatePosition({
      lineNumber: position.lineNumber,
      column: position.column + reveal.length
    })

    editor.setSelection({
      startLineNumber: position.lineNumber,
      startColumn: position.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column
    })

    /*
      画面の中央へ持ってくる。ただし**既に見えている場合はスクロールしない**
      ── 同じ画面の中の別の一致へ移るたびに表示が飛ぶと、前後の行を追えない。
    */
    editor.revealPositionInCenterIfOutsideViewport(position)
    editor.focus()

    onRevealed?.()
  }, [reveal, relativePath, onRevealed])

  return (
    <div
      className="fx-editor__monaco"
      data-testid="editor-monaco"
      data-relative-path={relativePath}
      /*
        何の言語として開いているかを画面から読めるようにしておく。
        ステータスバーへ出す（DESIGN.md §4）ときの元になる値でもある。
      */
      data-language={resolveEditorLanguageId(relativePath)}
      ref={containerRef}
    />
  )
}
