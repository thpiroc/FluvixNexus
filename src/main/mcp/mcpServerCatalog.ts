import type { McpConnectionId } from '@shared/mcp'
import { readMcpToken, type McpTokenRead } from './mcpConfig'
import type { AnyMcpOperationDefinition } from './mcpOperations'
import {
  createMcpServerEnvironment as buildServerEnvironment,
  type McpServerEnvironmentProfile
} from './mcpServerEnvironment'
import {
  resolveMcpServerLaunch,
  type McpLaunchContext,
  type McpServerCommandResolution,
  type McpServerLaunch
} from './mcpServerLaunch'
import { NOTION_MCP_SERVER } from './notionMcpServer'

/**
 * どの MCP サーバーを、どこから、どう起動するかを決める表
 * （MCP 共通。Electron / fs / child_process 非依存・テスト対象）。
 *
 * Language Server の表（main/lsp/languageServerCatalog.ts）と同じ形にしてある。
 * Renderer が指せるのは行（`McpConnectionId`）だけで、実行ファイル・引数・
 * 環境変数・token の読み方は Main のこの表だけが持つ。
 *
 * ## 行の中身はサーバーごとのファイルに置く
 *
 * このファイルは行を並べるだけで、特定のサーバーについて何も知らない。
 *
 * | id       | 行の定義                                      |
 * | -------- | --------------------------------------------- |
 * | `notion` | notionMcpServer.ts / notionMcpOperations.ts   |
 *
 * 行を増やすときに書くのは次の4つ（型がどの漏れも拾う）。
 *
 *   1. サーバーの定義（`McpServerDefinition`。起動のしかた・秘密情報・環境変数）
 *   2. 操作表（`AnyMcpOperationDefinition` の表。mcpOperations.ts）
 *   3. ここの `MCP_SERVER_DEFINITIONS` に1行
 *   4. shared/mcp の `MCP_CONNECTION_IDS` に1語（と、Renderer 向けの操作の語彙）
 *
 * 同梱するサーバーなら、electron-builder.yml の `extraResources` と
 * tools/third-party-notices.mjs の `BUNDLED_PACKAGES` にも1行ずつ足す。
 */

/** 秘密情報（token）の読み方。 */
export interface McpServerSecret {
  /** 読むアプリ側の環境変数（`FLUVIX_` で始める ── 子へは渡らない）。 */
  readonly variable: string
}

/** 行1つ分の定義。 */
export interface McpServerDefinition {
  /** 起動のしかた（mcpServerLaunch.ts）。 */
  readonly launch: McpServerLaunch
  /** 秘密情報が要るサーバーだけが持つ。無ければ null。 */
  readonly secret: McpServerSecret | null
  /**
   * サーバーが読む設定の変数と、そこへ渡す値（mcpServerEnvironment.ts）。
   * `secret` が null の行では、引数は常に null になる。
   */
  readonly environment: (secret: string | null) => McpServerEnvironmentProfile
  /**
   * Renderer から呼べる操作（mcpOperations.ts）。ここに無い操作名は断る
   * ── サーバーが公開しているツールでも、表に載せなければ呼べない。
   */
  readonly operations: Readonly<Record<string, AnyMcpOperationDefinition>>
}

export const MCP_SERVER_DEFINITIONS: Readonly<Record<McpConnectionId, McpServerDefinition>> = {
  notion: NOTION_MCP_SERVER
}

export type { McpServerCommand, McpServerCommandResolution } from './mcpServerLaunch'

export function resolveMcpServerCommand(
  id: McpConnectionId,
  context: McpLaunchContext
): McpServerCommandResolution {
  return resolveMcpServerLaunch(MCP_SERVER_DEFINITIONS[id].launch, context)
}

/**
 * 秘密情報を読む。秘密情報の要らない行では、常に `{ ok: true, token: null }`。
 */
export function resolveMcpServerToken(
  id: McpConnectionId,
  env: Readonly<Record<string, string | undefined>>
): McpTokenRead | { readonly ok: true; readonly token: null } {
  const secret = MCP_SERVER_DEFINITIONS[id].secret

  return secret === null ? { ok: true, token: null } : readMcpToken(env, secret.variable)
}

/**
 * MCP サーバーへ渡す環境変数。token は引数ではなく環境変数で渡す
 * （引数は同じ PC のほかのプロセスから見える。タスクマネージャーのコマンドライン列など）。
 */
export function createMcpServerEnvironment(
  id: McpConnectionId,
  parentEnv: Readonly<Record<string, string | undefined>>,
  token: string | null,
  launchEnvironment: Readonly<Record<string, string>> = {}
): Record<string, string> {
  return buildServerEnvironment(
    parentEnv,
    MCP_SERVER_DEFINITIONS[id].environment(token),
    launchEnvironment
  )
}
