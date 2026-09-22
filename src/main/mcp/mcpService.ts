import { app, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { normalizeLanguageId, type LanguageId } from '@shared/language'
import type { McpConnectionId } from '@shared/mcp'
import { normalizeMcpPreferences } from '@shared/mcp/settings'
import { createLogger } from '../logger'
import { currentPlatform } from '../platform'
import { readUserSettingsSections } from '../store/settings'
import { createMcpConnections, type McpConnections } from './mcpConnections'
import { createMcpCustomServerStore } from './mcpCustomServerStore'
import { createMcpCustomServers, type McpCustomServers } from './mcpCustomServers'
import { removeLegacyNotionSecret } from './mcpLegacyNotionCleanup'
import { createMcpSecretStore, type McpSecretStore } from './mcpSecretStore'
import { createMcpStdioTransport } from './mcpStdioTransport'

const log = createLogger('mcp')

let connections: McpConnections | null = null
let secrets: McpSecretStore | null = null
let customServers: McpCustomServers | null = null

/**
 * 秘密の環境変数の保存先（アプリに1つ）。
 *
 * `safeStorage` をそのまま渡す ── Electron の API をこの層でだけ見て、
 * 保存の手続きは mcpSecretStore.ts が持つ（Vitest から読み込める側に置く）。
 */
export function getMcpSecretStore(): McpSecretStore {
  secrets ??= createMcpSecretStore(app.getPath('userData'), safeStorage, {
    onIssue: (message, ...details) => {
      log.warn(message, ...details)
    }
  })

  return secrets
}

/**
 * MCP Server Manager に登録したサーバー（アプリに1つ）。
 *
 * 登録簿（`mcp-servers.json`）も秘密の保存先も userData にある。id は Main が作る
 * （`custom-` ＋ UUID）── Renderer が id を決める経路は無い。
 */
export function getMcpCustomServers(): McpCustomServers {
  customServers ??= createMcpCustomServers({
    store: createMcpCustomServerStore(app.getPath('userData'), {
      onIssue: (message, ...details) => {
        log.warn(message, ...details)
      }
    }),
    secrets: getMcpSecretStore(),
    newId: () => `custom-${randomUUID()}`,
    // Command・引数・環境変数が変わったら、前の接続テストの結末はもう今の設定の話ではない。
    onChanged: (id) => {
      connections?.forgetLastTest(id)
    }
  })

  return customServers
}

/**
 * Settings の MCP の設定（全体の元栓）。
 *
 * `readUserSettingsSections` を読むのは、この section が application scope
 * だからにほかならない（shared/settings/scope.ts）── ワークスペース設定で
 * 上書きできる値ではないので、効く値を解く必要が無い。
 */
function mcpPreferences(): ReturnType<typeof normalizeMcpPreferences> {
  return normalizeMcpPreferences(readUserSettingsSections().mcp)
}

/**
 * MCP の接続（アプリに1つ）。Electron / OS から値を集めて渡すのはここだけで、
 * 手続きそのものは mcpConnections.ts が持つ。
 *
 * 作るのは最初に使われたとき ── 使わない利用者のために起動時の仕事を増やさない。
 */
export function getMcpConnections(): McpConnections {
  connections ??= createMcpConnections({
    env: () => process.env,
    platform: currentPlatform,
    exists: existsSync,
    /*
      サーバーの作業ディレクトリは Workspace にしない。MCP サーバーの起動に
      利用者が開いたフォルダの中身を手がかりにしない（mcpServerLaunch.ts）。
    */
    cwd: () => app.getPath('userData'),
    createTransport: createMcpStdioTransport,
    clientInfo: { name: 'Fluvix Nexus', version: app.getVersion() },
    now: () => new Date(),
    log,
    language: currentLanguage,
    /*
      MCP の書き込みを許可する経路は今は無い（DESIGN.md §6: v1 では使わない）。
      書き込みの操作が表に載っても、確かめずに断る ── 許可するかを決めるのは
      将来の Security Core で、ここで利用者に訊く形にはしない。
    */
    confirmWrite: () => Promise.resolve(false),
    /*
      有効かどうかも登録簿も、**呼ばれるたびに読み直す**。覚えると、
      Settings で有効にした直後・登録を変えた直後に、まだ古い答えが返る。
      どちらもディスクの読み1回で、接続のたびにしか起きない。
    */
    isEnabled: (id: McpConnectionId) =>
      // 全体の元栓（mcp.enabled）と、そのサーバーの栓の両方。
      mcpPreferences().enabled && getMcpCustomServers().isEnabled(id),
    definitionOf: (id: McpConnectionId) => getMcpCustomServers().definitionOf(id)
  })

  return connections
}

/**
 * 旧 Notion MCP の token を `mcp-secrets.json` から取り除く（起動時。何度呼んでも同じ）。
 *
 * 登録したサーバーの秘密の値には触れない（mcpLegacyNotionCleanup.ts）。
 */
export function removeLegacyMcpSecrets(): void {
  const result = removeLegacyNotionSecret(app.getPath('userData'), (message, ...details) => {
    log.warn(message, ...details)
  })

  if (result === 'removed') {
    log.info('removed the legacy Notion MCP token from mcp-secrets.json.')
  }
}

/**
 * 動いている MCP サーバーを終わらせる（will-quit）。
 *
 * 一度も使っていなければ何もしない。待たずに kill する ── will-quit は同期で、
 * 終わるのを待つ間にアプリが先に閉じる。
 */
export function stopMcpConnections(): void {
  connections?.terminateAll()
}

function currentLanguage(): LanguageId {
  // 表示言語はユーザー設定専用（shared/settings/scope.ts）。main/windows/mainWindow.ts と同じ読み方。
  return normalizeLanguageId(readUserSettingsSections().general.language)
}
