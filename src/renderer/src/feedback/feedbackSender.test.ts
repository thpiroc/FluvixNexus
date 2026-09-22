import { afterEach, describe, expect, it } from 'vitest'
import type { IpcResult, SubmitFeedbackRequest, SubmitFeedbackResponse } from '@shared/ipc'
import { ipcFeedbackSender } from './feedbackSender'

/**
 * Main 経由の送り先（ipcFeedbackSender）。
 *
 * 画面から見える違いは「受け付けた / 送れなかった」の2値だけで、
 * Main の IPC の成功・失敗をそのまま写すことを確かめる。
 */

const globals = globalThis as { fluvix?: unknown }

function installBridge(
  respond: (request: SubmitFeedbackRequest) => IpcResult<SubmitFeedbackResponse>
): SubmitFeedbackRequest[] {
  const requests: SubmitFeedbackRequest[] = []

  globals.fluvix = {
    feedback: {
      submit: async (request: SubmitFeedbackRequest) => {
        requests.push(request)
        return respond(request)
      }
    }
  }

  return requests
}

afterEach(() => {
  delete globals.fluvix
})

describe('ipcFeedbackSender', () => {
  it('種別と詳細だけを Main へ渡し、成功を ok にする', async () => {
    const requests = installBridge(() => ({ ok: true, data: { savedTo: ['notion'] } }))

    await expect(
      ipcFeedbackSender.send({ category: 'other', detail: 'その他の意見' })
    ).resolves.toEqual({
      ok: true
    })
    expect(requests).toEqual([{ category: 'other', detail: 'その他の意見' }])
  })

  it('Main の失敗は ok: false にする', async () => {
    installBridge(() => ({
      ok: false,
      error: { code: 'PERMISSION_DENIED', message: 'not saved' }
    }))

    await expect(ipcFeedbackSender.send({ category: 'bug', detail: 'x' })).resolves.toEqual({
      ok: false
    })
  })
})
