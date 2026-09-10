import type { DebugBreakpointVerification } from './breakpointModel'

/**
 * DAP の `setBreakpoints` 1往復ぶんの形（Electron / fs 非依存・テスト対象）。
 *
 * ## ここが「絶対パスは Main の中だけ」の実体
 *
 * DAP は文書を **`Source.path`（絶対パス）**で指す。Renderer には絶対パスが無い
 * （docs/ARCHITECTURE.md §20.9）。したがって変換はどうしても Main で起きる ──
 * その1箇所をここと breakpointSource.ts に閉じる。
 *
 * ```
 * Renderer   … "src/app.js" の 12 行目を入れ替えて
 *    ↓ IPC（debug:toggle-breakpoint）
 * main/debug/breakpointSource.ts … D:\proj + "src/app.js" → D:\proj\src\app.js
 *    ↓
 * ここ       … { source: { path: … }, breakpoints: [{ line: 12 }] }
 *    ↓
 * Debug Adapter
 * ```
 *
 * LSP が `file:` URI を組み立てるのに対し、DAP は**素の絶対パス**を渡す
 * （`Source.path` は URI ではない）。この差は adapter の仕様そのもので、
 * どちらも Renderer には現れない。
 *
 * ## `lines` も一緒に送る
 *
 * `SetBreakpointsArguments` には `breakpoints`（新しい形）と `lines`（旧い形）が
 * あり、仕様上は前者だけで足りる。それでも両方を載せるのは、**古い adapter が
 * `lines` しか読まない**ことがあるためで、DAP の仕様書自身が
 * 「クライアントは互換のために両方を送ってよい」としている。
 * 中身は同じ行の並びなので、食い違いは起きない。
 *
 * ## `sourceModified` は常に false
 *
 * 「送っている内容がディスク上のファイルと違う（未保存の編集がある）」を伝える欄で、
 * v1 では常に false にする。true にすると adapter によっては breakpoint を
 * 一切 verify しなくなり、**未保存のファイルでは印がすべて灰色になる。**
 * このアプリは未保存でも印を置けることを優先し、行がずれる可能性は
 * verified の答えとして表に出す。
 */

export interface DapSourceReference {
  /** **絶対パス。** Renderer には出ない（このファイルの冒頭）。 */
  readonly path: string
  /** 画面表示用の名前。adapter によっては `path` より優先して出す。 */
  readonly name: string
}

export interface DapSourceBreakpoint {
  /** 1起点の行番号。 */
  readonly line: number
}

export interface DapSetBreakpointsArguments {
  readonly source: DapSourceReference
  readonly breakpoints: readonly DapSourceBreakpoint[]
  /** 旧い形の adapter 向け（上記）。 */
  readonly lines: readonly number[]
  readonly sourceModified: false
}

/** 1ファイルぶんの `setBreakpoints` の引数を組み立てる。 */
export function createSetBreakpointsArguments(
  source: DapSourceReference,
  lines: readonly number[]
): DapSetBreakpointsArguments {
  return {
    source,
    breakpoints: lines.map((line) => ({ line })),
    lines: [...lines],
    sourceModified: false
  }
}

/** adapter の文言の上限。桁違いに長いものはログを埋めるだけなので切る。 */
export const DAP_BREAKPOINT_MESSAGE_MAX_LENGTH = 500

/**
 * `setBreakpoints` の応答を読む。
 *
 * ## 読めなければ null
 *
 * 相手は別のプロセスで、仕様どおりの応答が来るとは限らない。**null は
 * 「答えが無かった」**を意味し、呼ぶ側はその全件を「まだ分からない」へ戻す
 * （main/debug/breakpointModel.ts の `applyDebugBreakpointVerification`）。
 * 落ちないことと、間違った印を出さないことの両方をここで担保する。
 *
 * ## `verified` を持たない要素は「置けなかった」ではない
 *
 * 仕様上 `verified` は必須だが、省く adapter が実在する。**欠けている場合は
 * false（置けなかった）ではなく、要素そのものを「分からない」として返す**
 * ── 省略を失敗と読むと、正常に動いている adapter で全部が灰色になる。
 */
export function parseSetBreakpointsResponse(
  body: unknown,
  expected: number
): readonly (DebugBreakpointVerification | null)[] | null {
  if (typeof body !== 'object' || body === null || !('breakpoints' in body)) {
    return null
  }

  const raw = (body as { readonly breakpoints: unknown }).breakpoints

  if (!Array.isArray(raw)) {
    return null
  }

  const results: (DebugBreakpointVerification | null)[] = []

  for (let index = 0; index < expected; index += 1) {
    results.push(parseBreakpoint(raw[index]))
  }

  return results
}

function parseBreakpoint(value: unknown): DebugBreakpointVerification | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  const record = value as {
    readonly verified?: unknown
    readonly line?: unknown
    readonly message?: unknown
  }

  if (typeof record.verified !== 'boolean') {
    return null
  }

  return {
    verified: record.verified,
    line:
      typeof record.line === 'number' && Number.isSafeInteger(record.line) && record.line > 0
        ? record.line
        : null,
    message: typeof record.message === 'string' ? truncateMessage(record.message) : null
  }
}

function truncateMessage(message: string): string {
  const trimmed = message.replace(/\s+/g, ' ').trim()

  if (trimmed.length === 0) {
    return ''
  }

  return trimmed.length <= DAP_BREAKPOINT_MESSAGE_MAX_LENGTH
    ? trimmed
    : `${trimmed.slice(0, DAP_BREAKPOINT_MESSAGE_MAX_LENGTH)}...`
}
