import {
  LSP_RENAME_MAX_DOCUMENTS,
  LSP_RENAME_MAX_EDITS_PER_DOCUMENT,
  LSP_RENAME_MAX_TOTAL_EDITS,
  LSP_RENAME_TEXT_MAX_LENGTH,
  type LspRenameDocumentEdit,
  type LspRenameRejection,
  type LspRenameTextEdit,
  type TextDocumentPosition,
  type TextDocumentRange
} from '@shared/lsp'
import { toWorkspaceRelativePath } from './documentUri'

/**
 * サーバが返した `prepareRename` / `rename` の答えを読む（fs / child_process 非依存・テスト対象）。
 *
 * ## ここが Session 5-9 の境界そのもの
 *
 * 他の機能の parse（hoverResult / navigationResult / formattingResult）は
 * 「読めないものを捨てる」で足りた ── 捨てた結果として出るのは、
 * Hover が空になる・移動先が1つ減る、という**見え方の欠け**にすぎない。
 *
 * Rename は違う。捨てた1件は**書き換えられなかった参照**になり、
 * 残るのは「片側だけ名前が変わったコード」にほかならない。
 * だからここは捨てずに、**要求ごと断る**。
 *
 * ```
 * 読めない edit が1件でもある      → 全部やめる（malformed）
 * Workspace の外を指す URI が1つ   → 全部やめる（outside-workspace）
 * ファイルの作成 / 改名 / 削除     → 全部やめる（unsupported-edit）
 * 範囲が重なっている               → 全部やめる（malformed）
 * 上限を超えた                     → 全部やめる（too-many-edits）
 * ```
 *
 * ## `documentChanges` と `changes` の2つの形が来る
 *
 * LSP の `WorkspaceEdit` は同じことを2通りで表せる。
 *
 * ```
 * changes         … { "file:///…/a.ts": [TextEdit, …], … }
 * documentChanges … [ { textDocument: {uri, version}, edits: [...] }, … ]
 *                   ここに CreateFile / RenameFile / DeleteFile が混ざりうる
 * ```
 *
 * どちらを返すかはサーバが決める（クライアントの申告次第。
 * main/lsp/initializeParams.ts では `documentChanges: false` /
 * `resourceOperations: []` と名乗っているので、素直なサーバは `changes` を返す）。
 * それでも両方を読むのは、**名乗りに従わないサーバでも安全側に倒れる**ようにするため
 * ── 申告は約束だが、こちらの守りを申告に賭けない。
 *
 * `documentChanges` に `kind` を持つ要素（＝資源操作）が1つでもあれば、
 * TextEdit の側が正しくてもすべて断る。**「使える部分だけ適用する」を
 * しないことが、この関数の一番の仕事**にあたる。
 *
 * ## 版（`textDocument.version`）は見ない
 *
 * `documentChanges` の各文書には、サーバが見ていた版が載ることがある。
 * ここで突き合わせないのは、Main が持っているのが**要求した1文書の版だけ**で、
 * 他のファイルの版を知らないため（開いていないファイルには版が無い）。
 * 要求した文書が古くなっていないかは呼び出し側が見る（main/lsp/rename.ts）。
 */

export type ParsedPrepareRename =
  | {
      readonly status: 'ok'
      /** null なら「範囲はクライアントが決めてよい」（`defaultBehavior`）。 */
      readonly range: TextDocumentRange | null
      readonly placeholder: string | null
    }
  | { readonly status: 'rejected'; readonly reason: LspRenameRejection }

export type ParsedRename =
  | { readonly status: 'ok'; readonly documents: readonly LspRenameDocumentEdit[] }
  | { readonly status: 'rejected'; readonly reason: LspRenameRejection }

/**
 * `textDocument/prepareRename` の答え。
 *
 * 3つの形が来る（LSP 3.16 以降）。
 *
 * ```
 * Range                              … その範囲の名前を変えられる
 * { range, placeholder }             … 上に、入力欄の初期値が付く
 * { defaultBehavior: boolean }       … true なら「変えられる。範囲は任せる」
 * null                               … その位置では変えられない
 * ```
 */
