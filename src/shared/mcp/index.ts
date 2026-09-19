/**
 * MCP（Model Context Protocol）の接続の「契約」側の語彙。
 *
 * ## Renderer が指せるのは接続の **行** だけ
 *
 * Terminal のシェル（shared/terminal/shell.ts）・Language Server（shared/lsp）と
 * 同じ線を引く。
 *
 * ```
 * 渡せる   … この閉じた集合の値1つ（'notion'）
 * 渡せない … 実行ファイル・引数・URL・token・ツール名
 * ```
 *
 * 何を起動し、どの秘密情報を渡すかは Main の表だけが持つ（main/mcp/）。
 * 将来ほかの MCP サーバーを足すときは、この集合と Main の表に1行ずつ足す。
 *
 * ## 秘密情報はここに現れない
 *
 * token は Main が環境変数から読み、子プロセスへ渡すだけで、
 * この層のどの型にも欄が無い ── Renderer へ届く値に混ざる余地を作らない。
 */

/** 接続の種類。増やすときはここと main/mcp/mcpServerCatalog.ts の両方を足す。 */
export type McpConnectionId = 'notion'

export const MCP_CONNECTION_IDS = ['notion'] as const satisfies readonly McpConnectionId[]

/** 境界の外から届いた値が、表の行を指しているか（Main の検証と Renderer の列挙で同じ集合を見る）。 */
export function isMcpConnectionId(value: unknown): value is McpConnectionId {
  return typeof value === 'string' && (MCP_CONNECTION_IDS as readonly string[]).includes(value)
}

/**
 * 設定が足りない理由。利用者の次の一手がそれぞれ違うので分けてある。
 *
 * | 値                     | 次の一手                                         |
 * | ---------------------- | ------------------------------------------------ |
 * | `token-missing`        | 環境変数に token を設定する                      |
 * | `token-invalid`        | 制御文字などが混ざっている。設定し直す           |
 * | `node-not-found`       | Node.js を入れる（PATH に通す）                  |
 * | `server-not-installed` | MCP サーバーを npm でグローバルに入れる          |
 */
export type McpConfigProblem =
  'token-missing' | 'token-invalid' | 'node-not-found' | 'server-not-installed'

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
  /** 接続テストの最中か。 */
  readonly testing: boolean
  /** 直近の接続テストの結末（このアプリを起動してから1度も試していなければ null）。 */
  readonly lastTest: McpConnectionTestResult | null
}

/* ------------------------------------------------------------------ 操作（tools/call） */

/**
 * 操作の種類。`write` は実行の前に利用者の確認を挟む（Main が出す。Renderer からは飛ばせない）。
 */
export type McpOperationKind = 'read' | 'write'

/**
 * 操作の結果として Renderer へ渡す値（JSON で表せるものだけ）。
 *
 * MCP サーバーが返した生の結果は渡さない ── 操作ごとに Main が必要な形へ
 * 読み替えてから渡す（main/mcp/mcpOperations.ts）。
 */
export type McpJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly McpJsonValue[]
  | { readonly [key: string]: McpJsonValue }

/** 操作が失敗した理由（接続の失敗に、ツールの呼び出しに固有のものを足したもの）。 */
export type McpOperationFailure =
  | McpConnectionFailure
  /** サーバーがその操作に使うツールを公開していなかった（サーバーの版の違いなど）。 */
  | 'tool-unavailable'
  /** ツールが失敗を返した（相手の API が断った・対象が無い・権限が無い）。 */
  | 'tool-error'
  /** ツールの結果が読めなかった。 */
  | 'invalid-result'
  /**
   * 書き込みの操作で、要求を送った後に時間切れ・サーバーの終了・読めない応答が起きた。
   * 相手には届いて反映されたかもしれない ── 押し直す前に、相手の側で確かめてもらう
   * （そのまま押し直すと二重に書き込みうる）。
   */
  | 'outcome-unknown'

/**
 * ツールが失敗を返したときの、画面に出してよい手がかり。
 *
 * 相手の API の番号と分類だけで、本文（エラーの文）は渡さない。
 */
export interface McpToolErrorSummary {
  readonly status: number | null
  readonly code: string | null
}

/** 操作1回の結末。 */
export type McpOperationResult =
  | { readonly outcome: 'completed'; readonly operation: string; readonly data: McpJsonValue }
  /** 書き込みの確認で、利用者が実行しなかった。何も送っていない。 */
  | { readonly outcome: 'declined'; readonly operation: string }
  | {
      readonly outcome: 'not-configured'
      readonly operation: string
      readonly problems: readonly McpConfigProblem[]
    }
  | {
      readonly outcome: 'failed'
      readonly operation: string
      readonly failure: McpOperationFailure
      readonly toolError: McpToolErrorSummary | null
    }
