import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type JSX
} from 'react'
import type {
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

/**
 * Evaluate（Session 6-7）。選んでいる frame の文脈で式を1つ評価する最小の面。
 *
 * **Debug Console（Session 6-8）ではない。** 履歴も、出力の取り込み（`output` event）も、
 * 複数行の入力も、Watch の一覧も持たない ── 持つのは「今の式」と「今の結果」だけになる。
 * 6-8 が乗るのはこの下の Main 側（`debug:evaluate`）で、面はそちらで作り直される。
 *
 * ## 古い結果を出さないための3つ
 *
 * ```
 * 停止 / Workspace / セッションが変わった … snapshot の版が進む → key で作り直す（6-6 と同じ）
 * frame の選択が変わった                  … key に frame を含める → 同上
 * 新しい要求が古い要求を追い越した        … 要求の通し番号。最新の答えだけを当てる
 * ```
 *
 * 3つめだけが Renderer にしか分からない ── Main から見れば同じ停止の同じ frame への
 * 2通はどちらも正当で、どちらを画面に出すかは頼んだ側しか知らない。
 */
export function EvaluateView(): JSX.Element {
  const { snapshot, version, selectedFrameId } = useCallStack()
  const { t } = useI18n()

  if (snapshot.status !== 'stopped') {
    return <p className="fx-debug-evaluate__notice">{t('debug.evaluate.notStopped')}</p>
  }

  if (selectedFrameId === null) {
    return <p className="fx-debug-evaluate__notice">{t('debug.evaluate.noFrame')}</p>
  }

  return (
    <EvaluateForm key={`${String(version)}:${String(selectedFrameId)}`} frameId={selectedFrameId} />
  )
}

interface EvaluateState {
  readonly expression: string
  readonly result: DebugEvaluateResult
}

function EvaluateForm({ frameId }: { readonly frameId: number }): JSX.Element {
  const { t } = useI18n()
  const [expression, setExpression] = useState('')
  const [pending, setPending] = useState(false)
  const [evaluated, setEvaluated] = useState<EvaluateState | null>(null)
  const [tree, setTree] = useState<VariablesTreeState>(INITIAL_VARIABLES_TREE)
  const mountedRef = useRef(true)
  /** 送った要求の通し番号。最後に送ったものの答えだけを当てる。 */
  const requestRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadChildren = useCallback((handle: DebugVariableHandle) => {
    void requestVariables(handle).then((result) => {
      if (mountedRef.current) {
        setTree((current) => applyChildrenResult(current, handle, result))
      }
    })
  }, [])

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    if (expression.trim() === '') {
      return
    }

    const sequence = requestRef.current + 1
    requestRef.current = sequence
    const sent = expression

    setPending(true)
    /* 前の結果の展開は持ち越さない ── 別の式の子を、新しい結果の下に出さないため。 */
    setTree(INITIAL_VARIABLES_TREE)

    void requestEvaluate(sent, frameId).then((result) => {
      if (!mountedRef.current || requestRef.current !== sequence) {
        return
      }

      setPending(false)
      setEvaluated({ expression: sent, result })
    })
  }

  function toggle(handle: DebugVariableHandle): void {
    if (tree.expanded.has(handle)) {
      setTree((current) => collapseNode(current, handle))
      return
    }

    const fetch = needsChildren(tree, handle)

    setTree((current) => expandNode(current, handle))

    if (fetch) {
      loadChildren(handle)
    }
  }

  return (
    <div className="fx-debug-evaluate">
      <form className="fx-debug-evaluate__form" onSubmit={submit}>
        <input
          type="text"
          className="fx-debug-evaluate__input"
          value={expression}
          aria-label={t('debug.evaluate.label')}
          placeholder={t('debug.evaluate.placeholder')}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setExpression(event.target.value)}
        />
        <button
          type="submit"
          className="fx-debug-evaluate__submit"
          disabled={pending || expression.trim() === ''}
        >
          {t('debug.evaluate.submit')}
        </button>
      </form>
      {pending && <p className="fx-debug-evaluate__notice">{t('debug.evaluate.evaluating')}</p>}
      {!pending && evaluated === null && (
        <p className="fx-debug-evaluate__notice">{t('debug.evaluate.empty')}</p>
      )}
      {!pending && evaluated !== null && (
        <EvaluateResult
          expression={evaluated.expression}
          result={evaluated.result}
          tree={tree}
          onToggle={toggle}
        />
      )}
    </div>
  )
}

function EvaluateResult({
  expression,
  result,
  tree,
  onToggle
}: {
  readonly expression: string
  readonly result: DebugEvaluateResult
  readonly tree: VariablesTreeState
  readonly onToggle: (handle: DebugVariableHandle) => void
}): JSX.Element {
  const { t } = useI18n()

  if (result.status === 'unavailable') {
    return <p className="fx-debug-evaluate__notice">{t(unavailableMessage(result.reason))}</p>
  }

  const { value } = result
  const handle = value.handle
  const expanded = handle !== null && tree.expanded.has(handle)
  const rows = handle === null ? [] : flattenVariablesSubtree(tree, handle, 'evaluate')

  return (
    <div className="fx-debug-evaluate__result" role="group" aria-label={t('debug.evaluate.aria')}>
      <div
        className="fx-debug-evaluate__value"
        data-expandable={handle !== null}
        title={valueTitle(expression, value)}
        onClick={() => {
          if (handle !== null) {
            onToggle(handle)
          }
        }}
      >
        <span className="fx-debug-variables__twisty" aria-hidden="true">
          {handle === null ? '' : expanded ? '▾' : '▸'}
        </span>
        <span className="fx-debug-evaluate__expression">{expression}</span>
        <span className="fx-debug-variables__separator" aria-hidden="true">
          :
        </span>
        <span className="fx-debug-variables__value">{value.value}</span>
        {value.type !== null && (
          <span className="fx-debug-evaluate__type">{`(${value.type})`}</span>
        )}
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
            {rowTwisty(row, tree)}
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
    /*
      文脈は `repl`（利用者が打った式）。Watch の面はまだ無く、`watch` を送る
      呼び出し元も無い ── 増やすのは Watch を作るとき（shared/debug/evaluate.ts）。
    */
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

function unavailableMessage(reason: DebugEvaluateUnavailableReason): TranslationKey {
  switch (reason) {
    case 'not-stopped':
      return 'debug.evaluate.notStopped'
    case 'stale':
      return 'debug.evaluate.stale'
    case 'failed':
      return 'debug.evaluate.failed'
    case 'timeout':
      return 'debug.evaluate.timeout'
  }
}

/** 子の行の知らせは Variables（Session 6-6）の文言をそのまま使う。 */
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
