import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type JSX,
  type KeyboardEvent
} from 'react'
import type {
  DebugConsoleEntry,
  DebugEvaluateResult,
  DebugEvaluateUnavailableReason,
  DebugEvaluateValue,
  DebugVariableHandle,
  DebugVariablesResult,
  DebugVariablesUnavailableReason
} from '@shared/debug'
import { fluvix } from '../api/fluvix'
import { useI18n } from '../i18n/context'
import type { TFunction, TranslationKey } from '../i18n/messages'
import { useWorkspaceFolder } from '../workspaceFolder/context'
import { useCallStack } from './callStackContext'
import {
  INITIAL_VARIABLES_TREE,
  applyChildrenResult,
  collapseNode,
  expandNode,
  flattenVariablesSubtree,
  needsChildren,
  type VariablesTreeRow,
  type VariablesTreeState
} from './variablesTreeModel'
import './debug.css'

type RemoteConsoleEntry = DebugConsoleEntry & {
  readonly kind: 'stdout' | 'stderr' | 'console' | 'error' | 'system'
}

type LocalConsoleEntry =
  | RemoteConsoleEntry
  | {
      readonly id: string
      readonly kind: 'input'
      readonly text: string
      readonly timestamp: number
      readonly source: null
      readonly handle: null
    }
  | {
      readonly id: string
      readonly kind: 'result'
      readonly text: string
      readonly timestamp: number
      readonly source: null
      readonly handle: DebugVariableHandle | null
      readonly expression: string
      readonly result: DebugEvaluateResult
      readonly tree: VariablesTreeState
    }
  | {
      readonly id: string
      readonly kind: 'error' | 'system'
      readonly text: string
      readonly timestamp: number
      readonly source: null
      readonly handle: null
    }

function isRemoteConsoleEntry(entry: DebugConsoleEntry): entry is RemoteConsoleEntry {
  return entry.kind !== 'input' && entry.kind !== 'result'
}

/**
 * Debug Console（Session 6-8）。
 *
 * DAP output event と、Session 6-7 の safe evaluate API を同じ entry list に表示する。
 * 入力は shell へ流さず、選択中の stack frame に対する `debug:evaluate` だけを呼ぶ。
 */
