import { randomUUID } from 'crypto'

/**
 * 承認の識別子（Security Core v1 の STEP6。Electron に依存しない）。
 *
 * **連番を Security Token として使わない。** Renderer から届く続行の意思表示は
 * この id で pending の承認を引くため、次の id を言い当てられる形にすると、
 * 「まだ利用者が見ていない承認」へ先回りして続行を送れることになる。
 *
 * `crypto.randomUUID()`（CSPRNG。version 4）を使う。128 bit のうち 122 bit が
 * 乱数にあたる。
 *
 * ## id を知っているだけでは何もできない
 *
 * 予測困難なだけでは足りない ── id は Renderer へ渡るため、Renderer の中では
 * 既知の値にあたる。そこで id は**どの承認かを指すだけ**とし、
 *
 *   - 続行の意思表示は pending の承認にしか効かない（approvalManager.ts）
 *   - 最終的な承認は Main の Native 確認でしか成立しない
 *   - 実行の直前に action と fingerprint の一致を確かめる（approvalFingerprint.ts）
 *
 * を重ねる。**id は Token ではなく宛先にあたる。**
 */

/** UUID version 4 の形。 */
const APPROVAL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** 新しい承認の識別子。 */
export function createApprovalId(): string {
  return randomUUID()
}

/**
 * 承認の識別子として受け付ける形か。
 *
 * 形が通ることと、その承認があることは別。**あることの確認は Main の
 * pending の一覧が行う**（approvalManager.ts）。ここは Renderer から届いた値を
 * 引き当てにかける前に落とす、手前の検査にあたる。
 */
export function isApprovalId(value: unknown): value is string {
  return typeof value === 'string' && APPROVAL_ID_PATTERN.test(value)
}
