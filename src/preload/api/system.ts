import type { SystemApi } from '@shared/api'
import { IPC_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'

/**
 * system ドメインの Preload API。
 *
 * Preload のドメイン API は「IPC 呼び出しを型付きの関数に包んだだけ」に留める。
 * 判断・加工・キャッシュを入れると、Main と Renderer の間に第三の実装が生まれてしまう。
 * Files / Terminal / GitHub の API も同じ薄さで api/<domain>.ts として追加する。
 */
export const systemApi: SystemApi = {
  ping: (request) => invokeIpc(IPC_CHANNELS.SYSTEM_PING, request),
  getAppInfo: () => invokeIpc(IPC_CHANNELS.SYSTEM_APP_INFO)
}