export function parsePrepareRenameResult(result: unknown): ParsedPrepareRename {
  if (result === null || result === undefined) {
    return { status: 'rejected', reason: 'not-renameable' }
  }

  if (typeof result !== 'object') {
    return { status: 'rejected', reason: 'malformed' }
  }

  const raw = result as {
    readonly start: unknown
    readonly end: unknown
    readonly range: unknown
    readonly placeholder: unknown
    readonly defaultBehavior: unknown
  }

  if (typeof raw.defaultBehavior === 'boolean') {
    return raw.defaultBehavior
      ? { status: 'ok', range: null, placeholder: null }
      : { status: 'rejected', reason: 'not-renameable' }
  }

  // `{ range, placeholder }` の形。
  if (raw.range !== undefined) {
    const range = parseRange(raw.range)

    if (range === null) {
      return { status: 'rejected', reason: 'malformed' }
    }

    return {
      status: 'ok',
      range,
      placeholder: typeof raw.placeholder === 'string' ? raw.placeholder : null
    }
  }

  // 素の Range。
  const range = parseRange(result)

  return range === null
    ? { status: 'rejected', reason: 'malformed' }
    : { status: 'ok', range, placeholder: null }
}

/**
 * `textDocument/rename` の答え（＝ `WorkspaceEdit`）。
 *
 * 通ったものだけが Renderer へ渡り、そこには相対位置と TextEdit しか無い。
 */
export function parseRenameResult(rootPath: string, result: unknown): ParsedRename {
  // 変えるところが無い、というのは失敗ではない。
  if (result === null || result === undefined) {
    return { status: 'ok', documents: [] }
  }

  if (typeof result !== 'object') {
    return { status: 'rejected', reason: 'malformed' }
  }

  const raw = result as { readonly documentChanges: unknown; readonly changes: unknown }

  if (raw.documentChanges !== undefined && raw.documentChanges !== null) {
    return parseDocumentChanges(rootPath, raw.documentChanges)
  }

  if (raw.changes !== undefined && raw.changes !== null) {
    return parseChanges(rootPath, raw.changes)
  }

  /*
    `{}` は「何も変えるところが無い」を表す形として実際に返ってくる。
    ここを malformed にすると、変えるものが無かっただけの Rename が
    「壊れた応答」として出ることになる。
  */
  return { status: 'ok', documents: [] }
}

/* ----------------------------------------------------------- documentChanges */

function parseDocumentChanges(rootPath: string, value: unknown): ParsedRename {
  if (!Array.isArray(value)) {
    return { status: 'rejected', reason: 'malformed' }
  }

  const collector = createCollector()

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      return { status: 'rejected', reason: 'malformed' }
    }

    const change = entry as {
      readonly kind: unknown
      readonly textDocument: unknown
      readonly edits: unknown
    }

    /*
      `kind` を持つのは CreateFile / RenameFile / DeleteFile の3つだけ
      （TextDocumentEdit は `kind` を持たない）。Session 5-9 はどれも扱わない。

      **中身を見ずに断つ**のが要点で、「create だけなら安全か」といった
      判断をここに置かない ── 扱えない形が来たことだけが分かればよい。
    */
    if (change.kind !== undefined) {
      return { status: 'rejected', reason: 'unsupported-edit' }
    }

    if (typeof change.textDocument !== 'object' || change.textDocument === null) {
      return { status: 'rejected', reason: 'malformed' }
    }

    const { uri } = change.textDocument as { readonly uri: unknown }
    const relativePath = toWorkspaceRelativePath(rootPath, uri)

    if (relativePath === null) {
      return { status: 'rejected', reason: 'outside-workspace' }
    }

    const outcome = collector.add(relativePath, change.edits)

    if (outcome !== null) {
      return outcome
    }
  }

  return collector.finish()
}

/* ------------------------------------------------------------------ changes */

function parseChanges(rootPath: string, value: unknown): ParsedRename {
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'rejected', reason: 'malformed' }
  }

  const collector = createCollector()

  for (const [uri, edits] of Object.entries(value as Record<string, unknown>)) {
    const relativePath = toWorkspaceRelativePath(rootPath, uri)

    if (relativePath === null) {
      return { status: 'rejected', reason: 'outside-workspace' }
    }

    const outcome = collector.add(relativePath, edits)

    if (outcome !== null) {
      return outcome
    }
  }

  return collector.finish()
}

/* ---------------------------------------------------------------- 積み上げ */

interface RenameCollector {
  /** 1ファイルぶんを足す。断るときだけ結末を返す（通れば null）。 */
  readonly add: (relativePath: string, rawEdits: unknown) => ParsedRename | null
  readonly finish: () => ParsedRename
}

interface DocumentAccumulator {
  readonly edits: LspRenameTextEdit[]
  /** 既に積んだ置き換えの鍵（範囲 + 文字列）。重複を捨てるために持つ。 */
  readonly seen: Set<string>
}

