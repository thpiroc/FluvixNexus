import type { McpApi } from '@shared/api'
import { IPC_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'

/**
 * mcp ドメインの Preload API。
 *
 * 他のドメインと同じく「IPC 呼び出しを型付きの関数に包んだだけ」に留める。
 * MCP サーバーの起動も、秘密の値の読み出しもここには無い ── 扱うのは Main だけ
 * （main/mcp/）。ツールを呼ぶ口も置かない。
 */
export const mcpApi: McpApi = {
  getStatus: (request) => invokeIpc(IPC_CHANNELS.MCP_GET_STATUS, request),
  testConnection: (request) => invokeIpc(IPC_CHANNELS.MCP_TEST_CONNECTION, request),
  listCustomServers: () => invokeIpc(IPC_CHANNELS.MCP_LIST_CUSTOM_SERVERS),
  saveCustomServer: (request) => invokeIpc(IPC_CHANNELS.MCP_SAVE_CUSTOM_SERVER, request),
  deleteCustomServer: (request) => invokeIpc(IPC_CHANNELS.MCP_DELETE_CUSTOM_SERVER, request),
  setCustomServerEnabled: (request) =>
    invokeIpc(IPC_CHANNELS.MCP_SET_CUSTOM_SERVER_ENABLED, request)
}
