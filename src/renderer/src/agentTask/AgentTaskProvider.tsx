import { useCallback, useMemo, useState, type JSX, type ReactNode } from 'react'
import type { AgentTaskContinueDecision, AgentTaskStartRejection } from '@shared/agent'
import { fluvix } from '../api/fluvix'
import { AgentTaskContext, type AgentTaskController } from './context'
import { useAgentTaskState } from './useAgentTask'

/**
 * FN Agent の作業の窓口を、パネルの外で1つだけ持つ（context.ts）。
 *
 * Agent パネル（AgentTaskView）とステータスバーの表示（AgentStatusItem）は、
 * どちらもここを読む。購読は起動時に1度だけ張り、パネルを動かしても張り直さない。
 *
 * 送るのは今までと同じ「始めて」「止めて」「続けて / やめて」の3つだけ
 * （IPC の契約は変えていない）。
 */
export function AgentTaskProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const { state, received } = useAgentTaskState()
  const [prompt, setPrompt] = useState('')
  const [sending, setSending] = useState(false)
  const [rejection, setRejection] = useState<AgentTaskStartRejection | null>(null)

  const start = useCallback(async (): Promise<void> => {
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

  const stop = useCallback((): void => {
    void fluvix.agentTask.stop()
  }, [])

  const answerLimit = useCallback((decision: AgentTaskContinueDecision): void => {
    void fluvix.agentTask.continueTask({ decision })
  }, [])

  const value = useMemo<AgentTaskController>(
    () => ({
      state,
      received,
      prompt,
      setPrompt,
      sending,
      rejection,
      start,
      stop,
      answerLimit
    }),
    [state, received, prompt, sending, rejection, start, stop, answerLimit]
  )

  return <AgentTaskContext.Provider value={value}>{children}</AgentTaskContext.Provider>
}
