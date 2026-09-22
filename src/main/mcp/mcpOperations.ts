import type { LanguageId } from '@shared/language'
import type { McpConnectionFailure, McpConfigProblem } from '@shared/mcp'
import type { McpToolCallResult } from './mcpClient'
import { isRecord } from './mcpMessage'

/**
 * MCP の「操作」（ツール呼び出し1回分の決まり。MCP 共通。Electron 非依存・テスト対象）。
 *
 * ## Main の中だけの手続き
 *
 * Renderer からツールを呼ぶ IPC は無い。操作を実行するのは Main の中の呼び手
 * （将来の MCP Gateway。FN Agent からは Security Core を通す。DESIGN.md §6）だけで、
 * ここの型もすべて Main の中だけで使う。
 *
 * ```
 * 呼び手が渡せる   … 接続 id・操作名（その接続の表にあるもの）・引数
 * 操作の表が決める … どのツールを・どんな引数で呼ぶか・結果をどう読むか
 * ```
 *
 * ツール名と引数をそのまま通す形にすると、呼び手がサーバーの公開する
 * **すべて**のツール（削除・移動を含む）を好きな引数で呼べるようになる。
 * 操作の表に載せたものだけが呼べ、引数は操作ごとに形を確かめてから
 * ツールの引数へ組み立て直す（届いた値をそのまま渡さない）。
 *
 * ## 書き込みは実行の前に確かめる
 *
 * `kind: 'write'` の操作は、サーバーを起動する前に `confirmWrite` を挟む
 * （mcpConnections.ts）。今は MCP の書き込みを許可する経路が無いので、
 * mcpService.ts は常に断る（DESIGN.md §6: v1 では MCP の書き込みは使わない）。
 *
 * ## 結果は読み替えてから渡す
 *
 * サーバーの生の結果は呼び手へ渡さない。操作ごとに必要な項目だけを
 * JSON で表せる形へ読み替える（`readResult`）。読めなければ `invalid-result`。
 */

/** 操作の種類。`write` は実行の前に `confirmWrite` を挟む。 */
export type McpOperationKind = 'read' | 'write'

/** 操作の結果として呼び手へ渡す値（JSON で表せるものだけ）。 */
export type McpJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly McpJsonValue[]
  | { readonly [key: string]: McpJsonValue }

/** 操作が失敗した理由（接続の失敗に、ツールの呼び出しに固有のものを足したもの）。 */
export type McpOperationFailure =
  | McpConnectionFailure
  /** サーバーがその操作に使うツールを公開していなかった（サーバーの版の違いなど）。 */
  | 'tool-unavailable'
  /** ツールが失敗を返した（相手の API が断った・対象が無い・権限が無い）。 */
  | 'tool-error'
  /** ツールの結果が読めなかった。 */
  | 'invalid-result'
  /**
   * 書き込みの操作で、要求を送った後に時間切れ・サーバーの終了・読めない応答が起きた。
   * 相手には届いて反映されたかもしれない ── やり直す前に、相手の側で確かめる
   * （そのままやり直すと二重に書き込みうる）。
   */
  | 'outcome-unknown'

/**
 * ツールが失敗を返したときの、外へ出してよい手がかり。
 *
 * 相手の API の番号と分類だけで、本文（エラーの文）は渡さない。
 */
export interface McpToolErrorSummary {
  readonly status: number | null
  readonly code: string | null
}

/** 操作1回の結末。 */
export type McpOperationResult =
  | { readonly outcome: 'completed'; readonly operation: string; readonly data: McpJsonValue }
  /** 書き込みの確認で、実行しないと決まった。何も送っていない。 */
  | { readonly outcome: 'declined'; readonly operation: string }
  | {
      readonly outcome: 'not-configured'
      readonly operation: string
      readonly problems: readonly McpConfigProblem[]
    }
  | {
      readonly outcome: 'failed'
      readonly operation: string
      readonly failure: McpOperationFailure
      readonly toolError: McpToolErrorSummary | null
    }

/** 引数の検証の結末。`reason` は呼び手の不具合を追うための文で、値そのものは含めない。 */
export type McpArgumentsParse<A> =
  { readonly ok: true; readonly value: A } | { readonly ok: false; readonly reason: string }

/** 書き込みの確認に出す文。 */
export interface McpOperationDescription {
  readonly title: string
  readonly detail: string
}

