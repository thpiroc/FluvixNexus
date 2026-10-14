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

export interface AgentTaskStateSnapshot {
  readonly state: AgentTaskState
  /** Main から1度でも状態が届いたか。 */
  readonly received: boolean
}

/**
 * FN Agent の作業の状態を購読する（Security Core v1 の STEP9）。
 *
 * 状態の正本は Main の Agent Loop。ここは知らせを写すだけで、Renderer の側で状態を
 * 進めない（押したボタンの結果も、Main から知らせが届いてから画面が変わる）。
 *
 * 呼ぶのは AgentTaskProvider の1箇所だけ（パネルを作り直しても購読し直さない）。
 */
export function useAgentTaskState(): AgentTaskStateSnapshot {
  const [snapshot, setSnapshot] = useState<AgentTaskStateSnapshot>({
    state: INITIAL_AGENT_TASK_STATE,
    received: false
  })

  useEffect(() => {
    let active = true

    const unsubscribe = fluvix.agentTask.onStateChanged((next) => {
      if (active) {
        setSnapshot({ state: next, received: true })
      }
    })

    /*
      知らせと取得の返事が近接して届いた場合は、**後から届いた方を採る。**

      Main の知らせ（webContents.send）と取得の返事（invoke の応答）は同じ IPC の経路を
      送った順に届くので、後から届いた方が Main で後に作られた値になる。
      「先に知らせが届いていたら返事を捨てる」にはしない ── `agentEnabled` /
      `providerAvailable` は設定を読み直して作る値で、設定が変わっても知らせは出ないため、
      後から届いた返事の方が新しいことがある（agentLoop.ts の state()）。
    */
    void fluvix.agentTask.getState().then((result) => {
      if (active && result.ok) {
        setSnapshot({ state: result.data, received: true })
      }
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return snapshot
}
