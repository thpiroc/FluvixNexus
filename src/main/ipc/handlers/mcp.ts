import {
  isMcpConnectionId,
  isMcpCustomServerId,
  type McpConnectionId,
  type McpCustomServerId
} from '@shared/mcp'
import { IPC_CHANNELS } from '@shared/ipc'
import { McpRequestError } from '../../mcp/mcpOperations'
import { getMcpConnections, getMcpCustomServers } from '../../mcp/mcpService'
import { invalidRequest } from '../errors'
import { handleIpc } from '../registry'

/**
 * mcp ドメインのハンドラ（MCP Server Manager）。
 *
 * 要求から読むのは接続の id だけで、形が合っているか・登録簿に在るかを
 * 入口で確かめる（shared/mcp）。起動するものは Main が登録簿から読む。
 *
 * ## ツールを呼ぶ口は無い
 *
 * Renderer から MCP のツールを呼ぶ IPC は置かない。ツールの呼び出しは Main の中だけの
 * 手続き（main/mcp/mcpConnections.ts の `callOperation`）で、FN Agent からは
 * Security Core を通して使う（DESIGN.md §6）。
 *
 * ## 登録（保存・削除・有効 / 無効）
 *
 * Command・引数・秘密の値が Renderer から届くのは**保存の口だけ**。下書きは
 * ここでは形を見ず、そのまま `save` へ渡す ── 検証は shared/mcp/customServers.ts
 * の1つだけで、画面の案内と同じ規則になる。通らない下書きは IPC の失敗ではなく
 * `failure: 'invalid'` として返す（利用者の入力で普通に起こることなので、
 * 画面が理由を出せるように）。保存しても起動はしない。応答にも秘密の値は載らない。
 */
export function registerMcpHandlers(): void {
  handleIpc(IPC_CHANNELS.MCP_GET_STATUS, (request) =>
    withRequestErrors(() => getMcpConnections().getStatus(connectionIdOf(request)))
  )

  handleIpc(IPC_CHANNELS.MCP_TEST_CONNECTION, (request) =>
    withRequestErrors(() => getMcpConnections().testConnection(connectionIdOf(request)))
  )

  handleIpc(IPC_CHANNELS.MCP_LIST_CUSTOM_SERVERS, () => getMcpCustomServers().list())

  handleIpc(IPC_CHANNELS.MCP_SAVE_CUSTOM_SERVER, (request) => {
    const { id, draft } = (typeof request === 'object' && request !== null ? request : {}) as {
      readonly id?: unknown
      readonly draft?: unknown
    }

    // 在るかどうかは `save` が見る（無ければ `not-found`。別の窓で消した場合がある）。
    if (id !== null && !isMcpCustomServerId(id)) {
      throw invalidRequest('unknown MCP server.')
    }

    return getMcpCustomServers().save(id, draft)
  })

  handleIpc(IPC_CHANNELS.MCP_DELETE_CUSTOM_SERVER, (request) => {
    const listed = getMcpCustomServers().remove(customServerIdOf(request))

    if (listed === null) {
      throw invalidRequest('unknown MCP server.')
    }

    return listed
  })

  handleIpc(IPC_CHANNELS.MCP_SET_CUSTOM_SERVER_ENABLED, (request) => {
    const id = customServerIdOf(request)
    const { enabled } = request as { readonly enabled?: unknown }

    if (typeof enabled !== 'boolean') {
      throw invalidRequest('the MCP server switch must be a boolean.')
    }

    const listed = getMcpCustomServers().setEnabled(id, enabled)

    if (listed === null) {
      throw invalidRequest('unknown MCP server.')
    }

    return listed
  })
}

function requestField(request: unknown, key: string): unknown {
  return typeof request === 'object' && request !== null
    ? (request as Readonly<Record<string, unknown>>)[key]
    : undefined
}

/** Renderer からの値は型どおりとは限らない（UI は迂回されうる）。 */
function connectionIdOf(request: unknown): McpConnectionId {
  const id = requestField(request, 'connectionId')

  /*
    形が合っていても登録簿に在るとは限らない（別の窓で消した・Renderer の不具合）。
    在るかどうかも入口で見る。
  */
  if (!isMcpConnectionId(id) || !getMcpCustomServers().has(id)) {
    throw invalidRequest('unknown MCP connection.')
  }

  return id
}

/** 登録したサーバーの id（形と、登録簿に在るかの両方）。 */
function customServerIdOf(request: unknown): McpCustomServerId {
  const id = requestField(request, 'id')

  if (!isMcpCustomServerId(id) || !getMcpCustomServers().has(id)) {
    throw invalidRequest('unknown MCP server.')
  }

  return id
}

/** 接続の側が「知らない接続・操作」として投げたものを、IPC の INVALID_REQUEST へ。 */
async function withRequestErrors<T>(work: () => T | Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (cause) {
    if (cause instanceof McpRequestError) {
      throw invalidRequest(cause.message)
    }

    throw cause
  }
}
