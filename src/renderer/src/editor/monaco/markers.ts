import type { LspDiagnosticSeverity, LspDiagnosticTag } from '@shared/lsp'
import type { EditorDiagnosticMarker } from '../lsp/diagnosticMarkers'
import { monaco } from './monacoSetup'

/**
 * Language Server の指摘を Monaco の marker として置く（Session 5-3）。
 *
 * **Monaco を import してよい4つめのファイル。** ここがするのは
 * 「名前を Monaco の enum へ直して `setModelMarkers` を呼ぶ」ことだけで、
 * 判断は1つも持たない（何を置くかは lsp/diagnosticStore.ts が決める）。
 *
 * ## owner を分けることが、この機能の要になる
 *
 * `setModelMarkers` は **owner ごとに marker の集合を持つ**。同じ Model に
 * 別の owner で置いた marker は互いを消さず、同じ owner で置き直すと
 * その owner のぶんだけが入れ替わる。
 *
 * ```
 * 'typescript' / 'javascript' … Monaco 内蔵の TypeScript サービス
 * 'json' / 'css' / 'html'     … Monaco 内蔵の各言語サービス
 * 'fluvix.lsp'                … ここ（本物の Language Server）
 * ```
 *
 * 名前を分けてあるおかげで、
 *
 *   - LSP の指摘を置き直しても、内蔵の指摘は消えない（逆も同じ）
 *   - LSP の指摘だけを**まとめて外せる**（サーバが落ちた・文書を閉じた）
 *   - どちらが出した指摘かが、実装の上で常にはっきりしている
 *
 * ## 二重に出さないのは、owner を分けたうえで内蔵を止めること
 *
 * owner を分けただけでは、同じ誤りが2本の線として出る。TypeScript /
 * JavaScript は Monaco も構文を読むため、本物のサーバが答えている間は
 * **内蔵の側を止める**（`setBuiltInValidation`）。
 *
 * 意味解析（型）は Session 3-4 から既に切ってある（monacoSetup.ts）ので、
 * ここで止めるのは構文の検査だけになる。
 *
 * ## サーバが居ないときは、止めない
 *
 * 止めるのは「本物の指摘が届いている」間だけ。Language Server が入っていない
 * PC・起動に失敗した場合・落ちた後は、内蔵の検査がそのまま働く
 * ── STEP 4 までと同じ編集品質へ戻る（DESIGN.md §4）。
 */

/**
 * LSP の指摘を置く owner。
 *
 * Monaco 内蔵のどの owner とも重ならない名前にしてある（内蔵は言語 id を
 * そのまま owner に使う）。`.` を含めてあるのは、将来 LSP 以外の出所
 * （DAP・アプリ自身の指摘）が増えても名前空間が衝突しないようにするため。
 */
export const LSP_MARKER_OWNER = 'fluvix.lsp'

/** 名前 → Monaco の深刻度。 */
const SEVERITY: Readonly<Record<LspDiagnosticSeverity, monaco.MarkerSeverity>> = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  information: monaco.MarkerSeverity.Info,
  hint: monaco.MarkerSeverity.Hint
}

/** 名前 → Monaco の印。 */
const TAG: Readonly<Record<LspDiagnosticTag, monaco.MarkerTag>> = {
  unnecessary: monaco.MarkerTag.Unnecessary,
  deprecated: monaco.MarkerTag.Deprecated
}

/**
 * その Model の LSP 由来の marker を、渡されたもので**入れ替える**。
 *
 * 足すのではない ── `publishDiagnostics` はその文書の全件を毎回送るため、
 * 入れ替えるのが正しい写し方になる（shared/ipc/events/lsp.ts）。
 * 空の配列を渡せば、その文書の LSP 由来の marker だけが消える。
 */
export function applyLspMarkers(
  model: monaco.editor.ITextModel,
  markers: readonly EditorDiagnosticMarker[]
): void {
  monaco.editor.setModelMarkers(
    model,
    LSP_MARKER_OWNER,
    markers.map((marker) => ({
      startLineNumber: marker.startLineNumber,
      startColumn: marker.startColumn,
      endLineNumber: marker.endLineNumber,
      endColumn: marker.endColumn,
      message: marker.message,
      severity: SEVERITY[marker.severity],
      /*
        `source` と `code` は無ければ欄ごと落とす。空文字を渡すと、
        Monaco は「出所の無い指摘」ではなく「出所が空文字の指摘」として括弧を描く。
      */
      ...(marker.source === null ? {} : { source: marker.source }),
      ...(marker.code === null ? {} : { code: marker.code }),
      ...(marker.tags.length === 0 ? {} : { tags: marker.tags.map((tag) => TAG[tag]) })
    }))
  )
}

/** その Model の LSP 由来の marker を外す（内蔵の指摘には触れない）。 */
export function clearLspMarkers(model: monaco.editor.ITextModel): void {
  monaco.editor.setModelMarkers(model, LSP_MARKER_OWNER, [])
}