export interface McpOperationDefinition<A> {
  readonly kind: McpOperationKind
  /** 呼ぶツールの名前（サーバーが公開しているものと一致しなければ `tool-unavailable`）。 */
  readonly tool: string
  readonly parseArguments: (raw: unknown) => McpArgumentsParse<A>
  /** 確かめた引数から、ツールへ渡す引数を組み立てる。 */
  readonly toolArguments: (args: A) => Readonly<Record<string, unknown>>
  /** ツールの結果を呼び手へ渡す形へ読み替える。読めなければ null。 */
  readonly readResult: (result: McpToolCallResult, args: A) => McpJsonValue | null
  /**
   * ツールの結果が失敗を表しているかを読む。失敗なら手がかり（番号と分類だけ）、
   * 失敗でなければ null。
   *
   * MCP では失敗を `isError: true` で返す決まりだが、そうしないサーバーがある
   * （API のエラーを普通の結果として返す）。`isError` が無くても、
   * ここが null 以外を返せば失敗として扱う（mcpConnections.ts）。
   */
  readonly readToolError?: (result: McpToolCallResult) => McpToolErrorSummary | null
  /** 書き込みの確認に出す文（`write` のときだけ使う）。 */
  readonly describe?: (args: A, language: LanguageId) => McpOperationDescription
}

/**
 * 表に並べるための形。`A` を消しておく（表は操作ごとに引数の型が違う）。
 *
 * `defineMcpOperation` を通して作れば、中の関数どうしの引数の型は揃っている
 * ── 実行する側は `parseArguments` が返した値をそのまま他の関数へ渡すだけなので、
 * `unknown` で受けても食い違わない。
 */
export interface AnyMcpOperationDefinition {
  readonly kind: McpOperationKind
  readonly tool: string
  readonly parseArguments: (raw: unknown) => McpArgumentsParse<unknown>
  readonly toolArguments: (args: unknown) => Readonly<Record<string, unknown>>
  readonly readResult: (result: McpToolCallResult, args: unknown) => McpJsonValue | null
  readonly readToolError?: (result: McpToolCallResult) => McpToolErrorSummary | null
  readonly describe?: (args: unknown, language: LanguageId) => McpOperationDescription
}

export function defineMcpOperation<A>(
  definition: McpOperationDefinition<A>
): AnyMcpOperationDefinition {
  if (definition.kind === 'write' && definition.describe === undefined) {
    // 確認に出す文が無い書き込みは作らせない（表の書き漏れ）。
    throw new Error(`MCP write operation for "${definition.tool}" needs a description.`)
  }

  return definition as unknown as AnyMcpOperationDefinition
}

/** 表を引く（`Object.hasOwn` で、`toString` のような継承した名前を拾わない）。 */
export function findMcpOperation(
  table: Readonly<Record<string, AnyMcpOperationDefinition>>,
  name: unknown
): AnyMcpOperationDefinition | null {
  return typeof name === 'string' && Object.hasOwn(table, name) ? (table[name] ?? null) : null
}

/**
 * 呼び手の要求が表に合わなかった（知らない操作名・壊れた引数）。
 * 利用者に起きることではなく呼び手の不具合にあたる。
 */
export class McpRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpRequestError'
  }
}

/* ------------------------------------------------------------------ 引数を確かめる道具 */

/**
 * 引数が「決まった名前だけを持つ object」か。知らない名前が混ざっていたら断る
 * ── 黙って捨てると、呼び手が送ったつもりの値が効いていないことに気づけない。
 */
export function readArgumentObject(
  raw: unknown,
  allowed: readonly string[]
): McpArgumentsParse<Readonly<Record<string, unknown>>> {
  if (!isRecord(raw)) {
    return { ok: false, reason: 'arguments must be an object.' }
  }

  const unknownKeys = Object.keys(raw).filter((key) => !allowed.includes(key))

  if (unknownKeys.length > 0) {
    return { ok: false, reason: `unknown argument(s): ${unknownKeys.join(', ')}.` }
  }

  return { ok: true, value: raw }
}

export interface StringArgumentRule {
  readonly minLength: number
  readonly maxLength: number
  /** 改行（\n）を許すか。 */
  readonly multiline: boolean
}

/**
 * 文字列の引数。前後の空白を落とし、長さと制御文字を確かめる。
 * 長さは UTF-16 の単位ではなく文字（コードポイント）で数える。
 */
export function readStringArgument(
  args: Readonly<Record<string, unknown>>,
  key: string,
  rule: StringArgumentRule
): McpArgumentsParse<string> {
  const raw = args[key]

  if (typeof raw !== 'string') {
    return { ok: false, reason: `"${key}" must be a string.` }
  }

  const value = raw.trim()
  const length = [...value].length

  if (length < rule.minLength || length > rule.maxLength) {
    return {
      ok: false,
      reason: `"${key}" must be ${rule.minLength}-${rule.maxLength} characters.`
    }
  }

  const control = rule.multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/

  if (control.test(value)) {
    return { ok: false, reason: `"${key}" contains control characters.` }
  }

  return { ok: true, value }
}

/* ------------------------------------------------------------------ 結果を読む道具 */

/**
 * 結果の文字の `content` を JSON として読む（多くの MCP サーバーは、API の応答を
 * JSON の文字列として1つ目の `text` に入れて返す）。読めなければ null。
 */
export function readJsonTextContent(result: McpToolCallResult): unknown {
  const text = result.texts[0]

  if (text === undefined) {
    return null
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}
