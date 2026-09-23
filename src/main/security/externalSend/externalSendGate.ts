import { isAgentPermissionMode } from '@shared/security'
import type { AuditEvent } from '../audit/auditEvent'
import { FAIL_CLOSED_SECURITY_POLICY, type SecurityPolicy } from '../policy/securityPolicy'
import { externalSendAuditEvent } from './externalSendAudit'
import {
  decideExternalSend,
  type ExternalSendDecision,
  type ExternalSendDenial
} from './externalSendDecision'
import {
  isSafeExternalPayload,
  revokeSafeExternalPayload,
  type ExternalSendNotice,
  type SafeExternalPayload
} from './safeExternalPayload'

/**
 * External Send Gate（Security Core v1 の STEP5。Electron にも fs にも依存しない）。
 *
 * **Provider へ渡すのは Gate 自身。** 呼び出し側は「送りたい未検査の Context」と
 * 「Safe Payload を受け取って実際に送る手続き」を渡し、Gate が
 *
 * ```
 * Policy を読む → 判定する（externalSendDecision.ts）→ Audit へ記録する
 *   → 送る直前にもう一度 Safe Payload か確かめる → 手続きを呼ぶ → Payload を取り消す
 * ```
 *
 * の順に進める。Safe Payload を**先に返してから後で送る**形にしないのは、返した
 * Payload が持ち回されて、判定の後に別の送信へ使い回されることを防ぐため。
 *
 * ## ここに無いもの
 *
 * `externalSendUnsafe()`・`skipSecurity`・`bypassGate`・`alreadySanitized`・
 * `trustRenderer` にあたる引数も関数も**無い。** 失敗したときに未検査の Payload を
 * そのまま送る経路（raw fallback）も無い ── 送る手続きが呼ばれるのは、判定が `allow`
 * で、かつ Safe Payload が実行時にも確かめられたときだけ。
 *
 * ## Audit の失敗で結論は変わらない
 *
 * 記録は `try` で囲んで捨てる。**記録できたかどうかを判定に混ぜない**
 * （「Audit に書けなかったから許可する」も「拒否する」も作らない）。記録の入口自身も
 * 成否を返さない（STEP4 の `recordAuditEvent`）。
 *
 * ## Renderer へは出さない
 *
 * この Gate を呼ぶのは Main の Security Core だけで、IPC も Preload の API も作らない
 * （externalSendSurface.test.ts が見ている）。Renderer から未検査の Payload を渡して
 * 「Safe Payload に変えて返す」口も作らない ── 返した時点で、Renderer が
 * 検査済みの入れ物を持ち回せることになるため。
 */

/** Gate が使う、Main 側の道具。 */
export interface ExternalSendGateDependencies {
  /** 今効いている Policy（STEP1）。判定のたびに読み直す。 */
  readonly readPolicy: () => SecurityPolicy
  /** Audit Event を1件記録する（STEP4）。成否は返さない。 */
  readonly recordEvent: (event: AuditEvent) => void
}

/** Safe Payload を受け取って実際に Provider へ送る手続き（将来の Provider Adapter）。 */
export type ExternalSendDelivery<T> = (payload: SafeExternalPayload) => T | Promise<T>

/** 送信1回の結果。 */
export type ExternalSendOutcome<T> =
  | {
      readonly decision: 'allow'
      /** 利用者へ「一部を伏せた」と知らせるための metadata。 */
      readonly notice: ExternalSendNotice
      /** 送る手続きが返したもの。 */
      readonly delivered: T
    }
  | { readonly decision: 'deny'; readonly reason: ExternalSendDenial }

export interface ExternalSendGate {
  readonly send: <T>(
    request: unknown,
    deliver: ExternalSendDelivery<T>
  ) => Promise<ExternalSendOutcome<T>>
}

export function createExternalSendGate(deps: ExternalSendGateDependencies): ExternalSendGate {
  return {
    async send<T>(
      request: unknown,
      deliver: ExternalSendDelivery<T>
    ): Promise<ExternalSendOutcome<T>> {
      const policy = readPolicy(deps)
      const decided =
        typeof deliver === 'function' ? decideExternalSend(policy, request) : DENY_INVALID_PAYLOAD

      /*
        型だけを Security Boundary にしない。判定が allow でも、送る直前に
        「Gate が発行し、まだ使われていない Payload か」を実行時に確かめる。
      */
      const decision: ExternalSendDecision =
        decided.decision === 'allow' && !isSafeExternalPayload(decided.payload)
          ? DENY_GATE_FAILED
          : decided

      record(deps, decision, readProviderId(request), policy.permissionMode)

      if (decision.decision === 'deny') {
        return Object.freeze({ decision: 'deny' as const, reason: decision.reason })
      }

      const { payload } = decision

      try {
        return Object.freeze({
          decision: 'allow' as const,
          notice: payload.notice,
          delivered: await deliver(payload)
        })
      } finally {
        // 1回きり。送った後の Payload は、次の送信へ使い回せない。
        revokeSafeExternalPayload(payload)
      }
    }
  }
}

const DENY_INVALID_PAYLOAD: ExternalSendDecision = Object.freeze({
  decision: 'deny',
  reason: 'invalid-payload'
})

const DENY_GATE_FAILED: ExternalSendDecision = Object.freeze({
  decision: 'deny',
  reason: 'gate-failed'
})

/** Policy が読めなければ、最も厳しい Policy として判定する（STEP1 と同じ倒し方）。 */
function readPolicy(deps: ExternalSendGateDependencies): SecurityPolicy {
  try {
    const policy: unknown = deps.readPolicy()

    if (typeof policy !== 'object' || policy === null) {
      return FAIL_CLOSED_SECURITY_POLICY
    }

    const mode = (policy as { readonly permissionMode?: unknown }).permissionMode

    return isAgentPermissionMode(mode) ? (policy as SecurityPolicy) : FAIL_CLOSED_SECURITY_POLICY
  } catch {
    return FAIL_CLOSED_SECURITY_POLICY
  }
}

/** 識別子は、形が通ったものだけが Audit の `subject` に載る（externalSendAudit.ts）。 */
function readProviderId(request: unknown): unknown {
  if (typeof request !== 'object' || request === null) {
    return undefined
  }

  try {
    return (request as { readonly providerId?: unknown }).providerId
  } catch {
    return undefined
  }
}

function record(
  deps: ExternalSendGateDependencies,
  decision: ExternalSendDecision,
  providerId: unknown,
  permissionMode: SecurityPolicy['permissionMode']
): void {
  try {
    deps.recordEvent(externalSendAuditEvent(decision, providerId, permissionMode))
  } catch {
    // 記録できなかったことで allow / deny が変わってはいけない。
  }
}
