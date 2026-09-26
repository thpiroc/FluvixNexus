import type { AiProviderApi } from '@shared/api'
import { IPC_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'

/**
 * ai-provider ドメインの Preload API（FN Agent の AI Provider の API Key。STEP10-5）。
 *
 * 他のドメインと同じく IPC を包むだけ。**Key を Renderer へ返す関数は無い**（設定済みか・設定・
 * 削除の3つだけ。aiProviderCredentialSurface.test.ts が見ている）。Key は要求の欄として素通しし、
 * ここで覚えることも確かめることもしない（確かめるのは Main）。
 */
export const aiProviderApi: AiProviderApi = {
  hasCredential: (request) => invokeIpc(IPC_CHANNELS.AI_PROVIDER_HAS_CREDENTIAL, request),
  setCredential: (request) => invokeIpc(IPC_CHANNELS.AI_PROVIDER_SET_CREDENTIAL, request),
  deleteCredential: (request) => invokeIpc(IPC_CHANNELS.AI_PROVIDER_DELETE_CREDENTIAL, request)
}
