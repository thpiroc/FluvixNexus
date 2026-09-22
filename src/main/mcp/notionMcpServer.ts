import type { McpServerDefinition } from './mcpServerCatalog'
import { NOTION_MCP_OPERATIONS_TABLE } from './notionMcpOperations'

/**
 * Notion MCP サーバーの行（Notion 固有。Electron / fs 非依存）。
 *
 * Notion について知っていることは、このファイルと操作表（notionMcpOperations.ts）、
 * Renderer 向けの語彙（shared/mcp/notion.ts）に置く。
 * 共通の側（mcpClient / mcpStdioTransport / mcpServerEnvironment / mcpServerLaunch /
 * mcpNpmServer / mcpOperations / mcpConnections）は Notion を知らない。
 *
 * | 項目               | 値                                                           |
 * | ------------------ | ------------------------------------------------------------ |
 * | パッケージ         | `@notionhq/notion-mcp-server` 2.5.1（アプリに同梱）          |
 * | 入口               | `bin/cli.mjs`（`--transport stdio`）。アプリ自身の Node で起動 |
 * | token（アプリ側）  | `FLUVIX_NOTION_MCP_TOKEN`                                    |
 * | token（サーバー側）| `NOTION_TOKEN`                                               |
 * | 読む設定の変数     | `NOTION_TOKEN` / `OPENAPI_MCP_HEADERS` / `BASE_URL` /        |
 * |                    | `AUTH_TOKEN` / `ENABLE_TOKEN_PASSTHROUGH`                    |
 *
 * ## 同梱する
 *
 * `bin/cli.mjs` は依存をまとめた1ファイルで、`scripts/notion-openapi.json`（API の定義）と
 * 合わせれば `node_modules` 無しで動く（2.5.1 で確かめた）。利用者に Node も
 * `npm install -g` も求めない。配布物への写し方は electron-builder.yml の `extraResources`、
 * ライセンス表記は tools/third-party-notices.mjs の `BUNDLED_PACKAGES`。
 * 版を上げるときは package.json の固定の版と、下の「読む変数」を一緒に見直す。
 *
 * ## token はフィードバックと共有しない
 *
 * フィードバックの Notion 保存（main/feedback/）は `FLUVIX_NOTION_TOKEN` を使う。
 * こちらはあえて別の名前にしてある。
 *
 *   - 求める権限が違う ── フィードバックは Database 1つへの書き込みだけで足りるが、
 *     MCP は利用者が共有したページ全体を読み書きしうる
 *   - 片方を設定した人が、もう片方まで動くと思い込まない
 *
 * ## サーバーが設定として読む変数（2.5.1 の `bin/cli.mjs` で確かめた）
 *
 * - `NOTION_TOKEN` … token。こちらが渡す
 * - `OPENAPI_MCP_HEADERS` … 要求のヘッダー。`NOTION_TOKEN` より**優先**される
 * - `BASE_URL` … **API の接続先の上書き**。ありふれた名前なので、別の用途で
 *   設定された値を引き継ぐと、token 付きの要求がその URL へ送られる
 *   （実接続の確認で `Invalid URL` として表に出た）
 * - `AUTH_TOKEN` / `ENABLE_TOKEN_PASSTHROUGH` … HTTP で待ち受けるときの設定。
 *   stdio では使われないが、サーバーが読む名前なので同じく引き継がない
 *
 * どれも共通の許可リスト（mcpServerEnvironment.ts）には無いので、そもそも親からは
 * 渡らない。ここに挙げておくのは、許可リストが将来広がっても親の値が混ざらないため。
 */

export const NOTION_MCP_TOKEN_ENV = 'FLUVIX_NOTION_MCP_TOKEN'

const NOTION_SERVER_TOKEN_VARIABLE = 'NOTION_TOKEN'

export const NOTION_MCP_SERVER: McpServerDefinition = {
  launch: {
    kind: 'bundled-node-script',
    name: 'Notion MCP',
    packageName: '@notionhq/notion-mcp-server',
    bundleName: 'notion-mcp-server',
    entry: ['bin', 'cli.mjs'],
    /*
      標準入出力で話させる。既定も stdio だが、HTTP で待ち受ける形もあり、
      そちらで立つと黙り込む ── 引数は表の側が持つので書いておく。
    */
    args: ['--transport', 'stdio']
  },
  secret: { variable: NOTION_MCP_TOKEN_ENV },
  environment: (token) => ({
    reservedVariables: [
      NOTION_SERVER_TOKEN_VARIABLE,
      'OPENAPI_MCP_HEADERS',
      'BASE_URL',
      'AUTH_TOKEN',
      'ENABLE_TOKEN_PASSTHROUGH'
    ],
    // token は引数ではなく環境変数で渡す（引数は同じ PC のほかのプロセスから見える）。
    providedVariables:
      token === null ? {} : ({ [NOTION_SERVER_TOKEN_VARIABLE]: token } as Record<string, string>)
  }),
  // 呼べる操作（読み取り3つと、末尾への追記1つ）。notionMcpOperations.ts
  operations: NOTION_MCP_OPERATIONS_TABLE
}
