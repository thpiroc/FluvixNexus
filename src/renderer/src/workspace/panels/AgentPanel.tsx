import type { JSX } from 'react'
import { AgentTaskView } from '../../agentTask/AgentTaskView'

/**
 * Agent パネル（FN Agent。Security Core v1 の STEP9）。
 *
 * 既存の右側 AI パネルは無かったため、最小の Dockable パネルとして足した
 * （2026-09-23 確定）。中身は agentTask/ が持ち、ここは器だけ。
 *
 * File Write / Terminal の確認は、パネルの外（App.tsx の AgentFileWriteProvider /
 * AgentTerminalProvider）がアプリ全体で1つだけ出す ── パネルを閉じていても、Agent の
 * 承認待ちを見落とさないため。
 */
export function AgentPanel(): JSX.Element {
  return <AgentTaskView />
}
