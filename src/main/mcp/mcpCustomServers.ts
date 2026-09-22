import type { McpCustomServerId } from '@shared/mcp'
import {
  MCP_CUSTOM_SERVERS_MAX,
  validateMcpCustomServerDraft,
  type McpCustomServerList,
  type McpCustomServerSaveOutcome,
  type McpCustomServerSummary,
  type McpStoredCustomServer,
  type McpStoredEnvVariable
} from '@shared/mcp/customServers'
import { createMcpCustomServerDefinition } from './mcpCustomServerDefinition'
import type { McpCustomServerStore } from './mcpCustomServerStore'
import type { McpSecretStore } from './mcpSecretStore'
import type { McpServerDefinition } from './mcpServerDefinition'

/**
 * 利用者が足した MCP サーバーの一覧・保存・削除・切り替え
 * （§21.3。Electron 非依存・テスト対象）。
 *
 * 登録簿（mcpCustomServerStore.ts）と秘密の保存先（mcpSecretStore.ts）の
 * **両方にまたがる手続き**をここに置く。IPC のハンドラは要求の形を確かめて
 * ここを呼ぶだけになる。
 *
 * ## 保存しても起動しない
 *
 * 保存は「登録簿へ書く」までで、サーバーは起動しない。接続テストは、保存の
 * 後に利用者が別に押す（mcpConnections.ts の `testConnection`）── 未保存の
 * 下書きを起動する経路は作らない。
 *
 * ## 書く順序
 *
 * ```
 * 保存 … 秘密の値（mcp-secrets.json）→ 行（mcp-servers.json）
 * 削除 … 行 → 秘密の値
 * ```
 *
 * どちらも「途中で失敗したときに、行があるのに秘密の値が無い」を避ける向きに
 * してある。逆（秘密の値だけが残る）は、暗号文が1つ余るだけで、起動には使われない。
 *
 * ## 変わったら、前の接続テストの結末を忘れる
 *
 * Command・引数・環境変数が変われば、前の結末はもう今の設定の話ではない
 * （mcpConnections.ts の `forgetLastTest`）。
 */

export interface McpCustomServersDependencies {
  readonly store: McpCustomServerStore
  readonly secrets: McpSecretStore
  /** 新しい id（`custom-` ＋ UUID）。 */
  readonly newId: () => McpCustomServerId
  /** 行が変わった・消えた（前の接続テストの結末を忘れる）。 */
  readonly onChanged: (id: McpCustomServerId) => void
}

export interface McpCustomServers {
  readonly list: () => McpCustomServerList
  /** 登録簿に在るか（IPC の入口で、id が今も在るかを確かめる）。 */
  readonly has: (id: McpCustomServerId) => boolean
  /** その行が有効か（サーバーごとの栓。全体の元栓は呼ぶ側が見る）。 */
  readonly isEnabled: (id: McpCustomServerId) => boolean
  /** 表の行（無ければ null）。秘密の値はそのつど読む。 */
  readonly definitionOf: (id: McpCustomServerId) => McpServerDefinition | null
  /** 新規（id が null）・編集。`rawDraft` は境界の外から来た値のまま渡す。 */
  readonly save: (id: McpCustomServerId | null, rawDraft: unknown) => McpCustomServerSaveOutcome
  /** 消す。無ければ null（Renderer の不具合）。 */
  readonly remove: (id: McpCustomServerId) => McpCustomServerList | null
  /** 有効 / 無効を切り替える。無ければ null（Renderer の不具合）。 */
  readonly setEnabled: (id: McpCustomServerId, enabled: boolean) => McpCustomServerList | null
}

export function createMcpCustomServers(deps: McpCustomServersDependencies): McpCustomServers {
  const { store, secrets } = deps

  function summarize(server: McpStoredCustomServer): McpCustomServerSummary {
    return {
      id: server.id,
      name: server.name,
      enabled: server.enabled,
      transport: server.transport,
      env: server.env.map((variable) =>
        variable.secret
          ? {
              name: variable.name,
              secret: true,
              stored: secrets.hasVariable(server.id, variable.name)
            }
          : variable
      )
    }
  }

  function list(): McpCustomServerList {
    return { servers: store.list().map(summarize), canStoreSecrets: secrets.canStore() }
  }

  return {
    list,

    has: (id) => store.get(id) !== null,

    isEnabled: (id) => store.get(id)?.enabled === true,

    definitionOf: (id) => {
      const server = store.get(id)

      return server === null
        ? null
        : createMcpCustomServerDefinition(server, (name) => secrets.readVariable(id, name))
    },

    save: (id, rawDraft) => {
      const checked = validateMcpCustomServerDraft(rawDraft)

      if (!checked.ok) {
        return {
          ok: false,
          failure: 'invalid',
          field: checked.field,
          reason: checked.reason,
          index: checked.index
        }
      }

      const { draft } = checked
      const servers = store.list()
      const existing = id === null ? null : (servers.find((server) => server.id === id) ?? null)

      if (id !== null && existing === null) {
        return { ok: false, failure: 'not-found' }
      }

      if (id === null && servers.length >= MCP_CUSTOM_SERVERS_MAX) {
        return { ok: false, failure: 'limit-reached' }
      }

      /*
        名前は一覧で見分けるための唯一の手がかりなので、重ならないようにする
        （大文字小文字は区別しない）。
      */
      const nameKey = draft.name.toLocaleLowerCase()

      if (
        servers.some((server) => server.id !== id && server.name.toLocaleLowerCase() === nameKey)
      ) {
        return {
          ok: false,
          failure: 'invalid',
          field: 'name',
          reason: 'duplicate-name',
          index: null
        }
      }

      const serverId = existing?.id ?? deps.newId()
      const secretValues = new Map<string, string | null>()

      for (const [index, variable] of draft.env.entries()) {
        if (!variable.secret) {
          continue
        }

        /*
          `null` は「今のまま」。今保存されていない（新しく足した・秘密に切り替えた）
          なら、残す値が無い。
        */
        if (variable.value === null && !secrets.hasVariable(serverId, variable.name)) {
          return { ok: false, failure: 'invalid', field: 'env', reason: 'secret-required', index }
        }

        secretValues.set(variable.name, variable.value)
      }

      const written = secrets.replaceVariables(serverId, secretValues)

      if (!written.ok) {
        return {
          ok: false,
          failure:
            written.failure === 'encryption-unavailable' ? 'encryption-unavailable' : 'write-failed'
        }
      }

      const server: McpStoredCustomServer = {
        id: serverId,
        name: draft.name,
        enabled: draft.enabled,
        transport: draft.transport,
        env: draft.env.map((variable): McpStoredEnvVariable =>
          variable.secret
            ? { name: variable.name, secret: true }
            : { name: variable.name, secret: false, value: variable.value }
        )
      }

      if (!store.put(server)) {
        return { ok: false, failure: 'write-failed' }
      }

      deps.onChanged(serverId)

      return { ok: true, server: summarize(server) }
    },

    remove: (id) => {
      if (store.get(id) === null) {
        return null
      }

      /*
        行を消せなかったら、秘密の値も残す（行だけが残って秘密の値が無い、を作らない）。
        応答は今の一覧で、消えていないことがそのまま画面に出る。
      */
      if (store.remove(id)) {
        secrets.clearVariables(id)
        deps.onChanged(id)
      }

      return list()
    },

    setEnabled: (id, enabled) => {
      const server = store.get(id)

      if (server === null) {
        return null
      }

      if (server.enabled !== enabled) {
        store.put({ ...server, enabled })
      }

      return list()
    }
  }
}
