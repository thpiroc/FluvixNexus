import type { McpApi } from '@shared/api'
import { IPC_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'

/**
 * mcp ドメインの Preload API。
 *
 * 他のドメインと同じく「IPC 呼び出しを型付きの関数に包んだだけ」に留める。
 * MCP サーバーの起動も、その token もここには無い ── 扱うのは Main だけ
 * （main/mcp/）。
 */
export const mcpApi: McpApi = {
  getStatus: (request) => invokeIpc(IPC_CHANNELS.MCP_GET_STATUS, request),
  testConnection: (request) => invokeIpc(IPC_CHANNELS.MCP_TEST_CONNECTION, request),
  callOperation: (request) => invokeIpc(IPC_CHANNELS.MCP_CALL_OPERATION, request),
  setSecret: (request) => invokeIpc(IPC_CHANNELS.MCP_SET_SECRET, request),
  clearSecret: (request) => invokeIpc(IPC_CHANNELS.MCP_CLEAR_SECRET, request)
}
