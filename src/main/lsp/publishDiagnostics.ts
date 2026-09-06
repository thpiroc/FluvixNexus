import {
  LSP_DIAGNOSTIC_MESSAGE_MAX_LENGTH,
  LSP_DIAGNOSTICS_MAX_PER_DOCUMENT,
  type LspDiagnostic,
  type LspDiagnosticSeverity,
  type LspDiagnosticTag,
  type TextDocumentRange
} from '@shared/lsp'

/**
 * `textDocument/publishDiagnostics` の中身を読む（依存なし・テスト対象）。
 *
 * ## 相手を信じない
 *
 * これは**別のプロセスが送ってきた JSON** で、境界の外から届く値になる。
 * 型注釈を当てて済ませると、そのまま Renderer まで運ばれ、最後は Monaco が
 * `undefined.startLineNumber` を読むことになる。
 *
 * したがって読み方を1箇所に閉じ、次のようにする。
 *
 * ```
 * 全体が読めない      … null（1通まるごと捨てる）
 * 1件が読めない       … その1件だけ捨てて、残りは通す
 * 欄が欠けている      … 既定値へ寄せる（severity 無し → error）
 * 桁違いに多い / 長い … 上限で切る（shared/lsp/diagnostic.ts）
 * ```
 *
 * 1件の不備で1通を捨てないのは、**指摘が出ないことも1つの誤り**だからにほかならない
 * ── 読めた指摘は出したほうが利用者の役に立つ。
 *
 * ## LSP の数を、ここで名前へ直す
 *
 * `severity: 1` や `tags: [1]` のような数を Renderer まで持ち込まない
 * （shared/lsp/diagnostic.ts）。**確かめたなら、確かめ終えた形で渡す。**
 *
 * ## 位置は 0 起点のまま
 *
 * Monaco の 1 起点へ直すのは Renderer の仕事（Session 5-2 の差分と同じく、
 * 変換の向きを1方向に保つ）。ここは範囲が**数として読めるか**だけを見る。
 */

/** 1通ぶん。 */
export interface PublishedDiagnostics {
  /** サーバが指した URI。相対位置へ落とすのは呼び出し側（documentUri.ts）。 */
  readonly uri: string
  /** 計算に使われた文書の版。サーバが言わなければ null。 */
  readonly version: number | null
  readonly diagnostics: readonly LspDiagnostic[]
}

/** LSP の severity（1〜4）と、こちらの名前の対応。 */
const SEVERITY_BY_NUMBER: Readonly<Record<number, LspDiagnosticSeverity>> = {
  1: 'error',
  2: 'warning',
  3: 'information',
  4: 'hint'
}

/** LSP の tag（1〜2）と、こちらの名前の対応。 */
const TAG_BY_NUMBER: Readonly<Record<number, LspDiagnosticTag>> = {
  1: 'unnecessary',
  2: 'deprecated'
}

/**
 * 深刻度が省略されたときの扱い。
 *
 * 仕様上はクライアントが決めてよいことになっている。**一番強いものへ寄せる**のは、
 * 見落として困るのは常に error の側だからで、VS Code も同じ扱いをする。
 */
const DEFAULT_SEVERITY: LspDiagnosticSeverity = 'error'

export function parsePublishDiagnosticsParams(params: unknown): PublishedDiagnostics | null {
  if (typeof params !== 'object' || params === null) {
    return null
  }

  const raw = params as {
    readonly uri: unknown
    readonly version: unknown
    readonly diagnostics: unknown
  }

  if (typeof raw.uri !== 'string' || raw.uri.length === 0) {
    return null
  }

  /*
    `diagnostics` が配列でないものは、1通として読めていない。
    **空配列とは違う**（空配列は「問題が無い」という意味を持つ）ので、
    ここで null にして捨てる。
  */
  if (!Array.isArray(raw.diagnostics)) {
    return null
  }

  const diagnostics: LspDiagnostic[] = []

  for (const entry of raw.diagnostics) {
    if (diagnostics.length >= LSP_DIAGNOSTICS_MAX_PER_DOCUMENT) {
      break
    }

    const diagnostic = parseDiagnostic(entry)

    if (diagnostic !== null) {
      diagnostics.push(diagnostic)
    }
  }

  return {
    uri: raw.uri,
    version: isSafeInteger(raw.version) ? raw.version : null,
    diagnostics
  }
}

function parseDiagnostic(value: unknown): LspDiagnostic | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const raw = value as {
    readonly range: unknown
    readonly severity: unknown
    readonly message: unknown
    readonly source: unknown
    readonly code: unknown
    readonly tags: unknown
  }

  const range = parseRange(raw.range)

  // 範囲が読めない指摘は置き場所が無い。出しようがないので捨てる。
  if (range === null) {
    return null
  }

  if (typeof raw.message !== 'string') {
    return null
  }

  return {
    range,
    severity: parseSeverity(raw.severity),
    message: trimMessage(raw.message),
    source: typeof raw.source === 'string' && raw.source.length > 0 ? raw.source : null,
    code: parseCode(raw.code),
    tags: parseTags(raw.tags)
  }
}

function parseRange(value: unknown): TextDocumentRange | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const raw = value as { readonly start: unknown; readonly end: unknown }
  const start = parsePosition(raw.start)
  const end = parsePosition(raw.end)

  if (start === null || end === null) {
    return null
  }

  return { start, end }
}

function parsePosition(
  value: unknown
): { readonly line: number; readonly character: number } | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const raw = value as { readonly line: unknown; readonly character: unknown }

  if (!isSafeInteger(raw.line) || !isSafeInteger(raw.character)) {
    return null
  }

  /*
    負の位置は「読めなかった」ではなく「あり得ない」。0 へ寄せる ── 捨てると、
    その1件だけが出なくなる（相手の数え間違いを、指摘を隠す理由にしない）。
  */
  return { line: Math.max(0, raw.line), character: Math.max(0, raw.character) }
}

function parseSeverity(value: unknown): LspDiagnosticSeverity {
  if (!isSafeInteger(value)) {
    return DEFAULT_SEVERITY
  }

  return SEVERITY_BY_NUMBER[value] ?? DEFAULT_SEVERITY
}

/**
 * 番号や記号。
 *
 * LSP では文字列にも数にもなる。**どちらも文字列にして運ぶ** ──
 * 使うのは表示だけで、Renderer 側で型を分ける意味が無い。
 */
function parseCode(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.length === 0 ? null : trimMessage(value)
  }

  return isSafeInteger(value) ? String(value) : null
}

function parseTags(value: unknown): readonly LspDiagnosticTag[] {
  if (!Array.isArray(value)) {
    return []
  }

  const tags: LspDiagnosticTag[] = []

  for (const entry of value) {
    if (!isSafeInteger(entry)) {
      continue
    }

    const tag = TAG_BY_NUMBER[entry]

    // 知らない印は捨てる。同じ印を2つ載せない。
    if (tag !== undefined && !tags.includes(tag)) {
      tags.push(tag)
    }
  }

  return tags
}

/**
 * 本文を上限で切る。
 *
 * 長い本文は実際にある（TypeScript の型の不一致は、型そのものを全部書き出す）。
 * 切っても意味が残るように**末尾に印を付ける** ── 途中で切れていることが
 * 分からないと、利用者は「これで全部だ」と読んでしまう。
 */
function trimMessage(message: string): string {
  if (message.length <= LSP_DIAGNOSTIC_MESSAGE_MAX_LENGTH) {
    return message
  }

  return `${message.slice(0, LSP_DIAGNOSTIC_MESSAGE_MAX_LENGTH)}…`
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}
