import type { AgentTaskStartRejection, AgentTaskState } from '@shared/agent'
import type { TranslationKey } from '../i18n/messages'

/**
 * Agent パネルの「今なにをしているか」の1行を決める（Security Core v1 の STEP9）。
 *
 * **表示のためだけ。** Renderer は状態から何も判断しない（次へ進むか・止めるかは Main の
 * Agent Loop が決める）。ここは Main から届いた状態を、画面の文言の鍵へ写すだけ。
 *
 * ```
 * 調査中 → ファイル確認中 → 検索中 → 変更提案（承認待ち）→ コマンド（承認待ち・実行中）→ 完了
 * ```
 */
export function agentTaskStatusKey(state: AgentTaskState): TranslationKey {
  switch (state.status) {
    case 'idle':
      return 'agentTask.status.idle'
    case 'awaiting-continue':
      return 'agentTask.status.awaitingContinue'
    case 'stopping':
      return 'agentTask.status.stopping'
    case 'completed':
      return 'agentTask.status.completed'
    case 'running':
      return phaseKey(state)
    case 'stopped':
    case 'failed':
      return endReasonKey(state)
  }
}

function phaseKey(state: AgentTaskState): TranslationKey {
  switch (state.phase) {
    case 'investigating':
      return 'agentTask.phase.investigating'
    case 'reading':
      return 'agentTask.phase.reading'
    case 'searching':
      return 'agentTask.phase.searching'
    case 'proposing-change':
      return 'agentTask.phase.proposingChange'
    case 'running-command':
      return 'agentTask.phase.runningCommand'
    default:
      return 'agentTask.phase.thinking'
  }
}

function endReasonKey(state: AgentTaskState): TranslationKey {
  switch (state.endReason) {
    case 'user-stopped':
      return 'agentTask.end.userStopped'
    case 'loop-limit-declined':
      return 'agentTask.end.loopLimitDeclined'
    case 'agent-disabled':
      return 'agentTask.end.agentDisabled'
    case 'workspace-changed':
      return 'agentTask.end.workspaceChanged'
    case 'provider-failed':
      return 'agentTask.end.providerFailed'
    case 'provider-timeout':
      return 'agentTask.end.providerTimeout'
    case 'provider-response-too-large':
      return 'agentTask.end.providerResponseTooLarge'
    case 'provider-authentication-failed':
      return 'agentTask.end.providerAuthenticationFailed'
    case 'provider-authorization-failed':
      return 'agentTask.end.providerAuthorizationFailed'
    case 'context-denied':
      return 'agentTask.end.contextDenied'
    case 'context-budget-exceeded':
      return 'agentTask.end.contextBudgetExceeded'
    case 'too-many-invalid-actions':
      return 'agentTask.end.tooManyInvalidActions'
    default:
      return 'agentTask.end.internalError'
  }
}

/** 始められなかった理由の文言。 */
export function agentTaskRejectionKey(reason: AgentTaskStartRejection): TranslationKey {
  switch (reason) {
    case 'busy':
      return 'agentTask.rejected.busy'
    case 'agent-disabled':
      return 'agentTask.rejected.agentDisabled'
    case 'no-workspace':
      return 'agentTask.rejected.noWorkspace'
    case 'provider-unavailable':
      return 'agentTask.rejected.providerUnavailable'
    case 'invalid-prompt':
      return 'agentTask.rejected.invalidPrompt'
  }
}
