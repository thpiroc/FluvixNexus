import type { FeedbackDestinationId } from '@shared/feedback'
import type { FeedbackRecord } from './feedbackRecord'

/**
 * フィードバックの保存先1つ。
 *
 * 保存先を足すとき（Google Drive など）は、これを満たすものを1つ作り、
 * feedbackConfig.ts の設定から組み立てる所に1行足すだけでよい。
 * 画面・検証・IPC の契約には触らずに済む。
 *
 * `save` は保存できなければ throw する（`FeedbackDeliveryError` を推奨）。
 * 成功・失敗の2値にしないのは、失敗の理由（認証・見つからない・通信）を
 * Main のログに残したいため ── 画面に出すのは「送れなかった」だけで変わらない。
 */
export interface FeedbackDestination {
  readonly id: FeedbackDestinationId
  save(record: FeedbackRecord): Promise<void>
}

export type FeedbackDeliveryFailure =
  /** token が違う・権限が無い。 */
  | 'unauthorized'
  /** 保存先（Database など）が見つからない・共有されていない。 */
  | 'not-found'
  /** 保存先が受け付けない形（プロパティ名・型の不一致など）。 */
  | 'rejected'
  /** 混んでいる・向こうの障害。時間を置けば通りうる。 */
  | 'unavailable'
  /** 届かなかった（オフライン・タイムアウト）。 */
  | 'network'
  /** 設定が中途半端（token だけ・ID だけ など）。 */
  | 'misconfigured'

export class FeedbackDeliveryError extends Error {
  readonly destination: FeedbackDestinationId
  readonly failure: FeedbackDeliveryFailure

  constructor(
    destination: FeedbackDestinationId,
    failure: FeedbackDeliveryFailure,
    message: string
  ) {
    super(message)
    this.name = 'FeedbackDeliveryError'
    this.destination = destination
    this.failure = failure
  }
}
