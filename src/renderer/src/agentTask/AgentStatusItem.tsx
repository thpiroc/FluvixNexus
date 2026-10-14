import type { JSX } from 'react'
import { useI18n } from '../i18n/context'
import { agentStatusBarKind, agentTaskStatusKey } from './agentTaskStatus'
import { useAgentTask } from './context'

interface AgentStatusItemProps {
  /** 押されたとき。Agent パネルを開く、または前面に出す（判断は Shell が持つ）。 */
  readonly onShowPanel: () => void
}

/**
 * ステータスバーの Agent の状態（Agent パネルのドックパネル化）。
 *
 * 動いている間（動作中）と、Loop の上限で返事を待っている間（確認待ち）だけ出る。
 * パネルを隠していても、Agent が動いていることと返事を待っていることに気付けるようにするため。
 *
 * **出ているだけでは何もしない。** パネルを開くのは押されたときだけで、確認待ちに
 * なってもパネルを勝手に開かない（利用者が組んだ配置を、本人の操作なしに変えない）。
 * 詳しい段階（調査中・ファイル確認中…）は title に出す。
 */
export function AgentStatusItem({ onShowPanel }: AgentStatusItemProps): JSX.Element | null {
  const { t } = useI18n()
  const { state } = useAgentTask()
  const kind = agentStatusBarKind(state)

  if (kind === null) {
    return null
  }

  return (
    <button
      type="button"
      className="fx-statusbar__item fx-statusbar__agent"
      data-testid="statusbar-agent"
      data-agent-status={kind}
      title={`${t(agentTaskStatusKey(state))} — ${t('agentTask.statusBar.showPanel')}`}
      onClick={onShowPanel}
    >
      {t(kind === 'awaiting' ? 'agentTask.statusBar.awaiting' : 'agentTask.statusBar.running')}
    </button>
  )
}
