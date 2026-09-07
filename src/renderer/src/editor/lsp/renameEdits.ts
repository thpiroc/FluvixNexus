import type { LspRenameTextEdit, TextDocumentPosition } from '@shared/lsp'

/**
 * Rename の置き換えを、適用できる形に直す（Monaco 非依存・テスト対象）。
 *
 * ## 適用先が2種類ある
 *
 * Rename は開いていないファイルも書き換える。したがって、同じ TextEdit を
 * 2通りに落とす必要がある。
 *
 * ```
 * 開いているファイル … Monaco の Model へ（1 起点の行・桁へ直す）
 * 開いていないファイル … ディスクの中身へ（文字列の位置へ直す）
 * ```
 *
 * どちらも**この1ファイルに置く**。別々の場所に書くと、範囲の確かめ方が
 * 2通りに分かれる ── 「Model では弾くがディスクでは通る」形が生まれた時点で、
 * 片方のファイルだけが壊れることになる。
 *
 * ## 通らなければ null（捨てない）
 *
 * 1件でも範囲が文書の外を指していれば、その文書ぶんを丸ごと断る。
 * Rename は「全部変わるか、何も変わらないか」でなければ、参照が片側だけ
 * 変わったコードが残る（main/lsp/renameResult.ts の冒頭と同じ判断）。
 *
 * ## 行の数え方は LSP に合わせる
 *
 * 位置は 0 起点、桁は UTF-16 の符号単位（shared/lsp/document.ts）。
 * 行の区切りは `\n` / `\r\n` / `\r` の3つで、`\r\n` は**1つの区切り**として数える
 * ── Monaco も LSP も同じ数え方をするので、開いている側と開いていない側で
 * 行番号がずれない。
 */

export interface EditorRenameRange {
  readonly startLineNumber: number
  readonly startColumn: number
  readonly endLineNumber: number
  readonly endColumn: number
}

export interface EditorRenameEdit {
  readonly range: EditorRenameRange
  readonly text: string
}

/** Model のうち、範囲を確かめるために要る部分だけ。 */
export interface RenameDocumentShape {
  readonly lineCount: number
  readonly getLineMaxColumn: (lineNumber: number) => number
}

/**
 * 開いている文書（Monaco の Model）へ当てる形にする。
 *
 * 範囲が文書の外を指していれば null。並びは位置の順で、互いに重ならない。
 */
export function toEditorRenameEdits(
  edits: readonly LspRenameTextEdit[],
  document: RenameDocumentShape
): readonly EditorRenameEdit[] | null {
  const converted: EditorRenameEdit[] = []

  for (const edit of edits) {
    const range = toEditorRange(edit.range, document)

    if (range === null) {
      return null
    }

    converted.push({ range, text: edit.text })
  }

  const sorted = [...converted].sort((a, b) => compareEditorRanges(a.range, b.range))

  return hasOverlappingRanges(sorted) ? null : sorted
}

/**
 * 開いていないファイル（ディスクの中身）へ当てる。
 *
 * 返るのは置き換えた後の全文。範囲が中身の外を指していれば null。
 *
 * **後ろから当てる。** 前から当てると、1件目の置き換えで長さが変わり、
 * 2件目以降の位置がずれる ── 位置の順に並べてから逆に辿ることで、
 * まだ当てていない範囲の位置が動かない。
 */
