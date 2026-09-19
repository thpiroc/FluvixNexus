import { isMcpConnectionId, type McpConnectionId } from '@shared/mcp'
import { IPC_CHANNELS } from '@shared/ipc'
import { McpRequestError } from '../../mcp/mcpOperations'
import { getMcpConnections } from '../../mcp/mcpService'
import { invalidRequest } from '../errors'
import { handleIpc } from '../registry'

/**
 * mcp ドメインのハンドラ。
 *
 * 要求から読むのは接続の id・操作名・引数だけで、接続の id は閉じた集合に
 * 載っているかを確かめる（shared/mcp）。操作名と引数は操作の表が確かめる
 * （main/mcp/mcpOperations.ts）。起動するもの・token は Main の表と環境変数から決まる。
 */
export function registerMcpHandlers(): void {
  handleIpc(IPC_CHANNELS.MCP_GET_STATUS, (request) =>
    getMcpConnections().getStatus(connectionIdOf(request))
  )

  handleIpc(IPC_CHANNELS.MCP_TEST_CONNECTION, (request) =>
    getMcpConnections().testConnection(connectionIdOf(request))
  )

  handleIpc(IPC_CHANNELS.MCP_CALL_OPERATION, async (request) => {
    const id = connectionIdOf(request)
    const { operation, arguments: rawArguments } = request as {
      readonly operation?: unknown
      readonly arguments?: unknown
    }

    if (typeof operation !== 'string') {
      throw invalidRequest('the MCP operation must be a string.')
    }

    try {
      return await getMcpConnections().callOperation(id, operation, rawArguments)
    } catch (cause) {
      if (cause instanceof McpRequestError) {
        throw invalidRequest(cause.message)
      }

      throw cause
    }
  })
}

/** Renderer からの値は型どおりとは限らない（UI は迂回されうる）。 */
function connectionIdOf(request: unknown): McpConnectionId {
  const id =
    typeof request === 'object' && request !== null
      ? (request as { readonly connectionId?: unknown }).connectionId
      : undefined

  if (!isMcpConnectionId(id)) {
    throw invalidRequest('unknown MCP connection.')
  }

  return id
}
