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
 * ## 利用者が足したサーバー（§21.10）
 *
 * 「+ New MCP Server」で足したサーバーだけは、Command・引数・環境変数を
 * 利用者が決める。それらが Renderer から渡るのは**登録の口
 * （`mcp:save-custom-server`）の1本だけ**で、Main が形を確かめて登録簿へ
 * 書く。接続テスト・状態の口は、今までどおり id だけを受け取る ──
 * 起動するものを決めるのは、そのとき Main が登録簿から読んだ値になる
 * （shared/mcp/customServers.ts）。
 *
 * ## 秘密情報はここに現れない
 *
 * token は Main が読み、子プロセスへ渡すだけで、この層のどの型にも
 * **値の欄が無い** ── Renderer へ届く値に混ざる余地を作らない。
 *
 * §21.9 で Settings から token を入れられるようにしたが、増えたのは
 * 「どこから来ているか（`McpSecretSourceId`）」と「保存できる PC か」だけで、
 * **Main から Renderer へ token が流れる向きは今も無い**。
 * 入れるときだけ Renderer → Main の一方通行で渡る。
 */

/**
 * アプリに組み込んだ接続の種類。増やすときはここと main/mcp/mcpServerCatalog.ts の両方を足す。
 */
export type McpBuiltinConnectionId = 'notion'

export const MCP_BUILTIN_CONNECTION_IDS = [
  'notion'
] as const satisfies readonly McpBuiltinConnectionId[]

/**
 * 利用者が Settings から足した MCP サーバー（§21.10）の id。
 *
 * 値は Main が作る（`custom-` ＋ UUID）。Renderer が指せるのは、Main の
 * 登録簿（main/mcp/mcpCustomServerStore.ts）に**在る** id だけで、形が
 * 合っていても登録簿に無ければ Main が断る。
 */
export type McpCustomServerId = `custom-${string}`

/** 接続1つを指す id（組み込みか、利用者が足したものか）。 */
export type McpConnectionId = McpBuiltinConnectionId | McpCustomServerId

/** 境界の外から届いた値が、組み込みの行を指しているか。 */
export function isMcpBuiltinConnectionId(value: unknown): value is McpBuiltinConnectionId {
  return (
    typeof value === 'string' && (MCP_BUILTIN_CONNECTION_IDS as readonly string[]).includes(value)
  )
}

const CUSTOM_SERVER_ID_PATTERN =
  /^custom-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** 利用者が足したサーバーの id の**形**か（在るかどうかは Main の登録簿が決める）。 */
export function isMcpCustomServerId(value: unknown): value is McpCustomServerId {
  return typeof value === 'string' && CUSTOM_SERVER_ID_PATTERN.test(value)
}

/**
 * 境界の外から届いた値が、接続の id の形をしているか。
 *
 * 組み込みの行はこれで決まる。利用者が足したものは、形が合っても
 * 登録簿に在るかを Main がもう一度確かめる（main/ipc/handlers/mcp.ts）。
 */
export function isMcpConnectionId(value: unknown): value is McpConnectionId {
  return isMcpBuiltinConnectionId(value) || isMcpCustomServerId(value)
}

/**
 * 設定が足りない理由。利用者の次の一手がそれぞれ違うので分けてある。
 *
 * | 値                      | 次の一手                                                  |
 * | ----------------------- | --------------------------------------------------------- |
 * | `disabled`              | Settings で MCP（またはその接続）を有効にする             |
 * | `token-missing`         | Settings で token を入れる（または環境変数）              |
 * | `token-invalid`         | 制御文字などが混ざっている。入れ直す                      |
 * | `node-not-found`        | Node.js を入れる（PATH に通す）                           |
 * | `server-not-installed`  | MCP サーバーを npm でグローバルに入れる                   |
 * | `command-not-found`     | 利用者が足したサーバーの Command が見つからない（§21.10） |
 * | `arguments-unsupported` | `.cmd` / `.bat` へは渡せない文字が引数にある（§21.10）    |
 * | `secret-missing`        | 秘密の環境変数の値が読めない。入れ直す（§21.10）          |
 *
 * `disabled` だけは「設定が足りない」ではなく「使わないと決めてある」に
 * あたるが、**呼ぶ側から見た扱いは同じ**（今は動かせない・理由がこれ）なので
 * 同じ集合に置いた。別の outcome を作ると、状態・テスト・操作の3箇所が
 * 「動かない理由」を2通りずつ持つことになる。
 */
export type McpConfigProblem =
  | 'disabled'
  | 'token-missing'
  | 'token-invalid'
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

/**
 * token がどこから来ているか（§21.9）。**値そのものは決して付かない。**
 *
 * | 値            | 意味                                                     |
 * | ------------- | -------------------------------------------------------- |
 * | `stored`      | この PC に暗号化して保存されている（Settings から入れた） |
 * | `environment` | 環境変数 `FLUVIX_NOTION_MCP_TOKEN` から                   |
 * | `none`        | どちらにも無い                                            |
 *
 * 出どころを画面に出すのは、**「消したのにまだ繋がる」を説明できるようにする**
 * ため ── 保存した token を消しても環境変数が残っていれば繋がり続ける。
 * どちらが効いているかが出ていれば、それは不具合ではなく設定として読める。
 */
export type McpSecretSourceId = 'stored' | 'environment' | 'none'

/** token の在り処（値は含まない）。 */
export interface McpSecretState {
  readonly source: McpSecretSourceId
  /** この PC で token を保存できるか（OS の資格情報が使えるか）。 */
  readonly canStore: boolean
}

/** 接続1つの今の状態。 */
export interface McpConnectionStatus {
  readonly connectionId: McpConnectionId
  /** 今この時点で設定が揃っているか（`problems` が空か）。 */
  readonly configured: boolean
  readonly problems: readonly McpConfigProblem[]
  /** Settings で有効にしてあるか（全体の元栓とこの接続の栓の両方が入っているか）。 */
  readonly enabled: boolean
  /** token の在り処。値は含まない。 */
  readonly secret: McpSecretState
  /** 接続テストの最中か。 */
  readonly testing: boolean
  /** 直近の接続テストの結末（このアプリを起動してから1度も試していなければ null）。 */
  readonly lastTest: McpConnectionTestResult | null
}

/** token を入れようとした結果（`ok` でなければ理由）。 */
export type McpSecretWriteOutcome =
  | { readonly ok: true; readonly state: McpSecretState }
  | {
      readonly ok: false
      readonly failure: 'encryption-unavailable' | 'token-invalid' | 'write-failed'
      readonly state: McpSecretState
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
