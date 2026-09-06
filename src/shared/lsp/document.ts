/**
 * 開いている文書の同期で運ぶ値（Session 5-2）。
 *
 * ## なぜ shared に置くか
 *
 * Document Synchronization は「Renderer で起きた編集を Main が Language Server へ
 * 伝える」経路で、**編集1件の形**を両側が同じに読む必要がある。
 * Monaco の変更イベント（Renderer）と LSP の `contentChanges`（Main）は
 * どちらもこの形へ落ちるため、対応の取り方を1箇所に決めておく。
 *
 * ここに置くのは型と上限だけで、Monaco も LSP も import しない
 * （shared 層のルール。shared/files/content.ts と同じ立ち位置）。
 *
 * ## 位置は 0 起点、単位は UTF-16
 *
 * LSP の既定（`positionEncoding` = `utf-16`）に合わせてある。Monaco の
 * `lineNumber` / `column` は 1 起点なので、変換するのは Renderer 側
 * （renderer/src/editor/monaco/documentChanges.ts）。**変換の向きを1つに保つ**ため、
 * この境界を越えてくる値は必ず 0 起点で届く。
 *
 * ## relativePath しか渡らない
 *
 * 文書を指すのは Workspace root からの相対位置だけで、URI もファイルの絶対位置も
 * ここには現れない。URI を組み立てるのは Main（main/lsp/documentUri.ts）で、
 * Workspace の外を指す相対位置はそこへ届く前に断られる
 * （shared/ipc/contracts/lsp.ts）。
 */

/**
 * 1回の変更通知に載せられる変更の数。
 *
 * Monaco は1回の編集イベントに複数の変更を載せる（複数カーソル・整形・置換）。
 * 上限があるのは、**境界の外から届く配列**であるため ── 桁違いの長さを
 * そのまま電文へ組み立てると、その1通で JSON-RPC の上限（64MB）に当たる。
 *
 * 実際に大きくなるのは全置換だが、その場合の変更は1件（範囲なしの全文）になる。
 * 複数カーソルが数百に増えることは通常の編集では起きない。
 */
export const LSP_DOCUMENT_MAX_CONTENT_CHANGES = 1024

/**
 * 1回の通知で運べる本文の長さ（UTF-16 の符号単位）。
 *
 * `didOpen` の全文と、貼り付けによる大きな変更の両方に掛かる。
 * 読み込めるファイルの上限（FILES_FILE_MAX_BYTES）より緩くしてあるのは、
 * 開いた後に打ち足せるため ── 上限そのものを外さないのは、
 * この文字列が**そのまま子プロセスの標準入力へ流れる**ことによる。
 */
export const LSP_DOCUMENT_MAX_TEXT_LENGTH = 16 * 1024 * 1024

/** 文書の中の位置（0 起点・UTF-16 の符号単位）。 */
export interface TextDocumentPosition {
  readonly line: number
  readonly character: number
}

/** 文書の中の範囲。`start` は含み、`end` は含まない。 */
export interface TextDocumentRange {
  readonly start: TextDocumentPosition
  readonly end: TextDocumentPosition
}

/**
 * 変更1件。
 *
 * `range` が null なら**全文の置き換え**を表す。2つの形を別の型に分けず
 * 1つの欄で表すのは、送る側（Monaco の編集イベント）が
 * 「差分で表せる編集」と「表せない編集」を同じイベントで返すため
 * ── 改行コードの変更や `setValue` は差分にならない（documentChanges.ts）。
 */
export interface TextDocumentContentChange {
  readonly range: TextDocumentRange | null
  readonly text: string
}

/** 0 以上の整数か（版番号・行・桁に使う）。 */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * 境界の外から届いた値が文書の版番号として扱えるか。
 *
 * **未保存かどうかとは無関係の数**であることに注意（Monaco の `getVersionId()`）。
 * 保存の有無で戻ることは無く、編集のたびに増える。Editor の未保存判定に使う
 * `getAlternativeVersionId()` は Undo で戻るため、こちらへは渡らない
 * （renderer/src/editor/monaco/documentStore.ts）。
 */
export function isTextDocumentVersion(value: unknown): value is number {
  return isNonNegativeInteger(value)
}

function isTextDocumentPosition(value: unknown): value is TextDocumentPosition {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const position = value as { readonly line: unknown; readonly character: unknown }

  return isNonNegativeInteger(position.line) && isNonNegativeInteger(position.character)
}

function isTextDocumentRange(value: unknown): value is TextDocumentRange {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const range = value as { readonly start: unknown; readonly end: unknown }

  return isTextDocumentPosition(range.start) && isTextDocumentPosition(range.end)
}

/**
 * 境界の外から届いた値が変更1件として扱えるか。
 *
 * 形だけを見る（範囲が文書の中に収まっているかは見ない）。**収まりを確かめられるのは
 * 中身を持っている側だけ**で、Main は文書の本文を持たないため
 * （main/lsp/documentSync.ts）。範囲が外れていた場合に困るのは
 * Language Server の側で、その扱いはサーバが決める。
 */
export function isTextDocumentContentChange(value: unknown): value is TextDocumentContentChange {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const change = value as { readonly range: unknown; readonly text: unknown }

  if (typeof change.text !== 'string') {
    return false
  }

  return change.range === null || isTextDocumentRange(change.range)
}
