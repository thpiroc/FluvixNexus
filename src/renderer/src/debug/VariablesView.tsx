import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent
} from 'react'
import type {
  DebugScopesResult,
  DebugVariableHandle,
  DebugVariablesResult,
  DebugVariablesUnavailableReason
} from '@shared/debug'
import { fluvix } from '../api/fluvix'
import { useI18n } from '../i18n/context'
import type { TFunction, TranslationKey } from '../i18n/messages'
import { useCallStack } from './callStackContext'
import {
  INITIAL_VARIABLES_TREE,
  applyChildrenResult,
  applyScopesResult,
  collapseNode,
  expandNode,
  flattenVariablesTree,
  needsChildren,
  selectInitialScopeHandle,
  type VariablesTreeRow,
  type VariablesTreeState
} from './variablesTreeModel'
import './debug.css'

/**
 * Variables（Session 6-6）。Call Stack で選んでいる frame の Scope と、その下の変数を出す。
 *
 * **tree は snapshot の版と frame を key にして作り直す。** Continue / Step / 次の停止 /
 * Workspace の切り替えで Call Stack snapshot が差し替わると版が進み、前の tree は
 * 読みかけの応答ごと捨てられる（unmount した tree へ届いた応答は当てない）。
 * Main の側でも handle は同じ時点で無効になっているので、古い handle で頼んでも
 * `stale` が返るだけで adapter へは届かない。
 */
export function VariablesView(): JSX.Element {
  const { snapshot, version, selectedFrameId } = useCallStack()
  const { t } = useI18n()

  if (snapshot.status === 'loading') {
    return <p className="fx-debug-variables__notice">{t('debug.variables.loading')}</p>
  }

  if (snapshot.status === 'idle') {
    return <p className="fx-debug-variables__notice">{t('debug.variables.notStopped')}</p>
  }

  if (selectedFrameId === null) {
    return <p className="fx-debug-variables__notice">{t('debug.variables.noFrame')}</p>
  }

  return (
    <VariablesTree
      key={`${String(version)}:${String(selectedFrameId)}`}
      frameId={selectedFrameId}
    />
  )
}

