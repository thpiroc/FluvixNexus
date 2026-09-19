import {
  FEEDBACK_CATEGORY_IDS,
  FEEDBACK_DETAIL_MAX_LENGTH,
  type FeedbackCategoryId,
  type FeedbackDestinationId
} from '@shared/feedback'
import type { IpcErrorCode, SubmitFeedbackResponse } from '@shared/ipc'
import { IpcError, invalidRequest } from '../ipc/errors'
import type { FeedbackDestinationsConfig, FeedbackDestinationsConfigRead } from './feedbackConfig'
import {
  FeedbackDeliveryError,
  type FeedbackDeliveryFailure,
  type FeedbackDestination
} from './feedbackDestination'
import type { FeedbackEnvironment, FeedbackRecord } from './feedbackRecord'
import { createNotionDestination } from './notionDestination'

/**
 * フィードバック1件を受け取り、設定済みの保存先すべてへ保存する（Electron に依存しない）。
 *
 * 流れは3つだけ。
 *
 *   1. 境界の外から来た値を確かめる（画面の検証を信じない）
 *   2. 送信日時・バージョン・環境を足して `FeedbackRecord` にする
 *   3. 設定から保存先を組み立て、**すべてへ**保存する
 *
 * 保存先が1つも無ければ何もせずに成功する（v1 の「受け付けるだけ」）。
 * 1つでも失敗すれば全体を失敗にする ── 画面は「送れませんでした」を出し、
 * 入力を消さずに残す（renderer/src/feedback/FeedbackOverlay.tsx）。
 */

export interface SubmitFeedbackDeps {
  readonly now: () => Date
  readonly appVersion: string
  readonly environment: FeedbackEnvironment
  readonly readConfig: () => FeedbackDestinationsConfigRead
  /** 保存先の組み立て。テストで差し替える。 */
  readonly createDestinations?: (config: FeedbackDestinationsConfig) => FeedbackDestination[]
  /** 保存に失敗したときの記録（token は渡らない）。 */
  readonly onDeliveryFailure?: (error: FeedbackDeliveryError) => void
}

export async function submitFeedback(
  request: unknown,
  deps: SubmitFeedbackDeps
): Promise<SubmitFeedbackResponse> {
  const { category, detail } = parseRequest(request)

  const configRead = deps.readConfig()

  if (!configRead.ok) {
    const error = new FeedbackDeliveryError('notion', 'misconfigured', configRead.problem)
    deps.onDeliveryFailure?.(error)
    throw toIpcError(error)
  }

  const destinations = (deps.createDestinations ?? createFeedbackDestinations)(configRead.config)

  if (destinations.length === 0) {
    return { savedTo: [] }
  }

  const record: FeedbackRecord = {
    category,
    detail,
    submittedAt: deps.now().toISOString(),
    appVersion: deps.appVersion,
    environment: deps.environment
  }

  const results = await Promise.allSettled(
    destinations.map((destination) => destination.save(record))
  )

  const savedTo: FeedbackDestinationId[] = []
  let firstFailure: FeedbackDeliveryError | null = null

  results.forEach((result, index) => {
    const destination = destinations[index]!

    if (result.status === 'fulfilled') {
      savedTo.push(destination.id)
      return
    }

    const error =
      result.reason instanceof FeedbackDeliveryError
        ? result.reason
        : new FeedbackDeliveryError(destination.id, 'rejected', String(result.reason))

    deps.onDeliveryFailure?.(error)
    firstFailure ??= error
  })

  if (firstFailure !== null) {
    throw toIpcError(firstFailure)
  }

  return { savedTo }
}

/** 設定から保存先を並べる。保存先を足すときはここに1つ足す。 */
export function createFeedbackDestinations(
  config: FeedbackDestinationsConfig
): FeedbackDestination[] {
  const destinations: FeedbackDestination[] = []

  if (config.notion !== null) {
    destinations.push(createNotionDestination(config.notion))
  }

  return destinations
}

function parseRequest(request: unknown): { category: FeedbackCategoryId; detail: string } {
  const record =
    typeof request === 'object' && request !== null ? (request as Record<string, unknown>) : {}
  const category = record['category']
  const detail = record['detail']

  if (
    typeof category !== 'string' ||
    !(FEEDBACK_CATEGORY_IDS as readonly string[]).includes(category)
  ) {
    throw invalidRequest('feedback:submit requires a known category.')
  }

  if (typeof detail !== 'string' || detail.trim().length === 0) {
    throw invalidRequest('feedback:submit requires a non-blank detail.')
  }

  if (detail.length > FEEDBACK_DETAIL_MAX_LENGTH) {
    throw invalidRequest('feedback:submit detail is too long.')
  }

  return { category: category as FeedbackCategoryId, detail: detail.trim() }
}

const FAILURE_CODES: Readonly<Record<FeedbackDeliveryFailure, IpcErrorCode>> = {
  unauthorized: 'PERMISSION_DENIED',
  'not-found': 'NOT_FOUND',
  rejected: 'INTERNAL',
  unavailable: 'BUSY',
  network: 'INTERNAL',
  misconfigured: 'UNSUPPORTED'
}

function toIpcError(error: FeedbackDeliveryError): IpcError {
  return new IpcError(
    FAILURE_CODES[error.failure],
    `Feedback could not be saved to ${error.destination} (${error.failure}).`,
    error.message
  )
}
