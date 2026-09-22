import type { McpConfigProblem } from '@shared/mcp'
import type { McpStoredCustomServer } from '@shared/mcp/customServers'
import type { McpServerDefinition } from './mcpServerCatalog'

/**
 * 利用者が足したサーバーの行から、表の行（`McpServerDefinition`）を作る
 * （§21.10。Electron / fs 非依存・テスト対象）。
 *
 * 組み込みの行（notionMcpServer.ts）と**同じ形**にそろえることで、
 * 起動・環境変数の許可リスト・接続テスト・ログの伏せ字は、組み込みと
 * 同じ道（mcpConnections.ts）を通る。ここが決めるのは次の4つだけ。
 *
 * | 欄             | 中身                                                                |
 * | -------------- | ------------------------------------------------------------------- |
 * | 起動のしかた   | `user-command`（Command と引数を配列のまま）                         |
 * | 環境変数       | 利用者が決めた変数だけを「サーバーの設定」として渡す                  |
 * | 操作           | **無い**。Renderer からツールを呼ぶ口は、今は組み込みの行だけ         |
 * | 足りないもの   | 秘密の値が読めない（保存されていない・この PC で復号できない）         |
 *
 * ## 環境変数は「予約して、表の値だけを入れる」
 *
 * 利用者が決めた名前は `reservedVariables` に入る ── 親（このアプリ）の環境に
 * 同じ名前があっても引き継がず、利用者が決めた値だけが入る。それ以外は、
 * 組み込みの行と同じ共通の許可リスト（mcpServerEnvironment.ts）だけが通る。
 * `GITHUB_TOKEN` のような親の秘密情報は、利用者がその名前で値を入れない限り
 * どのサーバーにも渡らない。
 *
 * ## 秘密の値は、呼ばれるたびに読む
 *
 * 作るのは接続（状態・テスト）のたびで、そのつど保存先から読む。覚えると
 * 「入れ直したのに古い値で繋がる」が生まれる（mcpSecretStore.ts と同じ理由）。
 */

/** 秘密の環境変数の値を読む（無い・読めないなら null）。 */
export type McpCustomSecretReader = (name: string) => string | null

export function createMcpCustomServerDefinition(
  server: McpStoredCustomServer,
  readSecret: McpCustomSecretReader
): McpServerDefinition {
  const provided: Record<string, string> = {}
  const redactions: string[] = []
  let secretMissing = false

  for (const variable of server.env) {
    if (!variable.secret) {
      provided[variable.name] = variable.value
      continue
    }

    const value = readSecret(variable.name)

    if (value === null) {
      secretMissing = true
      continue
    }

    provided[variable.name] = value
    redactions.push(value)
  }

  const configProblems: McpConfigProblem[] = secretMissing ? ['secret-missing'] : []
  const reservedVariables = server.env.map((variable) => variable.name)

  return {
    launch: {
      kind: 'user-command',
      name: server.name,
      command: server.transport.command,
      args: server.transport.args
    },
    secret: null,
    environment: () => ({ reservedVariables, providedVariables: provided }),
    operations: {},
    configProblems,
    redactions
  }
}
