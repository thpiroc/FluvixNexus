import { isMcpConnectionId, type McpConnectionId, type McpSecretState } from '@shared/mcp'
import { IPC_CHANNELS } from '@shared/ipc'
import { McpRequestError } from '../../mcp/mcpOperations'
import { getMcpConnections, getMcpSecretStore } from '../../mcp/mcpService'
import { invalidRequest } from '../errors'
import { handleIpc } from '../registry'

/**
 * mcp ドメインのハンドラ。
 *
 * 要求から読むのは接続の id・操作名・引数だけで、接続の id は閉じた集合に
 * 載っているかを確かめる（shared/mcp）。操作名と引数は操作の表が確かめる
 * （main/mcp/mcpOperations.ts）。起動するものは Main の表が決める。
 *
 * ## token（§21.9）
 *
 * 入れる・消すの2本だけが token に触れる。**読み出す口は無い** ── 画面が
 * 今の値を見る必要は無く、口を作れば Renderer 側の不具合や差し替えで
 * token が外へ出る経路になる。入れた後・消した後に返すのは
 * 「どこから来ているか」だけ（`McpSecretState`）にほかならない。
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

  handleIpc(IPC_CHANNELS.MCP_SET_SECRET, (request) => {
    const id = connectionIdOf(request)
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
    const id = connectionIdOf(request)

    getMcpSecretStore().clear(id)
    getMcpConnections().forgetLastTest(id)

    /*
      消せたかどうかを返さず、消した後の在り処を返す。利用者が見たいのは
      「今どうなっているか」で、環境変数が残っていれば `environment` になる
      ── 「消したのにまだ繋がる」がそのまま画面に出る。
    */
    return secretStateOf(id)
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
