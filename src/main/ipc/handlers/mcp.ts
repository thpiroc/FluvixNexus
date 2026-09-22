import {
  isMcpBuiltinConnectionId,
  isMcpConnectionId,
  isMcpCustomServerId,
  type McpBuiltinConnectionId,
  type McpConnectionId,
  type McpCustomServerId,
  type McpSecretState
} from '@shared/mcp'
import { IPC_CHANNELS } from '@shared/ipc'
import { McpRequestError } from '../../mcp/mcpOperations'
import { getMcpConnections, getMcpCustomServers, getMcpSecretStore } from '../../mcp/mcpService'
import { invalidRequest } from '../errors'
import { handleIpc } from '../registry'

/**
 * mcp ドメインのハンドラ。
 *
 * 要求から読むのは接続の id・操作名・引数だけで、接続の id は閉じた集合に
 * 載っているか（利用者が足したサーバーなら、登録簿に在るか）を確かめる
 * （shared/mcp）。操作名と引数は操作の表が確かめる（main/mcp/mcpOperations.ts）。
 * 起動するものは Main の表と登録簿が決める。
 *
 * ## token（§21.9）
 *
 * 入れる・消すの2本だけが token に触れる。**読み出す口は無い** ── 画面が
 * 今の値を見る必要は無く、口を作れば Renderer 側の不具合や差し替えで
 * token が外へ出る経路になる。入れた後・消した後に返すのは
 * 「どこから来ているか」だけ（`McpSecretState`）にほかならない。
 * token を持つのは組み込みの接続だけなので、この2本は組み込みの id しか受け付けない。
 *
 * ## 利用者が足したサーバー（§21.10）
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

  handleIpc(IPC_CHANNELS.MCP_CALL_OPERATION, async (request) => {
    const id = connectionIdOf(request)
    const { operation, arguments: rawArguments } = request as {
      readonly operation?: unknown
      readonly arguments?: unknown
    }

    if (typeof operation !== 'string') {
      throw invalidRequest('the MCP operation must be a string.')
    }

    return withRequestErrors(() => getMcpConnections().callOperation(id, operation, rawArguments))
  })

  handleIpc(IPC_CHANNELS.MCP_SET_SECRET, (request) => {
    const id = builtinConnectionIdOf(request)
    const { token } = request as { readonly token?: unknown }

    if (typeof token !== 'string') {
      throw invalidRequest('the MCP token must be a string.')
    }

    const written = getMcpSecretStore().write(id, token)

    /*
      token が変わったなら、前の token で試した結末はもう今の設定の話ではない
      （mcpConnections.ts の `forgetLastTest`）。断られた場合は何も変わって
      いないので、そのまま残す。
    */
    if (written.ok) {
      getMcpConnections().forgetLastTest(id)
    }

    /*
      形が通らない・暗号化できない、はどちらも利用者の PC で普通に起こることで、
      IPC の失敗にはしない（接続テストの結末と同じ扱い）。IPC の失敗になるのは
      要求そのものが壊れている場合だけになる。
    */
    return written.ok
      ? { ok: true, state: secretStateOf(id) }
      : { ok: false, failure: written.failure, state: secretStateOf(id) }
  })

  handleIpc(IPC_CHANNELS.MCP_CLEAR_SECRET, (request) => {
    const id = builtinConnectionIdOf(request)

    getMcpSecretStore().clear(id)
    getMcpConnections().forgetLastTest(id)

    /*
      消せたかどうかを返さず、消した後の在り処を返す。利用者が見たいのは
      「今どうなっているか」で、環境変数が残っていれば `environment` になる
      ── 「消したのにまだ繋がる」がそのまま画面に出る。
    */
    return secretStateOf(id)
  })

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

/**
 * token の在り処。接続の側から取るのは、**繋ぐときと同じ順序で解く**ため
 * （main/mcp/mcpConnections.ts の `resolveSecret`）── ここで独自に
 * 「保存 → 環境変数」を書くと、画面と実際の接続がずれうる。
 */
function secretStateOf(id: McpConnectionId): McpSecretState {
  return getMcpConnections().getStatus(id).secret
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
    利用者が足したサーバーは、形が合っていても登録簿に在るとは限らない
    （別の窓で消した・Renderer の不具合）。在るかどうかも入口で見る。
  */
  if (!isMcpConnectionId(id) || (isMcpCustomServerId(id) && !getMcpCustomServers().has(id))) {
    throw invalidRequest('unknown MCP connection.')
  }

  return id
}

/** token を持つ接続（組み込みの行）だけ。 */
function builtinConnectionIdOf(request: unknown): McpBuiltinConnectionId {
  const id = requestField(request, 'connectionId')

  if (!isMcpBuiltinConnectionId(id)) {
    throw invalidRequest('unknown MCP connection.')
  }

  return id
}

/** 利用者が足したサーバーの id（形と、登録簿に在るかの両方）。 */
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