export function DebugConsoleView(): JSX.Element {
  const { t } = useI18n()
  const { workspace } = useWorkspaceFolder()
  const workspaceId = workspace?.id ?? null
  const { snapshot, version, selectedFrameId } = useCallStack()
  const [entries, setEntries] = useState<readonly LocalConsoleEntry[]>([])
  const [expression, setExpression] = useState('')
  const [pending, setPending] = useState(false)
  const [history, setHistory] = useState<readonly string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const nextLocalId = useRef(0)
  const requestRef = useRef(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const mountedRef = useRef(true)
  const workspaceIdRef = useRef<string | null>(workspaceId)

  workspaceIdRef.current = workspaceId

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    setEntries([])
    setPending(false)
    requestRef.current += 1

    if (workspaceId === null) {
      return
    }

    const unsubscribe = fluvix.debug.onConsoleEntry((event) => {
      if (event.workspaceId !== workspaceIdRef.current) {
        return
      }

      if (!isRemoteConsoleEntry(event.entry)) {
        return
      }

      const entry = event.entry

      setEntries((current) => [...current, entry])
    })

    return unsubscribe
  }, [workspaceId])

  useEffect(() => {
    const list = listRef.current

    if (list !== null) {
      list.scrollTop = list.scrollHeight
    }
  }, [entries, pending])

  const loadChildren = useCallback((entryId: string, handle: DebugVariableHandle) => {
    void requestVariables(handle).then((result) => {
      if (!mountedRef.current) {
        return
      }

      setEntries((current) =>
        current.map((entry) =>
          entry.id === entryId && entry.kind === 'result'
            ? { ...entry, tree: applyChildrenResult(entry.tree, handle, result) }
            : entry
        )
      )
    })
  }, [])

  const submitDisabled =
    pending || workspaceId === null || snapshot.status !== 'stopped' || selectedFrameId === null

  function issueLocalId(kind: string): string {
    nextLocalId.current += 1
    return `local-${kind}-${String(nextLocalId.current)}`
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    const sent = expression

    if (submitDisabled || sent.trim() === '') {
      return
    }

    const frameId = selectedFrameId

    if (frameId === null) {
      return
    }

    const sequence = requestRef.current + 1
    requestRef.current = sequence
    setPending(true)
    setExpression('')
    setHistoryIndex(null)
    setHistory((current) => (current.at(-1) === sent ? current : [...current, sent]))
    setEntries((current) => [
      ...current,
      {
        id: issueLocalId('input'),
        kind: 'input',
        text: sent,
        timestamp: Date.now(),
        source: null,
        handle: null
      }
    ])

    void requestEvaluate(sent, frameId).then((result) => {
      if (!mountedRef.current || requestRef.current !== sequence) {
        return
      }

      setPending(false)
      setEntries((current) => [
        ...current,
        {
          id: issueLocalId(result.status === 'ok' ? 'result' : 'error'),
          kind: result.status === 'ok' ? 'result' : 'error',
          text:
            result.status === 'ok'
              ? result.value.value
              : t(evaluateUnavailableMessage(result.reason)),
          timestamp: Date.now(),
          source: null,
          handle: result.status === 'ok' ? result.value.handle : null,
          expression: sent,
          result,
          tree: INITIAL_VARIABLES_TREE
        } as LocalConsoleEntry
      ])
    })
  }

  function clear(): void {
    setEntries([])
  }

  function toggleResult(entryId: string, handle: DebugVariableHandle): void {
    const shouldFetch = entries.some(
      (entry) =>
        entry.id === entryId && entry.kind === 'result' && needsChildren(entry.tree, handle)
    )

    setEntries((current) =>
      current.map((entry) => {
        if (entry.id !== entryId || entry.kind !== 'result') {
          return entry
        }

        return {
          ...entry,
          tree: entry.tree.expanded.has(handle)
            ? collapseNode(entry.tree, handle)
            : expandNode(entry.tree, handle)
        }
      })
    )

    if (shouldFetch) {
      loadChildren(entryId, handle)
    }
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowUp') {
      if (history.length === 0) {
        return
      }

      event.preventDefault()
      const next = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1)
      setHistoryIndex(next)
      setExpression(history[next] ?? '')
      return
    }

    if (event.key === 'ArrowDown') {
      if (historyIndex === null) {
        return
      }

      event.preventDefault()
      const next = historyIndex + 1

      if (next >= history.length) {
        setHistoryIndex(null)
        setExpression('')
      } else {
        setHistoryIndex(next)
        setExpression(history[next] ?? '')
      }
    }
  }

  return (
    <div className="fx-debug-console">
      <div
        ref={listRef}
        className="fx-debug-console__entries"
        role="log"
        aria-label={t('debug.console.aria')}
      >
        {entries.length === 0 ? (
          <p className="fx-debug-console__notice">{t('debug.console.empty')}</p>
        ) : (
          entries.map((entry) => (
            <ConsoleEntryRow
              key={entry.id}
              entry={entry}
              onToggle={(handle) => toggleResult(entry.id, handle)}
            />
          ))
        )}
        {pending && <p className="fx-debug-console__notice">{t('debug.console.evaluating')}</p>}
      </div>
      {workspaceId === null ? (
        <p className="fx-debug-console__notice">{t('workspace.noWorkspaceOpen')}</p>
      ) : snapshot.status !== 'stopped' ? (
        <p className="fx-debug-console__notice">{t('debug.console.notStopped')}</p>
      ) : selectedFrameId === null ? (
        <p className="fx-debug-console__notice">{t('debug.console.noFrame')}</p>
      ) : null}
      <form className="fx-debug-console__form" onSubmit={submit}>
        <input
          type="text"
          className="fx-debug-console__input"
          value={expression}
          aria-label={t('debug.console.label')}
          placeholder={t('debug.console.placeholder')}
          spellCheck={false}
          autoComplete="off"
          disabled={submitDisabled}
          onChange={(event) => {
            setExpression(event.target.value)
            setHistoryIndex(null)
          }}
          onKeyDown={handleInputKeyDown}
        />
        <button
          type="button"
          className="fx-debug-console__button"
          disabled={entries.length === 0}
          onClick={clear}
        >
          {t('debug.console.clear')}
        </button>
      </form>
    </div>
  )
}

function ConsoleEntryRow({
  entry,
  onToggle
}: {
  readonly entry: LocalConsoleEntry
  readonly onToggle: (handle: DebugVariableHandle) => void
}): JSX.Element {
  if (entry.kind === 'result') {
    return <ResultEntry entry={entry} onToggle={onToggle} />
  }

  return (
    <div className="fx-debug-console__entry" data-kind={entry.kind}>
      <span className="fx-debug-console__prefix">{entryPrefix(entry.kind)}</span>
      <span className="fx-debug-console__text">{entry.text}</span>
      {entry.source?.source.kind === 'workspace' && (
        <span className="fx-debug-console__source">
          {entry.source.source.relativePath}
          {entry.source.line === null ? '' : `:${String(entry.source.line)}`}
        </span>
      )}
    </div>
  )
}

