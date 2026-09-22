/**
 * MCP（Model Context Protocol）の接続の「契約」側の語彙。
 *
 * ## MCP サーバーは、利用者が MCP Server Manager で登録したものだけ
 *
 * アプリに組み込みの MCP サーバーは無い。どのサーバーも Settings の
 * 「+ New MCP Server」で登録し、同じ道（登録簿 → 起動 → 接続）を通る
 * （shared/mcp/customServers.ts・main/mcp/）。特定のサービスだけを
 * 特別扱いする経路は持たない。
 *
 * ## Renderer が指せるのは登録簿の **行** だけ
 *
 * Terminal のシェル（shared/terminal/shell.ts）・Language Server（shared/lsp）と
 * 同じ線を引く。状態・接続テストの口に載るのは接続の id だけで、起動するものは
 * そのとき Main が登録簿から読んだ値になる。
 *
 * Command・引数・環境変数が Renderer から渡るのは**登録の口
 * （`mcp:save-custom-server`）の1本だけ**で、Main が形を確かめて登録簿へ書く。
 *
 * ## 秘密情報はここに現れない
 *
 * 秘密の環境変数の値は、登録の口で Renderer → Main の一方通行で渡るだけで、
 * この層のどの型にも**値の欄が無い** ── Main から Renderer へ値が戻る経路は無い。
 *
 * ## ツールを呼ぶ口は Renderer に無い
 *
 * Renderer から MCP のツールを呼ぶ IPC は無い。ツールの呼び出しは Main の中だけの
 * 手続き（main/mcp/mcpConnections.ts の `callOperation`）で、FN Agent からは
 * Security Core を通して使う前提にしてある（DESIGN.md §6）。
 */

/**
 * 利用者が Settings から足した MCP サーバーの id。
 *
 * 値は Main が作る（`custom-` ＋ UUID）。Renderer が指せるのは、Main の
 * 登録簿（main/mcp/mcpCustomServerStore.ts）に**在る** id だけで、形が
 * 合っていても登録簿に無ければ Main が断る。
 */
export type McpCustomServerId = `custom-${string}`

/** 接続1つを指す id（MCP Server Manager に登録されたサーバー）。 */
export type McpConnectionId = McpCustomServerId

const CUSTOM_SERVER_ID_PATTERN =
  /^custom-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** 利用者が足したサーバーの id の**形**か（在るかどうかは Main の登録簿が決める）。 */
export function isMcpCustomServerId(value: unknown): value is McpCustomServerId {
  return typeof value === 'string' && CUSTOM_SERVER_ID_PATTERN.test(value)
}

/**
 * 境界の外から届いた値が、接続の id の形をしているか。
 *
 * 形が合っても、登録簿に在るかを Main がもう一度確かめる（main/ipc/handlers/mcp.ts）。
 */
export function isMcpConnectionId(value: unknown): value is McpConnectionId {
  return isMcpCustomServerId(value)
}

/**
 * 設定が足りない理由。利用者の次の一手がそれぞれ違うので分けてある。
 *
 * | 値                      | 次の一手                                                  |
 * | ----------------------- | --------------------------------------------------------- |
 * | `disabled`              | Settings で MCP（またはそのサーバー）を有効にする         |
 * | `node-not-found`        | Node.js を入れる（PATH に通す）                           |
 * | `server-not-installed`  | MCP サーバーを npm でグローバルに入れる                   |
 * | `command-not-found`     | 登録したサーバーの Command が見つからない                 |
 * | `arguments-unsupported` | `.cmd` / `.bat` へは渡せない文字が引数にある              |
 * | `secret-missing`        | 秘密の環境変数の値が読めない。入れ直す                    |
 *
 * `disabled` だけは「設定が足りない」ではなく「使わないと決めてある」に
 * あたるが、**呼ぶ側から見た扱いは同じ**（今は動かせない・理由がこれ）なので
 * 同じ集合に置いた。別の outcome を作ると、状態・テスト・操作の3箇所が
 * 「動かない理由」を2通りずつ持つことになる。
 */
export type McpConfigProblem =
  | 'disabled'
  | 'node-not-found'
  | 'server-not-installed'
  | 'command-not-found'
  | 'arguments-unsupported'
  | 'secret-missing'

/**
 * 設定は揃っていたのに繋がらなかった理由。
 *
 * 生のエラー文・stderr は画面へ渡さない（Main のログに残る）。
 */
export type McpConnectionFailure =
  /** 実行ファイルを起動できなかった（権限・壊れた実行ファイル）。 */
  | 'spawn-failed'
  /** 決めた時間内に応答が無かった。 */
  | 'timeout'
  /** 話している途中でサーバーのプロセスが終わった。 */
  | 'server-exited'
  /** 応答が読めなかった・形が違った。 */
  | 'protocol-error'
  /** こちらが話せる版を、サーバーが1つも話せなかった。 */
  | 'unsupported-protocol'
  /** サーバーが要求を失敗として返した。 */
  | 'rejected'

/** サーバーが公開しているツール1つ分（名前と説明だけ。入力の形は渡さない）。 */
export interface McpToolSummary {
  readonly name: string
  readonly description: string | null
}

/**
 * 接続テストの結末。
 *
 * `testedAt` は Main が付ける ISO 8601 の時刻。
 */
export type McpConnectionTestResult =
  | {
      readonly outcome: 'connected'
      readonly testedAt: string
      /** サーバーが名乗った名前と版（名乗らなければ null）。 */
      readonly server: { readonly name: string | null; readonly version: string | null }
      /** 取り決めた MCP の版。 */
      readonly protocolVersion: string
      readonly tools: readonly McpToolSummary[]
    }
  | {
      readonly outcome: 'not-configured'
      readonly testedAt: string
      readonly problems: readonly McpConfigProblem[]
    }
  | {
      readonly outcome: 'failed'
      readonly testedAt: string
      readonly failure: McpConnectionFailure
    }

/** 接続1つの今の状態。 */
export interface McpConnectionStatus {
  readonly connectionId: McpConnectionId
  /** 今この時点で設定が揃っているか（`problems` が空か）。 */
  readonly configured: boolean
  readonly problems: readonly McpConfigProblem[]
  /** 使える状態か（全体の元栓とそのサーバーの栓の両方が入っているか）。 */
  readonly enabled: boolean
  /** 接続テストの最中か。 */
  readonly testing: boolean
  /** 直近の接続テストの結末（このアプリを起動してから1度も試していなければ null）。 */
  readonly lastTest: McpConnectionTestResult | null
}
