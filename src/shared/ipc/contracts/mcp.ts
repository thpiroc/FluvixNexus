import type {
  McpConnectionId,
  McpConnectionStatus,
  McpConnectionTestResult,
  McpOperationResult,
  McpSecretState,
  McpSecretWriteOutcome
} from '../../mcp'

/**
 * mcp ドメインの IPC 契約（Notion MCP 連携の土台）。
 *
 * ## 要求に載るのは接続の id だけ
 *
 * 実行ファイル・引数・token・ツール名の欄は無い ── 何を起動し、何を渡すかは
 * Main の表が決める（shared/mcp の冒頭）。
 *
 * ## 繋がらないのは IPC の失敗ではない
 *
 * 設定が無い・サーバーが落ちた・時間切れ、はどれも利用者の PC で普通に起こることで、
 * 応答の `outcome` として返す。IPC の失敗になるのは、要求そのものが壊れている
 * （知らない接続 id）ような Renderer 側の不具合だけ。
 */
export interface McpConnectionRequest {
  readonly connectionId: McpConnectionId
}

/**
 * 操作（tools/call）の要求。
 *
 * 載るのは「許可された接続 id」「その接続で許可された操作名」「その操作の引数」だけ。
 * ツール名・URL・token・コマンドの欄は無い。操作名と引数は Main が表
 * （main/mcp/ の各サーバーの操作表）で確かめ、合わなければ IPC の失敗
 * （INVALID_REQUEST）として断る。
 *
 * 書き込みの操作は、実行の前に Main が利用者に確認する。確認を飛ばす欄も無い。
 */
export interface McpOperationRequest {
  readonly connectionId: McpConnectionId
  readonly operation: string
  readonly arguments: unknown
}

/**
 * token を入れる要求（§21.9）。
 *
 * ## token が通るのは、この1本の、この向きだけ
 *
 * Renderer → Main の一方通行にほかならない。返る `McpSecretWriteOutcome` にも
 * `McpConnectionStatus` にも token の値の欄は無く、**Main から Renderer へ
 * token が戻る経路は存在しない**（shared/mcp の冒頭）。
 *
 * 入れ直すときは、画面が今の値を読んで直すのではなく、新しい値を丸ごと送る
 * ── 「読めないが入っている」ものを編集させない。
 */
export interface McpSetSecretRequest {
  readonly connectionId: McpConnectionId
  /** 入れる token。空文字は「消す」ではなく、形が通らないものとして断る。 */
  readonly token: string
}

export interface McpIpcContract {
  /** 設定が揃っているかと、直近の接続テストの結末（起動も通信もしない）。 */
  'mcp:get-status': {
    request: McpConnectionRequest
    response: McpConnectionStatus
  }
  /** サーバーを起動して接続し、ツールの一覧を取って切断する。 */
  'mcp:test-connection': {
    request: McpConnectionRequest
    response: McpConnectionTestResult
  }
  /** 操作を1つ実行する（起動 → 接続 → ツールを呼ぶ → 切断）。 */
  'mcp:call-operation': {
    request: McpOperationRequest
    response: McpOperationResult
  }
  /** token を安全な保存先へ入れる（既にあれば置き換える）。 */
  'mcp:set-secret': {
    request: McpSetSecretRequest
    response: McpSecretWriteOutcome
  }
  /** 保存された token を消す（環境変数の token には触れない）。 */
  'mcp:clear-secret': {
    request: McpConnectionRequest
    response: McpSecretState
  }
}
