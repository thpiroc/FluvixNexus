import { join } from 'path'
import { isMcpCustomServerId, type McpCustomServerId } from '@shared/mcp'
import {
  readMcpCustomServerName,
  readMcpCustomServerTransport,
  readMcpEnvVariablePlainValue,
  readMcpEnvVariables,
  type McpStoredCustomServer,
  type McpStoredEnvVariable
} from '@shared/mcp/customServers'
import { readJsonFile, writeJsonFile } from '../store/jsonFile'

/**
 * 利用者が足した MCP サーバーの登録簿（§21.10。Electron 非依存・テスト対象）。
 *
 * ```
 * userData/mcp-servers.json   { version: 1, servers: [ { id, name, enabled, transport, env } ] }
 * ```
 *
 * ## `settings.json` とは別のファイル
 *
 * 設定の section は平らな素の値しか持てず（main/store/settingsSections.ts）、
 * 「設定ファイルが起動するものを決める場所」にしないと決めてある。
 * 起動するもの（Command・引数）を持つ行は、Main だけが書くこのファイルへ置く
 * （Debug Profile の `debug-profiles.json` と同じ分け方）。
 *
 * 秘密の環境変数の**値**はここに無い（`{ name, secret: true }` だけ）。値は
 * OS の資格情報で暗号化した `mcp-secrets.json` にある（mcpSecretStore.ts）。
 *
 * ## 読んだ中身も、境界の外から来た値として扱う
 *
 * 利用者が手で書き換えられる場所にあるので、読むたびに**保存するときと同じ規則**
 * （shared/mcp/customServers.ts）を1件ずつ通し、通らない行だけを落とす。
 * 保存したときに通ったことを、起動してよい理由にしない。
 *
 * ## 読めないファイルには書かない
 *
 * JSON として読めない・知らない版、のときは、その中身を「無い」として扱うが、
 * **上書きもしない**（`put` / `remove` が断る）。新しい版のアプリが書いたファイルを、
 * 古い版が空で塗りつぶすのを避けるため。
 *
 * ## 覚えない
 *
 * mcpSecretStore.ts と同じく、読むたびにディスクを見る。読むのは Settings を
 * 開いている間と接続のたびだけで、覚えると「消したのにまだ繋がる」が生まれる。
 */

export const MCP_SERVERS_FILE_NAME = 'mcp-servers.json'

const MCP_SERVERS_SCHEMA_VERSION = 1

export interface McpCustomServerStore {
  /** 登録されている行（保存された順）。 */
  readonly list: () => readonly McpStoredCustomServer[]
  readonly get: (id: McpCustomServerId) => McpStoredCustomServer | null
  /** 足す・置き換える（同じ id があれば、その位置で置き換える）。書けたか。 */
  readonly put: (server: McpStoredCustomServer) => boolean
  /** 消す。無かった場合も成功として扱う。 */
  readonly remove: (id: McpCustomServerId) => boolean
}

export type McpCustomServerStoreReporter = (message: string, ...details: readonly unknown[]) => void

export interface McpCustomServerStoreOptions {
  readonly onIssue?: McpCustomServerStoreReporter
}

interface DocumentRead {
  /** 上書きしてよいか（無い・読めた、なら真。読めない・知らない版なら偽）。 */
  readonly writable: boolean
  readonly servers: readonly McpStoredCustomServer[]
}

