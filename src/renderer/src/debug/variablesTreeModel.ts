import type {
  DebugScope,
  DebugScopesResult,
  DebugVariable,
  DebugVariableHandle,
  DebugVariablesResult,
  DebugVariablesUnavailableReason
} from '@shared/debug'

/**
 * Variables tree の状態と、行への展開（Session 6-6。純粋・テスト対象）。
 *
 * Files の FileTreeModel は FileEntry 専用なので使わない。こちらは
 * 「Scope → Variable → Variable …」を **handle 単位で lazy に** 読むだけの軽い形にした。
 *
 * - 子は**開いたときに初めて**読む（ツリー全体を最初から辿らない）
 * - 読んだ子は閉じても控えておく（同じ停止の中で開き直しても往復しない）
 * - 停止・frame が変わったら状態ごと捨てる（捨てるのは呼び出し側。VariablesView が
 *   snapshot の版と frame を key にして作り直す）
 *
 * handle は Main が停止ごとに発行した不透明な文字列で、tree の中で重ならない
 * （同じオブジェクトを2箇所で開いても、別々の handle が発行される）。
 */

export type VariablesLoad<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ok'; readonly items: readonly T[]; readonly truncated: boolean }
  | { readonly status: 'unavailable'; readonly reason: DebugVariablesUnavailableReason }

export interface VariablesTreeState {
  readonly scopes: VariablesLoad<DebugScope>
  readonly children: ReadonlyMap<DebugVariableHandle, VariablesLoad<DebugVariable>>
  readonly expanded: ReadonlySet<DebugVariableHandle>
}

export const INITIAL_VARIABLES_TREE: VariablesTreeState = {
  scopes: { status: 'loading' },
  children: new Map(),
  expanded: new Set()
}

export type VariablesTreeNotice = 'loading' | 'empty' | 'unavailable' | 'truncated'

export type VariablesTreeRow =
  | {
      readonly kind: 'scope'
      readonly key: string
      readonly depth: number
      readonly scope: DebugScope
      readonly expanded: boolean
      readonly parentKey: null
    }
  | {
      readonly kind: 'variable'
      readonly key: string
      readonly depth: number
      readonly variable: DebugVariable
      readonly expanded: boolean
      readonly parentKey: string
    }
  | {
      readonly kind: 'notice'
      readonly key: string
      readonly depth: number
      readonly notice: VariablesTreeNotice
      readonly reason: DebugVariablesUnavailableReason | null
      readonly parentKey: string
    }

export function applyScopesResult(
  state: VariablesTreeState,
  result: DebugScopesResult
): VariablesTreeState {
  return {
    ...state,
    scopes:
      result.status === 'ok'
        ? { status: 'ok', items: result.scopes, truncated: false }
        : { status: 'unavailable', reason: result.reason }
  }
}

/**
 * 最初に自動で開く Scope。**重くない最初の1つだけ**（VS Code と同じ考え方）。
 * `expensive` の Scope は利用者が開いたときにだけ読む。
 */
export function selectInitialScopeHandle(
  scopes: readonly DebugScope[]
): DebugVariableHandle | null {
  return scopes.find((scope) => scope.handle !== null && !scope.expensive)?.handle ?? null
}

/** 開くと子を読みに行く必要があるか（未読・読めなかった）。 */
export function needsChildren(state: VariablesTreeState, handle: DebugVariableHandle): boolean {
  const load = state.children.get(handle)

  return load === undefined || load.status === 'unavailable'
}

export function expandNode(
  state: VariablesTreeState,
  handle: DebugVariableHandle
): VariablesTreeState {
  const expanded = new Set(state.expanded)
  expanded.add(handle)

  if (!needsChildren(state, handle)) {
    return { ...state, expanded }
  }

  const children = new Map(state.children)
  children.set(handle, { status: 'loading' })

  return { ...state, expanded, children }
}

export function collapseNode(
  state: VariablesTreeState,
  handle: DebugVariableHandle
): VariablesTreeState {
  if (!state.expanded.has(handle)) {
    return state
  }

  const expanded = new Set(state.expanded)
  expanded.delete(handle)

  return { ...state, expanded }
}

/**
 * 子の応答を当てる。**読みに行っている最中のものにだけ**当てる ──
 * 閉じて開き直した・既に読めているところへ遅れた応答が来ても、控えを上書きしない。
 */
export function applyChildrenResult(
  state: VariablesTreeState,
  handle: DebugVariableHandle,
  result: DebugVariablesResult
): VariablesTreeState {
  if (state.children.get(handle)?.status !== 'loading') {
    return state
  }

  const children = new Map(state.children)
  children.set(
    handle,
    result.status === 'ok'
      ? { status: 'ok', items: result.variables, truncated: result.truncated }
      : { status: 'unavailable', reason: result.reason }
  )

  return { ...state, children }
}

/** 画面に並べる行。開いている handle だけを辿る。 */
export function flattenVariablesTree(state: VariablesTreeState): readonly VariablesTreeRow[] {
  if (state.scopes.status !== 'ok') {
    return []
  }

  const rows: VariablesTreeRow[] = []

  state.scopes.items.forEach((scope, index) => {
    const key = scope.handle ?? `scope:${String(index)}`
    const expanded = scope.handle !== null && state.expanded.has(scope.handle)

    rows.push({ kind: 'scope', key, depth: 0, scope, expanded, parentKey: null })

    if (expanded && scope.handle !== null) {
      appendChildren(state, scope.handle, key, 1, rows)
    }
  })

  return rows
}

function appendChildren(
  state: VariablesTreeState,
  handle: DebugVariableHandle,
  parentKey: string,
  depth: number,
  rows: VariablesTreeRow[]
): void {
  const load = state.children.get(handle) ?? { status: 'loading' as const }

  if (load.status === 'loading') {
    rows.push(notice(parentKey, depth, 'loading', null))
    return
  }

  if (load.status === 'unavailable') {
    rows.push(notice(parentKey, depth, 'unavailable', load.reason))
    return
  }

  if (load.items.length === 0) {
    rows.push(notice(parentKey, depth, load.truncated ? 'truncated' : 'empty', null))
    return
  }

  load.items.forEach((variable, index) => {
    const key = variable.handle ?? `${parentKey}/${String(index)}`
    const expanded = variable.handle !== null && state.expanded.has(variable.handle)

    rows.push({ kind: 'variable', key, depth, variable, expanded, parentKey })

    if (expanded && variable.handle !== null) {
      appendChildren(state, variable.handle, key, depth + 1, rows)
    }
  })

  if (load.truncated) {
    rows.push(notice(parentKey, depth, 'truncated', null))
  }
}

function notice(
  parentKey: string,
  depth: number,
  kind: VariablesTreeNotice,
  reason: DebugVariablesUnavailableReason | null
): VariablesTreeRow {
  return { kind: 'notice', key: `${parentKey}#${kind}`, depth, notice: kind, reason, parentKey }
}