function createCollector(): RenameCollector {
  const documents = new Map<string, DocumentAccumulator>()
  let total = 0

  return {
    add: (relativePath, rawEdits) => {
      if (!Array.isArray(rawEdits)) {
        return { status: 'rejected', reason: 'malformed' }
      }

      const existing = documents.get(relativePath)
      const accumulator: DocumentAccumulator = existing ?? { edits: [], seen: new Set() }

      if (existing === undefined) {
        if (documents.size >= LSP_RENAME_MAX_DOCUMENTS) {
          return { status: 'rejected', reason: 'too-many-edits' }
        }

        documents.set(relativePath, accumulator)
      }

      for (const raw of rawEdits) {
        const edit = parseTextEdit(raw)

        if (edit === null) {
          return { status: 'rejected', reason: 'malformed' }
        }

        /*
          同じ範囲へ同じ文字列を置く重複は捨てる。サーバが同じ参照を
          2通りの経路で数えた場合に実際に届く形で、**重なりとしては扱わない**
          ── 適用しても結果が変わらないため。
        */
        const key = editKey(edit)

        if (accumulator.seen.has(key)) {
          continue
        }

        if (accumulator.edits.length >= LSP_RENAME_MAX_EDITS_PER_DOCUMENT) {
          return { status: 'rejected', reason: 'too-many-edits' }
        }

        total += 1

        if (total > LSP_RENAME_MAX_TOTAL_EDITS) {
          return { status: 'rejected', reason: 'too-many-edits' }
        }

        accumulator.seen.add(key)
        accumulator.edits.push(edit)
      }

      return null
    },

    finish: () => {
      const result: LspRenameDocumentEdit[] = []

      for (const [relativePath, accumulator] of documents) {
        // 変えるところが1つも無いファイルは載せない（Renderer が開き直す理由が無い）。
        if (accumulator.edits.length === 0) {
          continue
        }

        const sorted = [...accumulator.edits].sort((a, b) => compareRanges(a.range, b.range))

        if (hasOverlap(sorted)) {
          return { status: 'rejected', reason: 'malformed' }
        }

        result.push({ relativePath, edits: sorted })
      }

      return { status: 'ok', documents: result }
    }
  }
}

/* -------------------------------------------------------------------- 素材 */

function parseTextEdit(value: unknown): LspRenameTextEdit | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const raw = value as { readonly range: unknown; readonly newText: unknown }

  if (typeof raw.newText !== 'string' || raw.newText.length > LSP_RENAME_TEXT_MAX_LENGTH) {
    return null
  }

  const range = parseRange(raw.range)

  return range === null ? null : { range, text: raw.newText }
}

function parseRange(value: unknown): TextDocumentRange | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const raw = value as { readonly start: unknown; readonly end: unknown }
  const start = parsePosition(raw.start)
  const end = parsePosition(raw.end)

  // 終わりが始まりより手前にある範囲は、置き換え先として読めない。
  if (start === null || end === null || comparePositions(start, end) > 0) {
    return null
  }

  return { start, end }
}

function parsePosition(value: unknown): TextDocumentPosition | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const raw = value as { readonly line: unknown; readonly character: unknown }

  if (!isSafeInteger(raw.line) || !isSafeInteger(raw.character)) {
    return null
  }

  return { line: Math.max(0, raw.line), character: Math.max(0, raw.character) }
}

function editKey(edit: LspRenameTextEdit): string {
  const { range } = edit

  return [
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
    edit.text
  ].join('\0')
}

/** 並べ替えた後の隣同士だけを見ればよい（重なりは必ず隣に現れる）。 */
function hasOverlap(sorted: readonly LspRenameTextEdit[]): boolean {
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!
    const current = sorted[index]!

    if (comparePositions(current.range.start, previous.range.end) < 0) {
      return true
    }

    /*
      同じ位置へ入れる長さ0の置き換えが2件。範囲としては重ならないが、
      どちらを先に入れるかで結果が変わる ── 順番で結果が決まるものは断る。
    */
    if (
      comparePositions(current.range.start, current.range.end) === 0 &&
      comparePositions(previous.range.start, previous.range.end) === 0 &&
      comparePositions(current.range.start, previous.range.start) === 0
    ) {
      return true
    }
  }

  return false
}

function compareRanges(a: TextDocumentRange, b: TextDocumentRange): number {
  const start = comparePositions(a.start, b.start)

  return start === 0 ? comparePositions(a.end, b.end) : start
}

function comparePositions(a: TextDocumentPosition, b: TextDocumentPosition): number {
  return a.line === b.line ? a.character - b.character : a.line - b.line
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}
