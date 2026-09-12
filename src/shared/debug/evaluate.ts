/**
 * Evaluate の Renderer-safe domain model（Session 6-7）。
 *
 * 止まっている Debug Session に対して、選んでいる stack frame の文脈で式を1つ評価する。
 * Session 6-8 の Debug Console と、その先の Watch が乗る土台にあたる。
 *
 * ## ここに無いもの
 *
 * ```
 * DAP の request 名 / 任意の command … 無い（口は機能ごとに固定。§20.9）
 * raw frameId                        … 無い（渡すのは Call Stack snapshot に載っていた frame）
 * variablesReference                 … 無い（Main の handle 表の中だけ。Session 6-6 と同じ）
 * memoryReference                    … 無い（memory read/write は STEP 6 の範囲外）
 * valueLocationReference             … 無い（位置を解く口を作らない）
 * presentationHint の生の値          … 無い（Session 6-6 と同じ閉じた集合 `kind` へ畳む）
 * adapter が返した失敗の文言          … 無い（絶対パスを含みうる。Main のログにだけ残す）
 * ```
 *
 * 評価した**値**（`value`）は利用者のプログラムの中身で、絶対パスを含むこともある。
 * これは Session 6-6 の `DebugVariable.value` と同じく**表示するだけの文字列**で、
 * Renderer がそこから何かを起こす経路は無い（docs/ARCHITECTURE.md §20.9 の例外と同じ線）。
 */

import type { DebugVariableHandle, DebugVariableKind } from './variables'

/**
 * 評価の文脈（DAP `EvaluateArguments.context`）。
 *
 * DAP が挙げるのは `watch` / `repl` / `hover` / `clipboard` / `variables` と任意の文字列だが、
 * **Renderer から任意の文字列を渡せる形にはしない** ── 文脈は adapter の振る舞い
 * （副作用を許すか・表示をどう整えるか）を変える入力で、そこが自由記述になれば
 * 「adapter に何を頼めるか」を Renderer が決めることになる。
 *
 * Session 6-7 で通すのは2つだけ。
 *
 * ```
 * repl  … 利用者が式を打って評価した。副作用のある式もありうる（Session 6-7 の UI / 6-8 の Debug Console）
 * watch … 監視式として評価した。adapter は副作用を避け、表示も簡潔にする
 * ```
 *
 * 入れていないもの: `hover`（Editor の hover 評価は STEP 6 に無い）・`clipboard`
 * （コピー用の整形。コピーの口が無い）・`variables`（Variables tree の再評価。
 * 6-6 の `variables` request で足りている）。増やすときは設計へ戻る。
 */
export type DebugEvaluateContext = 'repl' | 'watch'

/** 閉じた集合（Main の翻訳表がこれを網羅していることをテストで固定する）。 */
export const DEBUG_EVALUATE_CONTEXTS: readonly DebugEvaluateContext[] = ['repl', 'watch']

/**
 * 式の長さの上限（文字数）。
 *
 * 手で打つ式にも、Debug Console へ貼り付ける式にも十分な長さで、
 * かつ **adapter へ無制限の文字列を流さない**ための線になる。
 */
export const DEBUG_EVALUATE_EXPRESSION_MAX_LENGTH = 2_000

/**
 * 評価できた値。
 *
 * 形は `DebugVariable` に揃えてある（`name` が無いだけ）── 展開できる値は
 * **Session 6-6 と同じ handle** を持ち、そのまま `listVariables` の経路へ載る。
 */
export interface DebugEvaluateValue {
  /**
   * 子を読むための handle（Session 6-6 と同じ Main-owned handle）。
   *
   * 展開できない値（DAP の `variablesReference = 0`）は null。この停止で発行できる
   * handle の上限に達していたときも null になり、葉として表示される。
   */
  readonly handle: DebugVariableHandle | null
  /** 表示用の値（DAP `EvaluateResponse.result`）。長すぎる値は Main が切り詰める。 */
  readonly value: string
  readonly type: string | null
  readonly kind: DebugVariableKind
  readonly namedCount: number | null
  readonly indexedCount: number | null
}

/**
 * 評価できなかった理由。
 *
 * Session 6-6（`DebugVariablesUnavailableReason`）の語彙に `timeout` を足しただけになる。
 *
 * - `not-stopped` … 止まっている Debug Session が無い
 * - `stale`       … frame が今の停止のものでない / 答えが返る前に停止が変わった
 * - `failed`      … adapter が断った / 応答が壊れていた / 要求の形が壊れていた
 * - `timeout`     … 待てる時間のうちに adapter が答えなかった
 */
export type DebugEvaluateUnavailableReason = 'not-stopped' | 'stale' | 'failed' | 'timeout'

export type DebugEvaluateResult =
  | { readonly status: 'ok'; readonly value: DebugEvaluateValue }
  | { readonly status: 'unavailable'; readonly reason: DebugEvaluateUnavailableReason }

/** 通してよい文脈か。閉じた集合の外は Main が受け付けない。 */
export function isDebugEvaluateContext(value: unknown): value is DebugEvaluateContext {
  return (
    typeof value === 'string' && DEBUG_EVALUATE_CONTEXTS.includes(value as DebugEvaluateContext)
  )
}

/**
 * 式として受け付ける形か。
 *
 * **意味は変えない**（trim しない・整形しない）── 利用者が打った式をそのまま adapter へ渡す。
 * 断るのは3つだけ:
 *
 * - 文字列でない
 * - 空白しかない（adapter へ送っても意味が無く、押し間違いと区別が付かない）
 * - 上限より長い / NUL を含む（NUL は電文に載せられる形にならない）
 */
export function isDebugEvaluateExpressionShape(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= DEBUG_EVALUATE_EXPRESSION_MAX_LENGTH &&
    !value.includes('\0')
  )
}
