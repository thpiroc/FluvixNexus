import { recordAuditEvent } from '../audit/currentAuditLog'
import { getCurrentSecurityPolicy } from '../policy/currentSecurityPolicy'
import {
  createExternalSendGate,
  type ExternalSendDelivery,
  type ExternalSendOutcome
} from './externalSendGate'

/**
 * 今の External Send Gate（Security Core v1 の STEP5）。
 *
 * **Main の Security Core が持つ、外部 Provider への唯一の出口。** Policy は Main が
 * 保存から読み直したもの（STEP1 の `getCurrentSecurityPolicy`）、記録先は Main の
 * Audit Log（STEP4 の `recordAuditEvent`）で、**どちらも引数では差し替えられない**
 * ── 差し替えられる形（`createExternalSendGate`）はこの folder の中だけにあり、
 * 入口（index.ts）からは公開しない。
 *
 * ## 使い方
 *
 * ```ts
 * const outcome = await sendThroughExternalGate(
 *   { providerId: 'anthropic', items: [{ kind: 'user-prompt', text: prompt }] },
 *   (payload) => adapter.send(payload)   // payload は SafeExternalPayload だけ
 * )
 * ```
 *
 * 送る手続きが呼ばれるのは、判定が `allow` になったときだけ。拒まれた場合は
 * `{ decision: 'deny', reason }` が返り、**未検査の Context が Provider へ渡る経路は無い。**
 *
 * 送る手続きが投げた例外はそのまま呼び出し側へ伝わる（Provider との通信の失敗は
 * Gate の判断ではない）。そのときも Payload は取り消され、raw で送り直す経路は無い。
 */

const gate = createExternalSendGate({
  readPolicy: getCurrentSecurityPolicy,
  recordEvent: recordAuditEvent
})

export function sendThroughExternalGate<T>(
  request: unknown,
  deliver: ExternalSendDelivery<T>
): Promise<ExternalSendOutcome<T>> {
  return gate.send(request, deliver)
}
