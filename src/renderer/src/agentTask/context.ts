import { createContext, useContext } from 'react'
import type {
  AgentTaskContinueDecision,
  AgentTaskStartRejection,
  AgentTaskState
} from '@shared/agent'

/**
 * FN Agent の作業の窓口（Agent パネルのドックパネル化）。
 *
 * Agent パネルは他のパネルと同じく、タブの切り替え・別の領域への移動・非表示のたびに
 * 作り直される。パネルの中に状態を持つと、そのたびに**書きかけの指示と、始められなかった
 * 理由が消える**。そこで、パネルより長く生きる Shell の外（App.tsx）に置き、パネルは
 * ここを読むだけにする（Git の Commit message 下書きと同じ扱い）。
 *
 * **作業の状態の正本は Main のまま。** ここが持つのは届いた知らせの写しと、
 * Renderer だけの一時入力（下書き・送信中・拒否理由）だけで、ボタンを押しても
 * 状態は Main から知らせが届くまで変わらない。パネルを閉じても作り直しても、
 * Main の作業には何も送らない（止めるのは停止ボタンだけ）。
 */
export interface AgentTaskController {
  /** Main から届いた最新の状態。届く前は INITIAL_AGENT_TASK_STATE。 */
  readonly state: AgentTaskState
  /**
   * Main から1度でも状態が届いたか。
   *
   * 届く前の初期値は「Agent OFF・Provider 無し」なので、それを根拠に案内を出すと
   * 起動直後に「OFF になっています」が一瞬見える。
   */
  readonly received: boolean
  /** 書きかけの指示。パネルを作り直しても残る。 */
  readonly prompt: string
  readonly setPrompt: (prompt: string) => void
  /** 開始の要求を送っている途中か。 */
  readonly sending: boolean
  /** 直前の開始が断られた理由。次に開始を押すまで残る。 */
  readonly rejection: AgentTaskStartRejection | null
  readonly start: () => Promise<void>
  readonly stop: () => void
  readonly answerLimit: (decision: AgentTaskContinueDecision) => void
}

export const AgentTaskContext = createContext<AgentTaskController | null>(null)

export function useAgentTask(): AgentTaskController {
  const value = useContext(AgentTaskContext)

  if (value === null) {
    throw new Error('useAgentTask must be used inside <AgentTaskProvider>.')
  }

  return value
}
