import type {
  McpCustomServerDraft,
  McpCustomServerList,
  McpCustomServerSaveOutcome
} from '../../mcp/customServers'
import type {
  McpConnectionId,
  McpCustomServerId,
  McpConnectionStatus,
  McpConnectionTestResult
} from '../../mcp'

/**
 * mcp ドメインの IPC 契約（MCP Server Manager）。
 *
 * ## 要求に載るのは接続の id だけ
 *
 * 実行ファイル・引数・秘密の値・ツール名の欄は無い ── 何を起動し、何を渡すかは
 * Main が登録簿から決める（shared/mcp の冒頭）。例外は登録の口
 * （`mcp:save-custom-server`）で、下のその型に理由を書いてある。
 *
 * ## ツールを呼ぶ口は無い
 *
 * Renderer から MCP のツールを呼ぶ要求は定義しない。ツールの呼び出しは Main の中だけの
 * 手続きで、FN Agent からは Security Core を通す（DESIGN.md §6）。
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

/** 利用者が足したサーバー1つを指す要求。 */
export interface McpCustomServerRequest {
  readonly id: McpCustomServerId
}

/**
 * 利用者が足したサーバーを保存する要求。
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
 * 値が戻る経路は無い（Renderer → Main の一方通行）。
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
