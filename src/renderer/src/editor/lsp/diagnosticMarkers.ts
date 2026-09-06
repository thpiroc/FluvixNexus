import type { LspDiagnostic, LspDiagnosticSeverity, LspDiagnosticTag } from '@shared/lsp'

/**
 * 届いた指摘を、Monaco の marker が要る形へ落とす（Session 5-3・依存なし・テスト対象）。
 *
 * ## 位置の数え方が2つある（Session 5-2 の逆向き）
 *
 * ```
 * LSP    … line / character、どちらも 0 起点
 * Monaco … lineNumber / column、どちらも 1 起点
 * ```
 *
 * 差分を送るときに 1 → 0 へ落としたのと**同じ場所で、同じ規則の逆**をする
 * （renderer/src/editor/monaco/documentChanges.ts）。変換の向きを1方向に保つ、
 * という Session 5-2 の判断がここにも効いている。
 *
 * ## Monaco を import しない
 *
 * 深刻度と印は**名前のまま**返し、Monaco の enum へ直すのは器の側
 * （renderer/src/editor/monaco/markers.ts）が持つ。分けてあるのは2つの理由による。
 *
 *   - **テストできる形にしておく。** ここでしていることは数を1つ足すことと
 *     範囲を整えることだけで、Monaco（DOM とワーカーを要求する）を
 *     読み込ませる理由が無い（monaco/language.ts と同じ分担）
 *   - **起動時に Monaco を読み込ませない。** この層は Editor が開かれる前から
 *     生きている（診断の購読はアプリの起動と同時に張る）
 *
 * ## 範囲が逆でも落とさない
 *
 * 終わりが始まりより前にある範囲は、本来あり得ない。それでも捨てないのは、
 * **これが別のプロセスから届いた値**だからにほかならない ── 1件の数え間違いを、
 * 指摘そのものを隠す理由にしない。始まりへ畳んで、その位置に出す。
 */

/** Monaco の marker1つ分（位置は 1 起点）。 */
export interface EditorDiagnosticMarker {
  readonly startLineNumber: number
  readonly startColumn: number
  readonly endLineNumber: number
  readonly endColumn: number
  readonly message: string
  readonly severity: LspDiagnosticSeverity
  readonly source: string | null
  readonly code: string | null
  readonly tags: readonly LspDiagnosticTag[]
}

export function toEditorDiagnosticMarkers(
  diagnostics: readonly LspDiagnostic[]
): readonly EditorDiagnosticMarker[] {
  return diagnostics.map(toEditorDiagnosticMarker)
}

function toEditorDiagnosticMarker(diagnostic: LspDiagnostic): EditorDiagnosticMarker {
  const startLineNumber = diagnostic.range.start.line + 1
  const startColumn = diagnostic.range.start.character + 1
  const endLineNumber = diagnostic.range.end.line + 1
  const endColumn = diagnostic.range.end.character + 1

  const inOrder =
    endLineNumber > startLineNumber ||
    (endLineNumber === startLineNumber && endColumn >= startColumn)

  return {
    startLineNumber,
    startColumn,
    endLineNumber: inOrder ? endLineNumber : startLineNumber,
    endColumn: inOrder ? endColumn : startColumn,
    message: diagnostic.message,
    severity: diagnostic.severity,
    source: diagnostic.source,
    code: diagnostic.code,
    tags: diagnostic.tags
  }
}
