import type {
  McpCustomServerDraft,
  McpCustomServerList,
  McpCustomServerSaveOutcome
} from '../../mcp/customServers'
import type {
  McpConnectionId,
  McpCustomServerId,
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
 * Main の表が決める（shared/mcp の冒頭）。例外は利用者が足したサーバーの
 * 保存の口（`mcp:save-custom-server`。§21.10）で、下のその型に理由を書いてある。
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

/** 利用者が足したサーバー1つを指す要求（§21.10）。 */
export interface McpCustomServerRequest {
  readonly id: McpCustomServerId
}

/**
 * 利用者が足したサーバーを保存する要求（§21.10）。
 *
 * ## Command と引数が Renderer から渡るのは、この1本だけ
 *
 * 状態・接続テストの口は今までどおり id しか受け取らず、起動するものは
 * そのとき Main が登録簿から読む。ここで届いた下書きは Main がもう一度
 * 形を確かめて（shared/mcp/customServers.ts の `validateMcpCustomServerDraft`）
 * から登録簿へ書く。**保存しても起動はしない** ── 接続テストは保存の後に、
 * 利用者が別に押す。
 *
 * 秘密の環境変数の値もこの口で Renderer → Main へ渡る。返る
 * `McpCustomServerSaveOutcome` には「保存されているか」だけが載り、
 * 値が戻る経路は無い（token と同じ一方通行。§21.9）。
 */
export interface McpSaveCustomServerRequest {
  /** 編集なら、そのサーバーの id。新しく足すなら null（id は Main が作る）。 */
  readonly id: McpCustomServerId | null
  readonly draft: McpCustomServerDraft
}

/** 利用者が足したサーバーの有効 / 無効を切り替える要求。 */
export interface McpSetCustomServerEnabledRequest {
  readonly id: McpCustomServerId
  readonly enabled: boolean
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
  /** 利用者が足したサーバーの一覧（秘密の値は含まない）。 */
  'mcp:list-custom-servers': {
    request: void
    response: McpCustomServerList
  }
  /** 利用者が足したサーバーを新しく足す・書き換える（起動はしない）。 */
  'mcp:save-custom-server': {
    request: McpSaveCustomServerRequest
    response: McpCustomServerSaveOutcome
  }
  /** 利用者が足したサーバーを消す（保存された秘密の値も一緒に消す）。応答は消した後の一覧。 */
  'mcp:delete-custom-server': {
    request: McpCustomServerRequest
    response: McpCustomServerList
  }
  /** 利用者が足したサーバーの有効 / 無効を切り替える。応答は切り替えた後の一覧。 */
  'mcp:set-custom-server-enabled': {
    request: McpSetCustomServerEnabledRequest
    response: McpCustomServerList
  }
}
