import type { AgentPermissionMode } from '@shared/security'
import type { AuditEvent } from '../audit/auditEvent'
import { isExternalProviderId } from './externalSendContext'
import type { ExternalSendDecision } from './externalSendDecision'

/**
 * External Send の判定を、Audit Event 1件にする（Security Core v1 の STEP5）。
 *
 * Electron にも fs にも依存しない。**Audit へ渡すのは安全な metadata だけ。**
 *
 * ```
 * 渡す     種別（allowed / denied）・判定・理由・効いていた Permission・
 *          Provider の識別子（subject）・伏せた数 / 種別 / 知らせるべきか
 * 渡さない Prompt 本文・System / Agent の指示文・ファイルの中身・Tool の結果・
 *          MCP の読み取り結果・Error の本文・Provider Credential・Workspace の絶対パス
 * ```
 *
 * 本文を載せられる欄は `AuditEvent` の型にも無い（auditEvent.ts）。`subject` には
 * **Provider の識別子だけ**を入れる ── 形が通らない識別子は載せない（載せても
 * Audit がさらに Mask を通すが、通す前に落としておく）。
 *
 * `workspacePath` も渡さない。どのファイルを送ったかは Audit の目的（何を通し、何を
 * 拒んだか）には要らず、1回の送信に複数のファイルが載る形とも合わないため
 * ── 載せる必要が出た時点で、欄ごとに是非を決める。
 */
export function externalSendAuditEvent(
  decision: ExternalSendDecision,
  providerId: unknown,
  permissionMode: AgentPermissionMode
): AuditEvent {
  const subject = isExternalProviderId(providerId) ? providerId : undefined

  if (decision.decision === 'allow') {
    const { notice } = decision.payload

    return Object.freeze({
      type: 'external-send.allowed' as const,
      decision: 'allow' as const,
      reason: decision.reason,
      permissionMode,
      subject,
      secretCategories: notice.categories,
      maskedCount: notice.maskedCount,
      userNoticeRequired: notice.userNoticeRequired
    })
  }

  return Object.freeze({
    type: 'external-send.denied' as const,
    decision: 'deny' as const,
    reason: decision.reason,
    permissionMode,
    subject
  })
}
