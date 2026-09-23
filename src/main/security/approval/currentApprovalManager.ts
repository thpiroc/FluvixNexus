import { IPC_EVENT_CHANNELS } from '@shared/ipc'
import { emitIpcEvent } from '../../ipc/events'
import { recordAuditEvent } from '../audit/currentAuditLog'
import { getCurrentSecurityPolicy } from '../policy/currentSecurityPolicy'
import { confirmApprovalNatively } from './approvalDialog'
import {
  createApprovalManager,
  type ApprovalConsumeResult,
  type ApprovalOutcome
} from './approvalManager'

/**
 * 今の Approval Manager（Security Core v1 の STEP6）。
 *
 * **Main の Security Core が持つ、承認の唯一の所在地。** Policy は Main が保存から
 * 読み直したもの（STEP1）、記録先は Main の Audit Log（STEP4）、時計は Main の
 * `Date.now()`、Native 確認は Main の `dialog`（approvalDialog.ts）で、
 * **どれも引数では差し替えられない** ── 差し替えられる形（`createApprovalManager`）は
 * この folder の中だけにあり、入口（index.ts）からは公開しない。
 *
 * ## 使い方（STEP7 / STEP8 から）
 *
 * ```ts
 * const outcome = await requestApproval({ kind: 'file.write', target, content })
 *
 * if (outcome.decision !== 'approved') {
 *   return denied(outcome.reason)
 * }
 *
 * // 実行の直前に、**これから書くもの**で使い切る。
 * const used = consumeApproval(outcome.approvalId, { kind: 'file.write', target, content })
 *
 * if (!used.ok) {
 *   return denied(used.reason)
 * }
 * ```
 *
 * `consumeApproval` は**同期**で状態を進めるため、同時に2回呼ばれても成功するのは
 * 1回だけになる。承認したときと違うもの（別のファイル・書き換えられた本文・別の
 * コマンドや引数・別の cwd）を渡すと `binding-mismatch` で拒まれる。
 *
 * ## Renderer から呼べるのは1つだけ
 *
 * `respondToApproval` だけが IPC の handler（main/ipc/handlers/approval.ts）から
 * 呼ばれる。**`consumeApproval` と `requestApproval` は Preload へも IPC へも
 * 出さない**（approvalSurface.test.ts が見ている）。Renderer が渡せるのは
 * 「Main が出したこの承認について、利用者が続行を選んだ」までで、承認そのものは
 * Native 確認が決める。
 *
 * ## 残らない
 *
 * 承認はこの process のメモリだけにある。アプリを終了すればすべて消える。
 */

const manager = createApprovalManager({
  readPolicy: getCurrentSecurityPolicy,
  recordEvent: recordAuditEvent,
  now: () => Date.now(),
  setTimer: (run, delayMs) => {
    const timer = setTimeout(run, delayMs)

    // 承認を待っているだけでアプリの終了が延びないようにする。
    timer.unref?.()

    return () => clearTimeout(timer)
  },
  notify: (notice) => emitIpcEvent(IPC_EVENT_CHANNELS.APPROVAL_REQUESTED, notice),
  confirm: confirmApprovalNatively
})

/** 承認を求める（二段階が終わるまで解決しない）。 */
export function requestApproval(raw: unknown): Promise<ApprovalOutcome> {
  return manager.request(raw)
}

/** Renderer の意思表示を受ける。**ここでは承認は成立しない。** */
export function respondToApproval(raw: unknown, window: unknown): Promise<void> {
  return manager.respond(raw, window)
}

/** 実行の直前に1回だけ使い切る（Main の内部からだけ呼ぶ）。 */
export function consumeApproval(approvalId: unknown, raw: unknown): ApprovalConsumeResult {
  return manager.consume(approvalId, raw)
}