function ResultEntry({
  entry,
  onToggle
}: {
  readonly entry: Extract<LocalConsoleEntry, { readonly kind: 'result' }>
  readonly onToggle: (handle: DebugVariableHandle) => void
}): JSX.Element {
  const { t } = useI18n()

  if (entry.result.status === 'unavailable') {
    return (
      <div className="fx-debug-console__entry" data-kind="error">
        <span className="fx-debug-console__prefix">{entryPrefix('error')}</span>
        <span className="fx-debug-console__text">
          {t(evaluateUnavailableMessage(entry.result.reason))}
        </span>
      </div>
    )
  }

  const { value } = entry.result
  const handle = value.handle
  const expanded = handle !== null && entry.tree.expanded.has(handle)
  const rows = handle === null ? [] : flattenVariablesSubtree(entry.tree, handle, entry.id)

  return (
    <div className="fx-debug-console__result">
      <div
        className="fx-debug-console__entry"
        data-kind="result"
        data-expandable={handle !== null}
        title={valueTitle(entry.expression, value)}
        onClick={() => {
          if (handle !== null) {
            onToggle(handle)
          }
        }}
      >
        <span className="fx-debug-variables__twisty" aria-hidden="true">
          {handle === null ? '' : expanded ? '▾' : '▸'}
        </span>
        <span className="fx-debug-console__prefix">{entryPrefix('result')}</span>
        <span className="fx-debug-console__expression">{entry.expression}</span>
        <span className="fx-debug-variables__separator" aria-hidden="true">
          :
        </span>
        <span className="fx-debug-console__text">{value.value}</span>
        {value.type !== null && <span className="fx-debug-console__type">{`(${value.type})`}</span>}
      </div>
      {rows.map((row) => (
        <div
          key={row.key}
          className={rowClassName(row)}
          data-kind={row.kind}
          style={depthStyle(row.depth)}
          onClick={() => {
            const child = rowHandle(row)

            if (child !== null) {
              onToggle(child)
            }
          }}
        >
          <span className="fx-debug-variables__twisty" aria-hidden="true">
            {rowTwisty(row, entry.tree)}
          </span>
          {row.kind === 'notice' ? (
            noticeText(row, t)
          ) : row.kind === 'variable' ? (
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
          ) : (
            <span className="fx-debug-variables__scope">{row.scope.name}</span>
          )}
        </div>
      ))}
    </div>
  )
}

async function requestEvaluate(expression: string, frameId: number): Promise<DebugEvaluateResult> {
  try {
    const result = await fluvix.debug.evaluate({ expression, frameId, context: 'repl' })

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

function entryPrefix(kind: LocalConsoleEntry['kind']): string {
  switch (kind) {
    case 'input':
      return '>'
    case 'result':
      return '<'
    case 'stdout':
      return 'out'
    case 'stderr':
      return 'err'
    case 'console':
      return 'log'
    case 'error':
      return '!'
    case 'system':
      return '*'
  }
}

function rowClassName(row: VariablesTreeRow): string {
  return row.kind === 'notice'
    ? 'fx-debug-variables__row fx-debug-variables__row--notice'
    : 'fx-debug-variables__row'
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

function rowTwisty(row: VariablesTreeRow, tree: VariablesTreeState): string {
  const handle = rowHandle(row)

  if (handle === null) {
    return ''
  }

  return tree.expanded.has(handle) ? '▾' : '▸'
}

function valueTitle(expression: string, value: DebugEvaluateValue): string {
  return value.type === null
    ? `${expression}: ${value.value}`
    : `${expression} (${value.type}): ${value.value}`
}

function depthStyle(depth: number): CSSProperties {
  return { '--fx-debug-variable-depth': depth } as CSSProperties
}

function evaluateUnavailableMessage(reason: DebugEvaluateUnavailableReason): TranslationKey {
  switch (reason) {
    case 'not-stopped':
      return 'debug.console.notStopped'
    case 'stale':
      return 'debug.console.stale'
    case 'failed':
      return 'debug.console.failed'
    case 'timeout':
      return 'debug.console.timeout'
  }
}

function variablesMessage(reason: DebugVariablesUnavailableReason): TranslationKey {
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
      return t(variablesMessage(row.reason ?? 'failed'))
  }
}
