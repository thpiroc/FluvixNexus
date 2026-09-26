import {
  isSupportedProviderId,
  type AiProviderCredentialResult,
  type AiProviderCredentialStatus,
  type SupportedProviderId
} from '@shared/aiProvider'
import { IPC_CHANNELS } from '@shared/ipc'
import { getAiProviderCredentialStore } from '../../aiProvider/aiProviderService'
import type { AiProviderCredentialWriteResult } from '../../aiProvider/aiProviderCredentialStore'
import { IpcError, invalidRequest } from '../errors'
import { handleIpc } from '../registry'

/**
 * ai-provider ドメインのハンドラ（FN Agent の AI Provider の API Key。STEP10-5）。
 *
 * ## 返すのは状態と分類だけ
 *
 * 設定済みか・設定・削除の3本で、**どの応答にも Key は載らない**（Store から復号した Key を
 * 受け取る `withCredential` はここでは使わない。aiProviderCredentialSurface.test.ts）。
 *
 * ## 要求は Main で確かめ直す
 *
 * `providerId` は正式な Provider の閉じた集合（今は `openai` だけ）でなければ INVALID_REQUEST。
 * Key の形は Store が shared の同じ規則で確かめ直し、通らなければ `value-invalid` を返す
 * （利用者の入力で普通に起こることなので、IPC の失敗にはしない）。
 *
 * ## Error の本文を Renderer へ流さない
 *
 * 想定外の例外は、registry の既定だと Error の本文が `detail` として Renderer へ渡る
 * （main/ipc/errors.ts）。ここでは全部を捕まえて、**固定の文言だけの IpcError** に置き換える
 * ── OS・Electron・fs の Error に何が入っているかは、この層で決められない。
 */
export function registerAiProviderHandlers(): void {
  handleIpc(IPC_CHANNELS.AI_PROVIDER_HAS_CREDENTIAL, (request) => {
    const providerId = providerIdOf(request)

    return guarded(() => getAiProviderCredentialStore().getStatus(providerId))
  })

  handleIpc(IPC_CHANNELS.AI_PROVIDER_SET_CREDENTIAL, (request) => {
    const providerId = providerIdOf(request)
    // 型は名乗っているだけ。Key の形は Store が確かめる（ここでは読むだけで、覚えない）。
    const apiKey: unknown = isRecord(request) ? request.apiKey : undefined

    return guarded(() =>
      resultOf(providerId, getAiProviderCredentialStore().setCredential(providerId, apiKey))
    )
  })

  handleIpc(IPC_CHANNELS.AI_PROVIDER_DELETE_CREDENTIAL, (request) => {
    const providerId = providerIdOf(request)

    return guarded(() =>
      resultOf(providerId, getAiProviderCredentialStore().deleteCredential(providerId))
    )
  })
}

function providerIdOf(request: unknown): SupportedProviderId {
  const providerId = isRecord(request) ? request.providerId : undefined

  if (!isSupportedProviderId(providerId)) {
    // 届いた値は文言に含めない。
    throw invalidRequest('unknown AI provider.')
  }

  return providerId
}

function resultOf(
  providerId: SupportedProviderId,
  written: AiProviderCredentialWriteResult
): AiProviderCredentialResult {
  const status: AiProviderCredentialStatus = getAiProviderCredentialStore().getStatus(providerId)

  if (written.ok) {
    return { ok: true, status }
  }

  // `unsupported-provider` は入口で拒んでいるので来ない。来ても保存できなかったとだけ言う。
  const failure = written.failure === 'unsupported-provider' ? 'write-failed' : written.failure

  return { ok: false, failure, status }
}

function guarded<T>(run: () => T): T {
  try {
    return run()
  } catch {
    throw new IpcError('INTERNAL', 'the AI provider credential operation failed.')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
