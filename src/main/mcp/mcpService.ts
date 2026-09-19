import { app, dialog } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { normalizeLanguageId, type LanguageId } from '@shared/language'
import { createLogger } from '../logger'
import { currentPlatform } from '../platform'
import { readSettingsSections } from '../store/settings'
import { getMainWindow } from '../windows/mainWindow'
import {
  createMcpConnections,
  type McpConnections,
  type McpWriteConfirmation
} from './mcpConnections'
import type { BundledNodeScriptLaunch } from './mcpServerLaunch'
import { createMcpStdioTransport } from './mcpStdioTransport'

const log = createLogger('mcp')

let connections: McpConnections | null = null

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
    confirmWrite
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
  return normalizeLanguageId(readSettingsSections().general.language)
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
