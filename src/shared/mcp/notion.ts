/**
 * Notion MCP の操作の語彙（Notion 固有）。
 *
 * Renderer が `mcp:call-operation` で指せる操作名と、それぞれの引数・結果の形。
 * 実際にどのツールをどう呼ぶかは Main だけが持つ（main/mcp/notionMcpOperations.ts）。
 * ここに無い名前は Main が断る。
 */

export const NOTION_MCP_OPERATIONS = [
  'search-pages',
  'get-page',
  'get-page-content',
  'append-paragraph'
] as const

export type NotionMcpOperation = (typeof NOTION_MCP_OPERATIONS)[number]

/** 各操作の引数。 */
export interface NotionMcpOperationArguments {
  /** タイトルでページを探す（読み取り）。 */
  readonly 'search-pages': { readonly query: string }
  /** ページ1つの情報（読み取り）。 */
  readonly 'get-page': { readonly pageId: string }
  /** ページ直下のブロック（読み取り。先頭の100件まで）。 */
  readonly 'get-page-content': { readonly pageId: string }
  /** ページの末尾に段落を1つ足す（書き込み。既存の内容は変えない）。 */
  readonly 'append-paragraph': { readonly pageId: string; readonly text: string }
}

export interface NotionPageSummary {
  /** ハイフン付きの UUID。 */
  readonly id: string
  readonly title: string | null
  readonly inTrash: boolean
}

export interface NotionPageDetail extends NotionPageSummary {
  /** 親の種類（`workspace` / `page_id` / `database_id` など）。 */
  readonly parentType: string | null
}

export interface NotionBlockSummary {
  readonly id: string
  readonly type: string
  /** 文字を持つブロックなら、その平文。持たなければ null。 */
  readonly text: string | null
}

/** 各操作の結果（`McpOperationResult` の `data`）。 */
export interface NotionMcpOperationData {
  readonly 'search-pages': { readonly pages: readonly NotionPageSummary[] }
  readonly 'get-page': NotionPageDetail
  readonly 'get-page-content': {
    readonly pageId: string
    readonly blocks: readonly NotionBlockSummary[]
    /** 100件より多く、続きがある。 */
    readonly hasMore: boolean
  }
  readonly 'append-paragraph': {
    readonly pageId: string
    readonly appendedBlockIds: readonly string[]
  }
}
