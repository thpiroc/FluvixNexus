import type { AgentPermissionMode } from '@shared/security'
import type { AuditEvent, AuditReason } from '../security/audit'
import { isExternalProviderId } from '../security/externalSend/externalSendContext'
import type { AgentActionType } from './agentAction'
import type { AgentProviderFailure } from './agentProvider'

/**
 * Agent Loop の Audit Event（Security Core v1 の STEP9）。
 *
 * **Security 上意味のある出来事だけ**を記録する（2026-09-23 確定）。
 *
 * ```
 * agent.action-rejected   AI の Action を実行せずに拒んだ（壊れた出力・並列・拒否済みの再提案）
 * agent.stopped           利用者が停止した（承認待ちを取り消し、次の Action を始めない）
 * agent.provider-failed   AI Provider の呼び出し1回が失敗した（STEP10-3）
 * ```
 *
 * 単なる開始・完了・Loop の回数は記録しない。**AI の出力・指示・Action の中身
 * （パス・本文・コマンド・引数）は載せない** ── 載せるのは Action の種類（`subject`）・
 * 理由・効いていた Permission だけ。副作用ロックでの拒否は、File Write / Terminal の Gate が
 * それぞれ `side-effect-in-progress` として記録する。
 */

export function agentActionRejectedEvent(
  reason: Extract<AuditReason, 'invalid-action' | 'parallel-action' | 'repeated-action'>,
  actionType: AgentActionType | null,
  permissionMode: AgentPermissionMode
): AuditEvent {
  return {
    type: 'agent.action-rejected',
    decision: 'deny',
    reason,
    permissionMode,
    subject: actionType ?? 'unknown'
  }
}

export function agentStoppedEvent(permissionMode: AgentPermissionMode): AuditEvent {
  return {
    type: 'agent.stopped',
    reason: 'agent-stopped',
    permissionMode
  }
}

/** Provider の失敗（中断を除く）を Audit の理由へ。timeout・Payload の不正は既存の語を使う。 */
const PROVIDER_FAILURE_REASON: Readonly<
  Record<Exclude<AgentProviderFailure, 'aborted'>, AuditReason>
> = Object.freeze({
  timeout: 'timed-out',
  'invalid-payload': 'invalid-payload',
  'provider-mismatch': 'provider-mismatch',
  'provider-unavailable': 'provider-unavailable',
  'provider-failed': 'provider-failed',
  'response-too-large': 'response-too-large',
  'invalid-response': 'invalid-response',
  'authentication-failed': 'authentication-failed',
  'authorization-failed': 'authorization-failed',
  'request-rejected': 'request-rejected',
  'rate-limited': 'rate-limited',
  'temporary-failure': 'temporary-failure',
  'network-failed': 'network-failed'
})

/**
 * AI Provider の呼び出し1回が失敗した（STEP10-3）。
 *
 * 載せるのは **Provider の識別子・閉じた分類・何回目か・効いていた Permission だけ。**
 * 識別子は External Send Gate と同じ検査（書式・40 文字・Secret の形でない）を通ったときだけ
 * `subject` に載せる ── URL や API Key を識別子として記録できる形にしない。Provider への要求・
 * 応答・Error の本文・HTTP の本文・Credential を渡す引数は無い。
 */
export function agentProviderFailedEvent(
  providerId: unknown,
  failure: Exclude<AgentProviderFailure, 'aborted'>,
  attempt: number,
  permissionMode: AgentPermissionMode
): AuditEvent {
  return {
    type: 'agent.provider-failed',
    reason: PROVIDER_FAILURE_REASON[failure],
    outcome: 'failure',
    permissionMode,
    attempt,
    ...(isExternalProviderId(providerId) ? { subject: providerId } : {})
  }
}
