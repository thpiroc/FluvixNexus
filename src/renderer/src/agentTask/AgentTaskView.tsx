import { useCallback, useState, type JSX } from 'react'
import {
  AGENT_TASK_PROMPT_MAX_LENGTH,
  isAgentTaskActive,
  type AgentTaskContinueDecision,
  type AgentTaskStartRejection
} from '@shared/agent'
import { fluvix } from '../api/fluvix'
import { useI18n } from '../i18n/context'
import { agentTaskRejectionKey, agentTaskStatusKey } from './agentTaskStatus'
import { useAgentTaskState } from './useAgentTask'
import './agentTask.css'

/**
 * FN Agent の最小パネル（Security Core v1 の STEP9）。
 *
 * 置くのは次の4つだけ（2026-09-23 確定: 大型 UI にしない）。
 *
 * ```
 * 指示の入力欄 ＋ 開始
 * 今なにをしているかの1行（調査中 → ファイル確認中 → 変更提案 → …）
 * 停止ボタン（動いている間だけ）／ Loop の上限での「続ける / やめる」
 * 最終回答
 * ```
 *
 * **Tool の詳細ログは出さない。** File Write の Diff と Terminal のコマンド・結果は、
 * STEP7 / STEP8 の承認画面（agent/）がそれぞれの経路で見せる。
 *
 * ## Renderer は判断しない
 *
 * 送るのは「始めて」「止めて」「続けて / やめて」の意思表示だけ。ボタンを押しても
 * 画面は Main から状態が届いてから変わる。最終回答は Main が伏せて切った文字列で、
 * **文字として**描く（HTML・Markdown として解釈しない）。
 */
export function AgentTaskView(): JSX.Element {
  const { t } = useI18n()
  const state = useAgentTaskState()
  const [prompt, setPrompt] = useState('')
  const [sending, setSending] = useState(false)
  const [rejection, setRejection] = useState<AgentTaskStartRejection | null>(null)

  const active = isAgentTaskActive(state.status)
  const canStart =
    !active &&
    !sending &&
    state.agentEnabled &&
    state.providerAvailable &&
    prompt.trim().length > 0 &&
    prompt.length <= AGENT_TASK_PROMPT_MAX_LENGTH

  const start = useCallback(async () => {
    setSending(true)
    setRejection(null)

    try {
      const result = await fluvix.agentTask.start({ prompt })

      if (result.ok && !result.data.started) {
        setRejection(result.data.reason)
      }
    } catch {
      // 届かなかった。作業は始まっていない（状態は Main から届いたものだけを見る）。
    } finally {
      setSending(false)
    }
  }, [prompt])

  const stop = useCallback(() => {
    void fluvix.agentTask.stop()
  }, [])

  const answerLimit = useCallback((decision: AgentTaskContinueDecision) => {
    void fluvix.agentTask.continueTask({ decision })
  }, [])

  return (
    <div className="fx-agent-task" data-testid="agent-task">
      <div className="fx-agent-task__input">
        <textarea
          className="fx-agent-task__prompt"
          value={prompt}
          maxLength={AGENT_TASK_PROMPT_MAX_LENGTH}
          placeholder={t('agentTask.placeholder')}
          disabled={active}
          rows={4}
          data-testid="agent-task-prompt"
          onChange={(event) => setPrompt(event.target.value)}
        />
        <div className="fx-agent-task__actions">
          {active ? (
            <button
              type="button"
              className="fx-agent-task__button"
              data-variant="danger"
              disabled={state.status === 'stopping'}
              data-testid="agent-task-stop"
              onClick={stop}
            >
              {t('agentTask.stop')}
            </button>
          ) : (
            <button
              type="button"
              className="fx-agent-task__button"
              data-variant="primary"
              disabled={!canStart}
              data-testid="agent-task-start"
              onClick={() => void start()}
            >
              {t('agentTask.start')}
            </button>
          )}
        </div>
      </div>

      {!state.agentEnabled ? (
        <p className="fx-agent-task__notice" data-testid="agent-task-disabled">
          {t('agentTask.disabledNotice')}
        </p>
      ) : !state.providerAvailable ? (
        <p className="fx-agent-task__notice" data-testid="agent-task-no-provider">
          {t('agentTask.noProviderNotice')}
        </p>
      ) : null}

      {rejection !== null ? (
        <p className="fx-agent-task__notice" data-testid="agent-task-rejected">
          {t(agentTaskRejectionKey(rejection))}
        </p>
      ) : null}

      <div
        className="fx-agent-task__status"
        data-status={state.status}
        data-testid="agent-task-status"
      >
        <span className="fx-agent-task__status-line">{t(agentTaskStatusKey(state))}</span>
        {state.subject !== null ? (
          <span className="fx-agent-task__subject" data-testid="agent-task-subject">
            {state.subject}
          </span>
        ) : null}
        {state.status !== 'idle' ? (
          <span className="fx-agent-task__loops">
            {t('agentTask.loops', { used: state.loopsUsed, limit: state.loopLimit })}
          </span>
        ) : null}
      </div>

      {state.status === 'awaiting-continue' ? (
        <div className="fx-agent-task__limit" data-testid="agent-task-limit">
          <p>{t('agentTask.limitQuestion')}</p>
          <div className="fx-agent-task__actions">
            <button
              type="button"
              className="fx-agent-task__button"
              data-testid="agent-task-limit-stop"
              onClick={() => answerLimit('stop')}
            >
              {t('agentTask.limitStop')}
            </button>
            <button
              type="button"
              className="fx-agent-task__button"
              data-variant="primary"
              data-testid="agent-task-limit-continue"
              onClick={() => answerLimit('continue')}
            >
              {t('agentTask.limitContinue')}
            </button>
          </div>
        </div>
      ) : null}

      {state.finalAnswer !== null ? (
        <section className="fx-agent-task__answer" data-testid="agent-task-answer">
          <h3 className="fx-agent-task__answer-title">{t('agentTask.answerTitle')}</h3>
          <div className="fx-agent-task__answer-text">{state.finalAnswer}</div>
        </section>
      ) : null}
    </div>
  )
}