export function createMcpCustomServerStore(
  directory: string,
  options: McpCustomServerStoreOptions = {}
): McpCustomServerStore {
  const filePath = join(directory, MCP_SERVERS_FILE_NAME)
  const report = options.onIssue ?? ((): void => {})

  function readDocument(): DocumentRead {
    const found = readJsonFile(filePath)

    if (found.kind === 'missing') {
      return { writable: true, servers: [] }
    }

    if (found.kind !== 'present') {
      report(`${MCP_SERVERS_FILE_NAME} could not be read.`, found.cause)
      return { writable: false, servers: [] }
    }

    const parsed = parseMcpCustomServersDocument(found.raw)

    if (parsed === null) {
      report(`${MCP_SERVERS_FILE_NAME} has an unknown version or shape.`)
      return { writable: false, servers: [] }
    }

    if (parsed.dropped > 0) {
      report(`${MCP_SERVERS_FILE_NAME}: ignored ${parsed.dropped} unreadable server(s).`)
    }

    return { writable: true, servers: parsed.servers }
  }

  function writeDocument(servers: readonly McpStoredCustomServer[]): boolean {
    const written = writeJsonFile(filePath, { version: MCP_SERVERS_SCHEMA_VERSION, servers })

    if (!written.ok) {
      report(`${MCP_SERVERS_FILE_NAME} could not be written.`, written.cause)
    }

    return written.ok
  }

  return {
    list: () => readDocument().servers,

    get: (id) => readDocument().servers.find((server) => server.id === id) ?? null,

    put: (server) => {
      const document = readDocument()

      if (!document.writable) {
        return false
      }

      const index = document.servers.findIndex((existing) => existing.id === server.id)
      const servers =
        index === -1
          ? [...document.servers, server]
          : document.servers.map((existing, position) => (position === index ? server : existing))

      return writeDocument(servers)
    },

    remove: (id) => {
      const document = readDocument()

      if (!document.servers.some((server) => server.id === id)) {
        return true
      }

      if (!document.writable) {
        return false
      }

      return writeDocument(document.servers.filter((server) => server.id !== id))
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * ファイルの中身を読む。エンベロープ（版・`servers`）が読めなければ null。
 *
 * 行が1つ壊れていても全部は捨てない ── その行だけを落とし、数を返す。
 * id が重なった行は、先に現れた方だけを残す。
 */
export function parseMcpCustomServersDocument(
  raw: unknown
): { readonly servers: readonly McpStoredCustomServer[]; readonly dropped: number } | null {
  if (!isRecord(raw) || raw.version !== MCP_SERVERS_SCHEMA_VERSION || !Array.isArray(raw.servers)) {
    return null
  }

  const servers: McpStoredCustomServer[] = []
  const seen = new Set<string>()
  let dropped = 0

  for (const item of raw.servers) {
    const server = parseMcpStoredCustomServer(item)

    if (server === null || seen.has(server.id)) {
      dropped += 1
      continue
    }

    seen.add(server.id)
    servers.push(server)
  }

  return { servers, dropped }
}

/**
 * 保存された行1つ。読めなければ null（その行だけを落とす）。
 *
 * `enabled` が真偽値でなければ**無効**として読む ── 壊れたファイルで外部への
 * 接続が有効にならないように（shared/mcp/settings.ts の既定と同じ向き）。
 * 環境変数が1つでも読めなければ行ごと落とす。欠けた環境変数のまま起動すると、
 * 利用者の意図と違う設定でサーバーが動く。
 */
export function parseMcpStoredCustomServer(raw: unknown): McpStoredCustomServer | null {
  if (!isRecord(raw) || !isMcpCustomServerId(raw.id)) {
    return null
  }

  const name = readMcpCustomServerName(raw.name)
  const transport = readMcpCustomServerTransport(raw.transport)
  const env = readMcpEnvVariables<McpStoredEnvVariable>(raw.env, (item, variableName, index) => {
    if (item.secret === true) {
      return { ok: true, value: { name: variableName, secret: true } }
    }

    const value = readMcpEnvVariablePlainValue(item.value, index)
    return value.ok
      ? { ok: true, value: { name: variableName, secret: false, value: value.value } }
      : value
  })

  if (!name.ok || !transport.ok || !env.ok) {
    return null
  }

  return {
    id: raw.id,
    name: name.value,
    enabled: raw.enabled === true,
    transport: transport.value,
    env: env.value
  }
}
