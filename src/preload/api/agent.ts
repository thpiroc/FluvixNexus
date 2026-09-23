import type { AgentApi } from '@shared/api'
import { IPC_EVENT_CHANNELS } from '@shared/ipc'
import { subscribeIpcEvent } from '../ipc/subscribe'

/**
 * agent ドメインの Preload API（FN Agent の File Write の提案は STEP7、Terminal の提案は STEP8）。
 *
 * **購読だけを公開する。** Renderer から Agent の File Write・コマンドの実行を頼む
 * API も、書き込む中身・実行する argv を渡す API も、承認を進める API もここには無い
 * （承認の意思表示は STEP6 の `approval` ドメインが持つ `respond` だけ）。
 *
 * Main → Renderer の向きしか無いのは意図したもので、Renderer が File Write Gate・
 * Command Runner へ触れられる口を作らないため（fileWriteSurface.test.ts /
 * terminalRunSurface.test.ts が見ている）。
 */
export const agentApi: AgentApi = {
  onFileWriteProposed: (listener) =>
    subscribeIpcEvent(IPC_EVENT_CHANNELS.AGENT_FILE_WRITE_PROPOSED, listener),
  onFileWriteSettled: (listener) =>
    subscribeIpcEvent(IPC_EVENT_CHANNELS.AGENT_FILE_WRITE_SETTLED, listener),
  onTerminalProposed: (listener) =>
    subscribeIpcEvent(IPC_EVENT_CHANNELS.AGENT_TERMINAL_PROPOSED, listener),
  onTerminalSettled: (listener) =>
    subscribeIpcEvent(IPC_EVENT_CHANNELS.AGENT_TERMINAL_SETTLED, listener)
}
