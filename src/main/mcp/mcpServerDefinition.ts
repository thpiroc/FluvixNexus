import type { McpConfigProblem } from '@shared/mcp'
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

/**
 * MCP サーバー1つを「どう起動し、何を渡すか」の形（MCP 共通。Electron / fs /
 * child_process 非依存・テスト対象）。
 *
 * ## 定義は登録簿の行から、そのつど作る
 *
 * アプリに組み込みの MCP サーバーは無い。定義はどれも、MCP Server Manager の
 * 登録簿（mcpCustomServerStore.ts）の行から、接続のたびに作る
 * （mcpCustomServerDefinition.ts）。起動・環境変数の許可リスト・接続テスト・
 * ログの伏せ字は、すべてこの形を通して mcpConnections.ts が扱う。
 *
 * Renderer が指せるのは行（`McpConnectionId`）だけで、実行ファイル・引数・
 * 環境変数の値は Main がこの形に組み立ててから使う。
 */

/** 行1つ分の定義。 */
export interface McpServerDefinition {
  /** 起動のしかた（mcpServerLaunch.ts）。 */
  readonly launch: McpServerLaunch
  /** サーバーが読む設定の変数と、そこへ渡す値（mcpServerEnvironment.ts）。 */
  readonly environment: () => McpServerEnvironmentProfile
  /**
   * 呼べる操作（mcpOperations.ts）。ここに無い操作名は断る
   * ── サーバーが公開しているツールでも、表に載せなければ呼べない。
   */
  readonly operations: Readonly<Record<string, AnyMcpOperationDefinition>>
  /**
   * 起動する前から分かっている、設定の足りないところ（秘密の値が読めない、など）。
   */
  readonly configProblems?: readonly McpConfigProblem[]
  /** ログへ出す前に伏せる値（秘密の環境変数の値）。 */
  readonly redactions?: readonly string[]
}

export type { McpServerCommand, McpServerCommandResolution } from './mcpServerLaunch'

export function resolveMcpServerCommand(
  definition: McpServerDefinition,
  context: McpLaunchContext
): McpServerCommandResolution {
  return resolveMcpServerLaunch(definition.launch, context)
}

/**
 * MCP サーバーへ渡す環境変数。秘密の値は引数ではなく環境変数で渡す
 * （引数は同じ PC のほかのプロセスから見える。タスクマネージャーのコマンドライン列など）。
 */
export function createMcpServerEnvironment(
  definition: McpServerDefinition,
  parentEnv: Readonly<Record<string, string | undefined>>,
  launchEnvironment: Readonly<Record<string, string>> = {}
): Record<string, string> {
  return buildServerEnvironment(parentEnv, definition.environment(), launchEnvironment)
}
