import { type DebugEvaluateContext, type DebugEvaluateValue } from '@shared/debug'
import { sanitizeLabel } from './dapThreads'
import {
  readReference,
  readVariableCount,
  readVariableKind,
  sanitizeVariableValue
} from './dapVariables'

/**
 * DAP `evaluate` request / response（Session 6-7。純粋・テスト対象）。
 *
 * Session 6-6 の dapVariables.ts と同じ形で、**`variablesReference` を Renderer 形から
 * 切り離す** ── 戻り値は「Main が控える番号」と「Renderer へ渡してよい形」の組で、
 * handle を発行して組み合わせるのは main/debug/evaluate.ts になる。
 *
 * 採らない欄: `memoryReference` / `valueLocationReference` / `presentationHint` の生の値。
 *
 * ## 文脈の翻訳表
 *
 * app-domain の `DebugEvaluateContext` と DAP の `context` は**別のもの**として扱う。
 * 今は同じ綴りだが、`stepOver` → `next`（Session 6-4）と同じく **Renderer の言葉を
 * そのまま電文へ流す経路は作らない** ── 表を1つ通す形にしておくと、値を足すときに
 * 必ずここへ来ることになる。
 */

export interface DapEvaluateArguments {
  readonly expression: string
  readonly frameId: number
  readonly context: string
}

/** Renderer 形（handle 抜き）と、Main が控える `variablesReference` の組。 */
export interface DapEvaluateEntry {
  /** 0 は「展開できない」。 */
  readonly reference: number
  readonly value: Omit<DebugEvaluateValue, 'handle'>
}

const DAP_EVALUATE_CONTEXTS: Readonly<Record<DebugEvaluateContext, string>> = {
  repl: 'repl',
  watch: 'watch'
}

/**
 * `evaluate` の引数。
 *
 * `frameId` は **Main が Session 6-5 の経路で確かめた frame** の id で、Renderer から
 * 届いた数がそのまま入ることは無い（main/debug/evaluate.ts）。frame を省いた
 * global evaluate は作らない ── 止まっていない間に評価できる口を開かないため。
 */
export function createEvaluateArguments(
  expression: string,
  frameId: number,
  context: DebugEvaluateContext
): DapEvaluateArguments {
  return { expression, frameId, context: DAP_EVALUATE_CONTEXTS[context] }
}

/**
 * `evaluate` の応答。
 *
 * DAP は `result`（文字列）と `variablesReference`（数）を必須としている。
 * **`result` が読めない応答は壊れているものとして断る** ── 空文字は正当な結果
 * （`undefined` を表示しない adapter がある）なので、型だけで見る。
 */
export function parseEvaluateResponse(body: unknown): DapEvaluateEntry | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null
  }

  const record = body as Readonly<Record<string, unknown>>

  if (typeof record.result !== 'string') {
    return null
  }

  const type = sanitizeLabel(record.type, '')

  return {
    reference: readReference(record.variablesReference),
    value: {
      value: sanitizeVariableValue(record.result),
      type: type === '' ? null : type,
      kind: readVariableKind(record.presentationHint),
      namedCount: readVariableCount(record.namedVariables),
      indexedCount: readVariableCount(record.indexedVariables)
    }
  }
}
