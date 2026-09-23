import { useEffect, useState } from 'react'
import type { AgentTaskState } from '@shared/agent'
import { AGENT_INITIAL_LOOP_LIMIT } from '@shared/agent'
import { fluvix } from '../api/fluvix'

/** Main から最初の状態が届くまでの値（動いていない・始められるかは不明）。 */
export const INITIAL_AGENT_TASK_STATE: AgentTaskState = Object.freeze({
  status: 'idle',
  phase: null,
  subject: null,
  loopsUsed: 0,
  loopLimit: AGENT_INITIAL_LOOP_LIMIT,
  finalAnswer: null,
  endReason: null,
  agentEnabled: false,
  providerAvailable: false
})

/**
 * FN Agent の作業の状態を購読する（Security Core v1 の STEP9）。
 *
 * 状態の正本は Main の Agent Loop。ここは知らせを写すだけで、Renderer の側で状態を
 * 進めない（押したボタンの結果も、Main から知らせが届いてから画面が変わる）。
 */
export function useAgentTaskState(): AgentTaskState {
  const [state, setState] = useState<AgentTaskState>(INITIAL_AGENT_TASK_STATE)

  useEffect(() => {
    let active = true

    const unsubscribe = fluvix.agentTask.onStateChanged((next) => {
      if (active) {
        setState(next)
      }
    })

    void fluvix.agentTask.getState().then((result) => {
      if (active && result.ok) {
        setState(result.data)
      }
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return state
}
