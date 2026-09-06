import type { TextDocumentContentChange } from '@shared/lsp'
// 型だけ。実体を import すると、このモジュールを読むだけで Monaco が読み込まれる。
import type * as monaco from 'monaco-editor'

/**
 * Monaco の編集イベントを、境界を越えられる差分へ落とす（Session 5-2）。
 *
 * ## 位置の数え方が2つある
 *
 * ```
 * Monaco … lineNumber / column、どちらも 1 起点
 * LSP    … line / character、どちらも 0 起点
 * ```
 *
 * 単位はどちらも UTF-16 の符号単位なので、引くのは 1 だけでよい
 * （`initialize` で `positionEncodings: ['utf-16']` と申告している。
 * main/lsp/initializeParams.ts）。**変換の向きを1つに保つ**ため、
 * ここを通った後の値は必ず 0 起点になる（shared/lsp/document.ts）。
 *
 * ## 差分にならない編集がある
 *
 * Monaco は「範囲と文字列」の並びで変更を返すが、次の2つはその形にならない。
 *
 * ```
 * isFlush     … setValue（Model の中身を丸ごと入れ替えた）
 * isEolChange … 改行コードだけが変わった（範囲を持つ変更が1つも無い）
 * ```
 *
 * 後者を差分として送ると、**サーバ側の本文だけが古い改行のまま残る**
 * ── 以降の位置がすべて1文字ずつずれる。どちらも全文の置き換え1件へ落とす。
 *
 * ## 並べ替えない
 *
 * Monaco が返す順のまま渡す。`contentChanges` は前から順に適用される決まりで、
 * Monaco の並びは既にその順（後ろの編集から先に並ぶ）になっている。
 * 手を入れると、複数カーソルでの編集がずれる。
 *
 * ## Monaco を import しない
 *
 * 参照するのは型だけで、判断は「数を1つ引く」ことしかしていない。
 * こうしておくと node 環境のまま試せる（monaco/language.ts と同じ分担）。
 */

/**
 * 編集イベントを差分へ落とす。
 *
 * `readFullText` は**必要になったときだけ**呼ばれる（全文が要る編集は稀で、
 * 呼ぶたびに Model の全行を連結することになるため）。
 */
export function toTextDocumentContentChanges(
  event: monaco.editor.IModelContentChangedEvent,
  readFullText: () => string
): readonly TextDocumentContentChange[] {
  if (event.isFlush || event.isEolChange || event.changes.length === 0) {
    return [{ range: null, text: readFullText() }]
  }

  return event.changes.map((change) => ({
    range: {
      start: {
        line: change.range.startLineNumber - 1,
        character: change.range.startColumn - 1
      },
      end: {
        line: change.range.endLineNumber - 1,
        character: change.range.endColumn - 1
      }
    },
    text: change.text
  }))
}