function VariablesTree({ frameId }: { readonly frameId: number }): JSX.Element {
  const { t } = useI18n()
  const [state, setState] = useState<VariablesTreeState>(INITIAL_VARIABLES_TREE)
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const rowElements = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadChildren = useCallback((handle: DebugVariableHandle) => {
    void requestVariables(handle).then((result) => {
      if (mountedRef.current) {
        setState((current) => applyChildrenResult(current, handle, result))
      }
    })
  }, [])

  useEffect(() => {
    let disposed = false

    void requestScopes(frameId).then((result) => {
      if (disposed) {
        return
      }

      const initial = result.status === 'ok' ? selectInitialScopeHandle(result.scopes) : null

      setState((current) => {
        const withScopes = applyScopesResult(current, result)

        return initial === null ? withScopes : expandNode(withScopes, initial)
      })

      if (initial !== null) {
        loadChildren(initial)
      }
    })

    return () => {
      disposed = true
    }
  }, [frameId, loadChildren])

  const toggle = useCallback(
    (handle: DebugVariableHandle) => {
      if (state.expanded.has(handle)) {
        setState((current) => collapseNode(current, handle))
        return
      }

      const fetch = needsChildren(state, handle)

      setState((current) => expandNode(current, handle))

      if (fetch) {
        loadChildren(handle)
      }
    },
    [state, loadChildren]
  )

  if (state.scopes.status === 'loading') {
    return <p className="fx-debug-variables__notice">{t('debug.variables.loading')}</p>
  }

  if (state.scopes.status === 'unavailable') {
    return (
      <p className="fx-debug-variables__notice">{t(unavailableMessage(state.scopes.reason))}</p>
    )
  }

  if (state.scopes.items.length === 0) {
    return <p className="fx-debug-variables__notice">{t('debug.variables.noScopes')}</p>
  }

  const rows = flattenVariablesTree(state)
  const focusable = rows.filter((row) => row.kind !== 'notice')
  const tabStop = focusable.some((row) => row.key === focusedKey)
    ? focusedKey
    : (focusable[0]?.key ?? null)

  function focusRow(key: string | null): void {
    if (key === null) {
      return
    }

    setFocusedKey(key)
    rowElements.current.get(key)?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>, row: VariablesTreeRow): void {
    const index = focusable.findIndex((candidate) => candidate.key === row.key)
    const handle = rowHandle(row)

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        focusRow(focusable[index + 1]?.key ?? null)
        return

      case 'ArrowUp':
        event.preventDefault()
        focusRow(focusable[index - 1]?.key ?? null)
        return

      case 'Home':
        event.preventDefault()
        focusRow(focusable[0]?.key ?? null)
        return

      case 'End':
        event.preventDefault()
        focusRow(focusable.at(-1)?.key ?? null)
        return

      case 'ArrowRight':
        event.preventDefault()

        if (handle !== null && !rowExpanded(row)) {
          toggle(handle)
          return
        }

        if (handle !== null) {
          const next = focusable[index + 1]

          if (next !== undefined && next.parentKey === row.key) {
            focusRow(next.key)
          }
        }
        return

      case 'ArrowLeft':
        event.preventDefault()

        if (handle !== null && rowExpanded(row)) {
          toggle(handle)
          return
        }

        focusRow(row.parentKey)
        return

      case 'Enter':
      case ' ':
        event.preventDefault()

        if (handle !== null) {
          toggle(handle)
        }
        return

      default:
        return
    }
  }

  return (
    <div className="fx-debug-variables" role="tree" aria-label={t('debug.variables.aria')}>
      {rows.map((row) => {
        if (row.kind === 'notice') {
          return (
            <div
              key={row.key}
              role="none"
              className="fx-debug-variables__row fx-debug-variables__row--notice"
              style={depthStyle(row.depth)}
            >
              {noticeText(row, t)}
            </div>
          )
        }

        const handle = rowHandle(row)
        const expanded = rowExpanded(row)

        return (
          <div
            key={row.key}
            ref={(element) => {
              if (element === null) {
                rowElements.current.delete(row.key)
              } else {
                rowElements.current.set(row.key, element)
              }
            }}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-expanded={handle === null ? undefined : expanded}
            aria-selected={row.key === tabStop}
            tabIndex={row.key === tabStop ? 0 : -1}
            className="fx-debug-variables__row"
            data-kind={row.kind}
            data-expandable={handle !== null}
            style={depthStyle(row.depth)}
            title={row.kind === 'variable' ? variableTitle(row) : undefined}
            onClick={() => {
              setFocusedKey(row.key)

              if (handle !== null) {
                toggle(handle)
              }
            }}
            onFocus={() => {
              setFocusedKey(row.key)
            }}
            onKeyDown={(event) => handleKeyDown(event, row)}
          >
            <span className="fx-debug-variables__twisty" aria-hidden="true">
              {handle === null ? '' : expanded ? '▾' : '▸'}
            </span>
            {row.kind === 'scope' ? (
              <span className="fx-debug-variables__scope">{row.scope.name}</span>
            ) : (
              <>
                <span className="fx-debug-variables__name">{row.variable.name}</span>
                {row.variable.value !== '' && (
                  <>
                    <span className="fx-debug-variables__separator" aria-hidden="true">
                      :
                    </span>
                    <span className="fx-debug-variables__value">{row.variable.value}</span>
                  </>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

async function requestScopes(frameId: number): Promise<DebugScopesResult> {
  try {
    const result = await fluvix.debug.listScopes({ frameId })

    return result.ok ? result.data.result : { status: 'unavailable', reason: 'failed' }
  } catch {
    return { status: 'unavailable', reason: 'failed' }
  }
}

async function requestVariables(handle: DebugVariableHandle): Promise<DebugVariablesResult> {
  try {
    const result = await fluvix.debug.listVariables({ handle })

    return result.ok ? result.data.result : { status: 'unavailable', reason: 'failed' }
  } catch {
    return { status: 'unavailable', reason: 'failed' }
  }
}

function rowHandle(row: VariablesTreeRow): DebugVariableHandle | null {
  switch (row.kind) {
    case 'scope':
      return row.scope.handle
    case 'variable':
      return row.variable.handle
    case 'notice':
      return null
  }
}

function rowExpanded(row: VariablesTreeRow): boolean {
  return row.kind === 'notice' ? false : row.expanded
}

function variableTitle(row: Extract<VariablesTreeRow, { readonly kind: 'variable' }>): string {
  const { name, type, value } = row.variable

  return type === null ? `${name}: ${value}` : `${name} (${type}): ${value}`
}

function depthStyle(depth: number): CSSProperties {
  return { '--fx-debug-variable-depth': depth } as CSSProperties
}

function unavailableMessage(reason: DebugVariablesUnavailableReason): TranslationKey {
  switch (reason) {
    case 'not-stopped':
      return 'debug.variables.notStopped'
    case 'stale':
      return 'debug.variables.stale'
    case 'failed':
      return 'debug.variables.failed'
    case 'limit':
      return 'debug.variables.limit'
  }
}

function noticeText(
  row: Extract<VariablesTreeRow, { readonly kind: 'notice' }>,
  t: TFunction
): string {
  switch (row.notice) {
    case 'loading':
      return t('debug.variables.loading')
    case 'empty':
      return t('debug.variables.empty')
    case 'truncated':
      return t('debug.variables.truncated')
    case 'unavailable':
      return t(unavailableMessage(row.reason ?? 'failed'))
  }
}
