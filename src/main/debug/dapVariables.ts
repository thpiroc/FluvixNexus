import {
  DEBUG_VARIABLE_VALUE_MAX_LENGTH,
  type DebugScope,
  type DebugScopeKind,
  type DebugVariable,
  type DebugVariableKind
} from '@shared/debug'
import { sanitizeLabel } from './dapThreads'

/**
 * DAP `scopes` / `variables` request / response（Session 6-6。純粋・テスト対象）。
 *
 * 別プロセスから来る応答なので、読める欄だけを採る。**`variablesReference` は
 * ここで Renderer 形から切り離す** ── 戻り値は「Main が控える番号」と「Renderer へ
 * 渡してよい形」の組で、handle を発行して組み合わせるのは main/debug/variables.ts になる。
 *
 * 採らない欄: `evaluateName` / `memoryReference` / `declarationLocationReference` /
 * `valueLocationReference` / `Scope.source` / `line` / `column` / `presentationHint` の生の値。
 */

export interface DapScopesArguments {
  readonly frameId: number
}

export interface DapVariablesArguments {
  readonly variablesReference: number
  readonly start?: number
  readonly count?: number
}

/** Renderer 形（handle 抜き）と、Main が控える `variablesReference` の組。 */
export interface DapScopeEntry {
  /** 0 は「子が無い」。 */
  readonly reference: number
  readonly scope: Omit<DebugScope, 'handle'>
}

export interface DapVariableEntry {
  /** 0 は葉。 */
  readonly reference: number
  readonly variable: Omit<DebugVariable, 'handle'>
}

export interface DapParsedList<T> {
  readonly entries: readonly T[]
  /** 上限より多く届いた（上限までしか読んでいない）。 */
  readonly truncated: boolean
}

const SCOPE_KINDS: ReadonlySet<string> = new Set<DebugScopeKind>([
  'arguments',
  'locals',
  'registers',
  'returnValue'
])

const VARIABLE_KINDS: ReadonlySet<string> = new Set<DebugVariableKind>([
  'property',
  'method',
  'class',
  'data',
  'event',
  'baseClass',
  'innerClass',
  'interface',
  'mostDerivedClass',
  'virtual'
])

export function createScopesArguments(frameId: number): DapScopesArguments {
  return { frameId }
}

/**
 * `variables` の引数。
 *
 * `start` / `count` は **`supportsVariablePaging` を名乗る adapter にだけ**載せる
 * （名乗らない adapter はこの欄を読まない ── DAP の仕様）。`count` を上限より1つ多く
 * 頼むのは、上限を超えたかどうかを応答の長さで知るため。名乗らない adapter からは
 * 全件が返りうるので、どちらの場合も読む側（`parseVariablesResponse`）で切る。
 */
export function createVariablesArguments(
  variablesReference: number,
  supportsPaging: boolean,
  limit: number
): DapVariablesArguments {
  return supportsPaging
    ? { variablesReference, start: 0, count: limit + 1 }
    : { variablesReference }
}

export function readSupportsVariablePaging(initializeBody: unknown): boolean {
  if (typeof initializeBody !== 'object' || initializeBody === null) {
    return false
  }

  return (
    (initializeBody as { readonly supportsVariablePaging?: unknown }).supportsVariablePaging ===
    true
  )
}

export function parseScopesResponse(
  body: unknown,
  limit: number
): DapParsedList<DapScopeEntry> | null {
  const raw = readArray(body, 'scopes')

  return raw === null ? null : parseList(raw, limit, parseScope)
}

export function parseVariablesResponse(
  body: unknown,
  limit: number
): DapParsedList<DapVariableEntry> | null {
  const raw = readArray(body, 'variables')

  return raw === null ? null : parseList(raw, limit, parseVariable)
}

function parseList<T>(
  raw: readonly unknown[],
  limit: number,
  parse: (value: unknown) => T | null
): DapParsedList<T> {
  /*
    **上限より先は読みもしない。** 壊れた adapter が 100 万件を返しても、
    Main が正規化するのは上限ぶんだけで済む。
  */
  const entries = raw.slice(0, limit).flatMap((value) => {
    const parsed = parse(value)

    return parsed === null ? [] : [parsed]
  })

  return { entries, truncated: raw.length > limit }
}

function parseScope(value: unknown): DapScopeEntry | null {
  if (!isRecord(value)) {
    return null
  }

  return {
    reference: readReference(value.variablesReference),
    scope: {
      name: sanitizeLabel(value.name, 'Scope'),
      kind: readScopeKind(value.presentationHint),
      expensive: value.expensive === true,
      namedCount: readCount(value.namedVariables),
      indexedCount: readCount(value.indexedVariables)
    }
  }
}

function parseVariable(value: unknown): DapVariableEntry | null {
  if (!isRecord(value)) {
    return null
  }

  const type = sanitizeLabel(value.type, '')

  return {
    reference: readReference(value.variablesReference),
    variable: {
      name: sanitizeLabel(value.name, '(unnamed)'),
      value: sanitizeVariableValue(value.value),
      type: type === '' ? null : type,
      kind: readVariableKind(value.presentationHint),
      namedCount: readCount(value.namedVariables),
      indexedCount: readCount(value.indexedVariables)
    }
  }
}

/**
 * 表示用の値。
 *
 * 利用者のプログラムの中身なので**意味は変えない**（空白を詰めない・引用符を外さない）。
 * 行の中に収まるよう制御文字だけを空白に置き換え、長すぎるものは切り詰める。
 */
export function sanitizeVariableValue(raw: unknown): string {
  if (typeof raw !== 'string') {
    return ''
  }

  const flat = raw.replace(/\0/g, '').replace(/[-]/g, ' ')

  return flat.length <= DEBUG_VARIABLE_VALUE_MAX_LENGTH
    ? flat
    : `${flat.slice(0, DEBUG_VARIABLE_VALUE_MAX_LENGTH)}…`
}

/** 読めない `variablesReference` は 0（葉）に畳む ── 変数そのものは表示に残す。 */
function readReference(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
}

function readCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function readScopeKind(value: unknown): DebugScopeKind {
  return typeof value === 'string' && SCOPE_KINDS.has(value) ? (value as DebugScopeKind) : 'other'
}

function readVariableKind(value: unknown): DebugVariableKind {
  if (!isRecord(value)) {
    return 'other'
  }

  const kind = value.kind

  return typeof kind === 'string' && VARIABLE_KINDS.has(kind)
    ? (kind as DebugVariableKind)
    : 'other'
}

function readArray(body: unknown, key: 'scopes' | 'variables'): readonly unknown[] | null {
  if (!isRecord(body)) {
    return null
  }

  const value = body[key]

  return Array.isArray(value) ? value : null
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
