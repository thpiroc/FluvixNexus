/**
 * Variables / Scopes の Renderer-safe domain model（Session 6-6）。
 *
 * DAP の Scope / Variable をそのまま渡さない。特に `variablesReference` は adapter が
 * 配る不透明な数で、Renderer に渡すと「任意の番号を指定して中身を読む口」になる。
 * Main はそれを自分の表に控え、Renderer へは **Main が発行した handle** だけを渡す。
 *
 * ## ここに無いもの
 *
 * ```
 * variablesReference             … Main の handle 表の中だけ
 * memoryReference                … 無い（memory read/write は STEP 6 の範囲外）
 * evaluateName                   … 無い（evaluate は Session 6-7。境界はそちらで決める）
 * declaration / valueLocationReference … 無い（位置を解く口を作らない）
 * Scope.source / line / column   … 無い（絶対パス・file URI を含みうる）
 * presentationHint の生の値      … 無い（閉じた集合 `kind` へ畳む）
 * ```
 *
 * 値（`value`）は利用者のプログラムの中身で、絶対パスを含むこともある。これは
 * Debug Console の出力と同じく**表示するだけの文字列**で、Renderer がそこから
 * 何かを起こす経路は無い（docs/ARCHITECTURE.md §20.9 の例外と同じ線）。長さだけを整える。
 */

/**
 * Main が発行した Scope / Variable の handle。
 *
 * **不透明な文字列として扱う。** 数値でないのは、DAP の `variablesReference`
 * と取り違えられないようにするため（Main は数値を handle として受け付けない）。
 * 停止が変わると以前の handle はすべて無効になる。
 */
export type DebugVariableHandle = string

/** Scope の種類。DAP `Scope.presentationHint` のうち、表示に使う意味だけを閉じた集合にした。 */
export type DebugScopeKind = 'arguments' | 'locals' | 'registers' | 'returnValue' | 'other'

/** Variable の種類。DAP `VariablePresentationHint.kind` のうち、表示に使う意味だけを閉じた集合にした。 */
export type DebugVariableKind =
  | 'property'
  | 'method'
  | 'class'
  | 'data'
  | 'event'
  | 'baseClass'
  | 'innerClass'
  | 'interface'
  | 'mostDerivedClass'
  | 'virtual'
  | 'other'

export interface DebugScope {
  /** 子を読むための handle。adapter が中身を持たないと答えた Scope は null。 */
  readonly handle: DebugVariableHandle | null
  readonly name: string
  readonly kind: DebugScopeKind
  /** 読むのが重い Scope。自動では開かない。 */
  readonly expensive: boolean
  /** adapter が名乗った子の数（名乗らなければ null）。 */
  readonly namedCount: number | null
  readonly indexedCount: number | null
}

export interface DebugVariable {
  /** 子を読むための handle。葉（`variablesReference = 0`）は null。 */
  readonly handle: DebugVariableHandle | null
  readonly name: string
  /** 表示用の値。長すぎる値は Main が切り詰める。 */
  readonly value: string
  readonly type: string | null
  readonly kind: DebugVariableKind
  readonly namedCount: number | null
  readonly indexedCount: number | null
}

/**
 * 読めなかった理由。
 *
 * - `not-stopped` … 止まっている Debug Session が無い
 * - `stale`       … handle / frame が今の停止のものでない（再開した・次の停止が来た・Workspace が変わった）
 * - `failed`      … adapter が断った / 応答が壊れていた（adapter の文言は Main のログにだけ残す）
 * - `limit`       … この停止で発行できる handle の上限に達した
 */
export type DebugVariablesUnavailableReason = 'not-stopped' | 'stale' | 'failed' | 'limit'

export type DebugScopesResult =
  | { readonly status: 'ok'; readonly scopes: readonly DebugScope[] }
  | { readonly status: 'unavailable'; readonly reason: DebugVariablesUnavailableReason }

export type DebugVariablesResult =
  | {
      readonly status: 'ok'
      readonly variables: readonly DebugVariable[]
      /** 上限で切った（すべては表示していない）。 */
      readonly truncated: boolean
    }
  | { readonly status: 'unavailable'; readonly reason: DebugVariablesUnavailableReason }

/** 1回の応答で Renderer へ渡す Scope / Variable の上限。 */
export const DEBUG_VARIABLES_MAX_PER_RESPONSE = 500

/** 1回の停止で Main が発行する handle の上限。 */
export const DEBUG_VARIABLE_HANDLES_MAX_PER_STOP = 5_000

/** 表示する値の長さの上限（文字数）。 */
export const DEBUG_VARIABLE_VALUE_MAX_LENGTH = 1_000

/** handle の文字列の長さの上限。これを超えるものは形として受け付けない。 */
export const DEBUG_VARIABLE_HANDLE_MAX_LENGTH = 64

/**
 * handle として受け付ける形か。**数値（生の `variablesReference`）は通さない。**
 *
 * 形が合っても今の表にあるとは限らない ── それを確かめるのは Main（main/debug/variables.ts）。
 */
export function isDebugVariableHandleShape(value: unknown): value is DebugVariableHandle {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= DEBUG_VARIABLE_HANDLE_MAX_LENGTH
  )
}
