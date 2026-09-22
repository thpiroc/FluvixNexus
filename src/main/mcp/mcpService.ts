import { app, dialog, safeStorage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { normalizeLanguageId, type LanguageId } from '@shared/language'
import type { McpConnectionId } from '@shared/mcp'
import { isMcpConnectionEnabled, normalizeMcpPreferences } from '@shared/mcp/settings'
import { createLogger } from '../logger'
import { currentPlatform } from '../platform'
import { readUserSettingsSections } from '../store/settings'
import { getMainWindow } from '../windows/mainWindow'
import {
  createMcpConnections,
  type McpConnections,
  type McpWriteConfirmation
} from './mcpConnections'
import { createMcpSecretStore, type McpSecretStore } from './mcpSecretStore'
import type { BundledNodeScriptLaunch } from './mcpServerLaunch'
import { createMcpStdioTransport } from './mcpStdioTransport'

const log = createLogger('mcp')

let connections: McpConnections | null = null
let secrets: McpSecretStore | null = null

/**
 * token の保存先（アプリに1つ）。
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
 * Settings の MCP の設定（§21.9）。
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
    bundledPackageDirectory,
    /*
      同梱したサーバーは、アプリ自身の実行ファイルを Node として動かす
      （利用者の PC に Node が無くてよい。mcpServerLaunch.ts）。
      `ELECTRON_RUN_AS_NODE` はこの子プロセスの環境にだけ付き、Main には付かない。
    */
    nodeRuntime: { file: process.execPath, environment: { ELECTRON_RUN_AS_NODE: '1' } },
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
    confirmWrite,
    /*
      有効かどうかも token も、**呼ばれるたびに読み直す**。覚えると、
      Settings で有効にした直後・token を入れた直後に、まだ古い答えが返る。
      どちらもディスクの読み1回で、接続のたびにしか起きない。
    */
    isEnabled: (id: McpConnectionId) => isMcpConnectionEnabled(mcpPreferences(), id),
    readStoredToken: (id: McpConnectionId) => getMcpSecretStore().read(id),
    canStoreToken: () => getMcpSecretStore().canStore()
  })

  return connections
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

/**
 * 同梱したサーバーの置き場所。
 *
 * 配布物では electron-builder.yml の `extraResources` が
 * `resources/mcp-servers/<bundleName>` へ写す（asar の外 ── 子プロセスの Node が
 * そのまま読めるように）。開発時は写す前の `node_modules/<packageName>` を読む。
 */
function bundledPackageDirectory(launch: BundledNodeScriptLaunch): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'mcp-servers', launch.bundleName)
    : join(app.getAppPath(), 'node_modules', ...launch.packageName.split('/'))
}

function currentLanguage(): LanguageId {
  // 表示言語はユーザー設定専用（shared/settings/scope.ts）。main/windows/mainWindow.ts と同じ読み方。
  return normalizeLanguageId(readUserSettingsSections().general.language)
}

const CONFIRM_BUTTONS: Record<LanguageId, readonly [string, string]> = {
  ja: ['実行する', 'キャンセル'],
  en: ['Run', 'Cancel']
}

/**
 * 書き込みの確認（ネイティブのダイアログ）。
 *
 * Renderer の画面ではなく Main が出す ── Renderer の中の確認は、Renderer 自身が
 * 飛ばせてしまう。既定のボタン（Enter）とキャンセル（Esc）はどちらも
 * 「キャンセル」にしてあり、うっかり押しても書き込まない。
 */
async function confirmWrite(confirmation: McpWriteConfirmation): Promise<boolean> {
  const window = getMainWindow()

  if (window === null) {
    // 確認を出す先が無い。黙って書き込まない。
    return false
  }

  const [run, cancel] = CONFIRM_BUTTONS[currentLanguage()]
  const { response } = await dialog.showMessageBox(window, {
    type: 'question',
    title: 'Fluvix Nexus',
    message: confirmation.title,
    detail: confirmation.detail,
    buttons: [run, cancel],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  })

  return response === 0
}
