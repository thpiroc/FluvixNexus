import type { AgentApi } from '@shared/api'
import { IPC_EVENT_CHANNELS } from '@shared/ipc'
import { subscribeIpcEvent } from '../ipc/subscribe'

/**
 * agent ドメインの Preload API（FN Agent の File Write の提案。Security Core v1 の STEP7）。
 *
 * **購読だけを公開する。** Renderer から Agent の File Write を頼む API も、書き込む
 * 中身を渡す API も、承認を進める API もここには無い（承認の意思表示は STEP6 の
 * `approval` ドメインが持つ `respond` だけ）。
 *
 * Main → Renderer の向きしか無いのは意図したもので、Renderer が File Write Gate へ
 * 触れられる口を作らないため（fileWriteSurface.test.ts が見ている）。
 */
export const agentApi: AgentApi = {
  onFileWriteProposed: (listener) =>
    subscribeIpcEvent(IPC_EVENT_CHANNELS.AGENT_FILE_WRITE_PROPOSED, listener),
  onFileWriteSettled: (listener) =>
    subscribeIpcEvent(IPC_EVENT_CHANNELS.AGENT_FILE_WRITE_SETTLED, listener)
}
