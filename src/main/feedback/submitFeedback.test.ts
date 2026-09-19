import { describe, expect, it } from 'vitest'
import { IpcError } from '../ipc/errors'
import { FeedbackDeliveryError, type FeedbackDestination } from './feedbackDestination'
import type { FeedbackRecord } from './feedbackRecord'
import { submitFeedback, type SubmitFeedbackDeps } from './submitFeedback'

/**
 * 受け取り → 記録の組み立て → 保存先へ、の流れ。
 */

const ENVIRONMENT = { os: 'Windows_NT', osRelease: '10.0.26200', arch: 'x64', electron: '43.3.0' }

function recordingDestination(saved: FeedbackRecord[]): FeedbackDestination {
  return {
    id: 'notion',
    save: async (record) => {
      saved.push(record)
    }
  }
}

function deps(overrides: Partial<SubmitFeedbackDeps> = {}): SubmitFeedbackDeps {
  return {
    now: () => new Date('2026-09-19T01:02:03.000Z'),
    appVersion: '1.0.0',
    environment: ENVIRONMENT,
    readConfig: () => ({
      ok: true,
      config: { notion: { token: 't', databaseId: '0123456789abcdef0123456789abcdef' } }
    }),
    ...overrides
  }
}

async function rejection(promise: Promise<unknown>): Promise<IpcError> {
  try {
    await promise
  } catch (cause) {
    if (cause instanceof IpcError) {
      return cause
    }
    throw cause
  }
  throw new Error('did not reject')
}

describe('submitFeedback', () => {
  it('送信日時・バージョン・環境を足して保存先へ渡す', async () => {
    const saved: FeedbackRecord[] = []

    const response = await submitFeedback(
      { category: 'safety', detail: '  日本語の本文\n2行目  ' },
      deps({ createDestinations: () => [recordingDestination(saved)] })
    )

    expect(response).toEqual({ savedTo: ['notion'] })
    expect(saved).toEqual([
      {
        category: 'safety',
        detail: '日本語の本文\n2行目',
        submittedAt: '2026-09-19T01:02:03.000Z',
        appVersion: '1.0.0',
        environment: ENVIRONMENT
      }
    ])
  })

  it('保存先が設定されていなければ何もせず成功する', async () => {
    const response = await submitFeedback(
      { category: 'good', detail: 'よい' },
      deps({ readConfig: () => ({ ok: true, config: { notion: null } }) })
    )

    expect(response).toEqual({ savedTo: [] })
  })

  it('境界の外から来た不正な値は INVALID_REQUEST', async () => {
    for (const request of [
      null,
      { category: 'unknown', detail: 'x' },
      { category: 'bug', detail: '' },
      { category: 'bug', detail: '   \n ' },
      { category: 'bug', detail: 'x'.repeat(100_001) },
      { category: 'bug' }
    ]) {
      const error = await rejection(submitFeedback(request, deps()))

      expect(error.code, JSON.stringify(request)?.slice(0, 60)).toBe('INVALID_REQUEST')
    }
  })

  it('設定が中途半端なら保存せずに失敗する', async () => {
    const saved: FeedbackRecord[] = []
    const failures: FeedbackDeliveryError[] = []

    const error = await rejection(
      submitFeedback(
        { category: 'bug', detail: 'x' },
        deps({
          readConfig: () => ({ ok: false, problem: 'needs both' }),
          createDestinations: () => [recordingDestination(saved)],
          onDeliveryFailure: (failure) => failures.push(failure)
        })
      )
    )

    expect(error.code).toBe('UNSUPPORTED')
    expect(saved).toEqual([])
    expect(failures.map((failure) => failure.failure)).toEqual(['misconfigured'])
  })

  it('保存先の失敗は IPC の失敗になり、分類がログへ渡る', async () => {
    const failures: FeedbackDeliveryError[] = []

    const error = await rejection(
      submitFeedback(
        { category: 'bug', detail: 'x' },
        deps({
          createDestinations: () => [
            {
              id: 'notion',
              save: async () => {
                throw new FeedbackDeliveryError('notion', 'unauthorized', 'Notion responded 401')
              }
            }
          ],
          onDeliveryFailure: (failure) => failures.push(failure)
        })
      )
    )

    expect(error.code).toBe('PERMISSION_DENIED')
    expect(error.detail).toBe('Notion responded 401')
    expect(failures).toHaveLength(1)
  })
})