export function applyRenameEditsToText(
  text: string,
  edits: readonly LspRenameTextEdit[]
): string | null {
  if (edits.length === 0) {
    return text
  }

  const starts = lineStartOffsets(text)
  const offsets: { readonly start: number; readonly end: number; readonly text: string }[] = []

  for (const edit of edits) {
    const start = toOffset(edit.range.start, starts, text)
    const end = toOffset(edit.range.end, starts, text)

    if (start === null || end === null || start > end) {
      return null
    }

    offsets.push({ start, end, text: edit.text })
  }

  offsets.sort((a, b) => (a.start === b.start ? a.end - b.end : a.start - b.start))

  for (let index = 1; index < offsets.length; index += 1) {
    const previous = offsets[index - 1]!
    const current = offsets[index]!

    // 重なり（同じ位置への長さ0どうしも含む）は当てない。
    if (
      current.start < previous.end ||
      (current.start === previous.start && current.end === previous.end)
    ) {
      return null
    }
  }

  let result = text

  for (let index = offsets.length - 1; index >= 0; index -= 1) {
    const edit = offsets[index]!

    result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`
  }

  return result
}

/* -------------------------------------------------------------------- 素材 */

function toEditorRange(
  range: LspRenameTextEdit['range'],
  document: RenameDocumentShape
): EditorRenameRange | null {
  const start = toEditorPosition(range.start, document)
  const end = toEditorPosition(range.end, document)

  if (start === null || end === null || compareEditorPositions(start, end) > 0) {
    return null
  }

  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column
  }
}

function toEditorPosition(
  position: TextDocumentPosition,
  document: RenameDocumentShape
): { readonly lineNumber: number; readonly column: number } | null {
  const lineNumber = position.line + 1
  const column = position.character + 1

  if (lineNumber < 1 || lineNumber > document.lineCount) {
    return null
  }

  if (column < 1 || column > document.getLineMaxColumn(lineNumber)) {
    return null
  }

  return { lineNumber, column }
}

/**
 * 各行の先頭が、全文の何文字目から始まるか。
 *
 * `\r\n` を1つの区切りとして数える（このファイルの冒頭）。
 */
function lineStartOffsets(text: string): readonly number[] {
  const starts = [0]

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)

    if (code === 10) {
      starts.push(index + 1)
      continue
    }

    if (code === 13) {
      // `\r\n` は2文字で1つの区切り。
      const next = text.charCodeAt(index + 1) === 10 ? index + 2 : index + 1

      starts.push(next)
      index = next - 1
    }
  }

  return starts
}

function toOffset(
  position: TextDocumentPosition,
  starts: readonly number[],
  text: string
): number | null {
  const start = starts[position.line]

  if (start === undefined) {
    return null
  }

  const lineEnd = starts[position.line + 1] ?? text.length
  const offset = start + position.character

  /*
    行の終わりを越える桁は断る。`lineEnd` には区切り文字ぶんが含まれるので、
    その手前までを許す ── 越えているのは、こちらが持っている中身と
    サーバが見ていた中身が食い違っている場合にほかならない。
  */
  const limit = lineEndWithoutBreak(text, start, lineEnd)

  return offset > limit ? null : offset
}

function lineEndWithoutBreak(text: string, start: number, lineEnd: number): number {
  if (lineEnd <= start) {
    return Math.max(start, lineEnd)
  }

  if (text.charCodeAt(lineEnd - 1) === 10) {
    return text.charCodeAt(lineEnd - 2) === 13 && lineEnd - 2 >= start ? lineEnd - 2 : lineEnd - 1
  }

  return text.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd
}

function hasOverlappingRanges(sorted: readonly EditorRenameEdit[]): boolean {
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!
    const current = sorted[index]!

    if (compareEditorPositions(rangeStart(current.range), rangeEnd(previous.range)) < 0) {
      return true
    }
  }

  return false
}

function compareEditorRanges(a: EditorRenameRange, b: EditorRenameRange): number {
  const start = compareEditorPositions(rangeStart(a), rangeStart(b))

  return start === 0 ? compareEditorPositions(rangeEnd(a), rangeEnd(b)) : start
}

function compareEditorPositions(
  a: { readonly lineNumber: number; readonly column: number },
  b: { readonly lineNumber: number; readonly column: number }
): number {
  return a.lineNumber === b.lineNumber ? a.column - b.column : a.lineNumber - b.lineNumber
}

function rangeStart(range: EditorRenameRange): {
  readonly lineNumber: number
  readonly column: number
} {
  return { lineNumber: range.startLineNumber, column: range.startColumn }
}

function rangeEnd(range: EditorRenameRange): {
  readonly lineNumber: number
  readonly column: number
} {
  return { lineNumber: range.endLineNumber, column: range.endColumn }
}
