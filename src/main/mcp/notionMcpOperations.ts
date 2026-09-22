import type { LanguageId } from '@shared/language'
import type { McpJsonValue, McpToolErrorSummary } from '@shared/mcp'
import type {
  NotionBlockSummary,
  NotionMcpOperation,
  NotionMcpOperationArguments,
  NotionMcpOperationData,
  NotionPageDetail,
  NotionPageSummary
} from '@shared/mcp/notion'
import type { McpToolCallResult } from './mcpClient'
import { isRecord } from './mcpMessage'
import {
  defineMcpOperation,
  readArgumentObject,
  readJsonTextContent,
  readStringArgument,
  type AnyMcpOperationDefinition,
  type McpArgumentsParse
} from './mcpOperations'

/**
 * Notion MCP の操作表（Notion 固有。Electron 非依存・テスト対象）。
 *
 * | 操作               | 種類   | ツール（@notionhq/notion-mcp-server 2.5.1） |
 * | ------------------ | ------ | ------------------------------------------- |
 * | `search-pages`     | read   | `API-post-search`（ページだけ・10件まで）   |
 * | `get-page`         | read   | `API-retrieve-a-page`                       |
 * | `get-page-content` | read   | `API-get-block-children`（100件まで）       |
 * | `append-paragraph` | write  | `API-patch-block-children`（末尾に段落1つ） |
 *
 * 削除・移動・上書き（`API-delete-a-block` / `API-move-page` / `API-update-*` /
 * `API-patch-page` など）は**表に載せていない**ので、Renderer からは呼べない。
 *
 * ## ページ ID は UUID の形だけを受け付ける
 *
 * サーバーは ID を API の URL のパスへそのまま埋め込む（`/v1/pages/{page_id}`）。
 * 形を確かめずに通すと、`../users` のような値で別の API を叩けてしまう。
 * 32桁の16進（ハイフンの有無は問わない）だけを受け付け、ハイフン付きの形へ揃えて渡す。
 *
 * ## 追記は末尾に足すだけ
 *
 * `append-paragraph` は `after` を渡さない ── Notion は子ブロックの末尾に足す。
 * 既存のブロックを消す・書き換える引数は組み立てない。
 */

const SEARCH_PAGE_SIZE = 10
const CONTENT_PAGE_SIZE = 100

/** 段落1つに入れる文字数の上限（Notion の rich text 1要素の上限）。 */
const PARAGRAPH_MAX_LENGTH = 2000

const PAGE_ID_ARGUMENT = { key: 'pageId' } as const

/** 32桁の16進（ハイフンの有無は問わない）をハイフン付きの UUID へ揃える。形が違えば null。 */
export function normalizeNotionId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim().toLowerCase()
  const match = /^([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})$/.exec(
    trimmed
  )

  return match === null ? null : match.slice(1).join('-')
}

function readPageId(args: Readonly<Record<string, unknown>>): McpArgumentsParse<string> {
  const id = normalizeNotionId(args[PAGE_ID_ARGUMENT.key])

  return id === null
    ? { ok: false, reason: '"pageId" must be a Notion page ID (32 hex digits).' }
    : { ok: true, value: id }
}

function parsePageIdOnly(raw: unknown): McpArgumentsParse<{ readonly pageId: string }> {
  const object = readArgumentObject(raw, ['pageId'])

  if (!object.ok) {
    return object
  }

  const pageId = readPageId(object.value)

  return pageId.ok ? { ok: true, value: { pageId: pageId.value } } : pageId
}

/* ------------------------------------------------------------------ 結果を読む */

/** Notion API の応答（JSON）を読む。object でなければ null。 */
function readNotionBody(result: McpToolCallResult): Readonly<Record<string, unknown>> | null {
  const body = readJsonTextContent(result)

  return isRecord(body) ? body : null
}

/** ページのタイトル（`type: 'title'` のプロパティの平文）。無ければ null。 */
function titleOf(page: Readonly<Record<string, unknown>>): string | null {
  const properties = page['properties']

  if (!isRecord(properties)) {
    return null
  }

  for (const property of Object.values(properties)) {
    if (isRecord(property) && property['type'] === 'title') {
      return plainText(property['title'])
    }
  }

  return null
}

/** rich text の配列を平文にする。配列でなければ null。 */
function plainText(richText: unknown): string | null {
  if (!Array.isArray(richText)) {
    return null
  }

  return richText
    .map((part) =>
      isRecord(part) && typeof part['plain_text'] === 'string' ? part['plain_text'] : ''
    )
    .join('')
}

function pageSummary(page: Readonly<Record<string, unknown>>): NotionPageSummary | null {
  const id = normalizeNotionId(page['id'])

  if (id === null) {
    return null
  }

  return {
    id,
    title: titleOf(page),
    // 2025 年の API で `archived` から `in_trash` に変わった。どちらでも読む。
    inTrash: page['in_trash'] === true || page['archived'] === true
  }
}

function blockSummary(block: Readonly<Record<string, unknown>>): NotionBlockSummary | null {
  const id = normalizeNotionId(block['id'])
  const type = block['type']

  if (id === null || typeof type !== 'string') {
    return null
  }

  const body = block[type]
  let text: string | null = null

  if (isRecord(body)) {
    // 段落・見出し・箇条書きなどは `rich_text`、子ページは `title` を持つ。
    text =
      plainText(body['rich_text']) ?? (typeof body['title'] === 'string' ? body['title'] : null)
  }

  return { id, type, text }
}

/**
 * Notion のエラーの応答から番号と分類だけを読む（本文の `message` は読まない）。
 * エラーでなければ null。
 *
 * Notion MCP サーバー（2.5.1）は、API のエラー（401 / 403 / 404 など）を
 * `isError` の付かない**普通の結果**として返す（架空の token で確かめた）。形は2通り。
 *
 *   `{ object: 'error', status: 404, code: 'object_not_found', message }` … API の応答そのまま
 *   `{ status: 401, code: 'unauthorized', ... }`                         … サーバーが包んだもの
 *
 * どちらも「400 以上の番号」か「`object: 'error'`」で見分ける。成功した応答
 * （`object: 'page'` / `'list'` など）はどちらにも当たらない。
 */
function readNotionError(result: McpToolCallResult): McpToolErrorSummary | null {
  const body = readNotionBody(result)

  if (body === null) {
    return null
  }

  const status = typeof body['status'] === 'number' ? body['status'] : null

  if (body['object'] !== 'error' && (status === null || status < 400)) {
    return null
  }

  return { status, code: typeof body['code'] === 'string' ? body['code'] : null }
}

/** 型付きの結果を、IPC で渡す JSON の値として返す（shared の型と形を揃えるため）。 */
function asJson<T>(value: T): McpJsonValue {
  return value as unknown as McpJsonValue
}

/* ------------------------------------------------------------------ 確認の文 */

const APPEND_TEXT: Record<
  LanguageId,
  { readonly title: string; readonly page: string; readonly text: string }
> = {
  ja: {
    title: 'Notion のページに段落を追記します',
    page: 'ページ',
    text: '追記する内容（ページの末尾に1つ足します。既存の内容は変えません）'
  },
  en: {
    title: 'Append a paragraph to a Notion page',
    page: 'Page',
    text: 'Content to append (added at the end of the page; existing content is not changed)'
  }
}

/* ------------------------------------------------------------------ 表 */

export const NOTION_MCP_OPERATIONS_TABLE: Readonly<
  Record<NotionMcpOperation, AnyMcpOperationDefinition>
> = {
  'search-pages': defineMcpOperation<NotionMcpOperationArguments['search-pages']>({
    kind: 'read',
    tool: 'API-post-search',
    parseArguments: (raw) => {
      const object = readArgumentObject(raw, ['query'])

      if (!object.ok) {
        return object
      }

      const query = readStringArgument(object.value, 'query', {
        minLength: 1,
        maxLength: 200,
        multiline: false
      })

      return query.ok ? { ok: true, value: { query: query.value } } : query
    },
    toolArguments: (args) => ({
      query: args.query,
      filter: { property: 'object', value: 'page' },
      page_size: SEARCH_PAGE_SIZE
    }),
    readResult: (result) => {
      const body = readNotionBody(result)

      if (body === null || !Array.isArray(body['results'])) {
        return null
      }

      const pages = body['results']
        .filter(isRecord)
        .filter((item) => item['object'] === 'page')
        .map(pageSummary)
        .filter((page): page is NotionPageSummary => page !== null)

      return asJson<NotionMcpOperationData['search-pages']>({ pages })
    },
    readToolError: readNotionError
  }),

  'get-page': defineMcpOperation<NotionMcpOperationArguments['get-page']>({
    kind: 'read',
    tool: 'API-retrieve-a-page',
    parseArguments: parsePageIdOnly,
    toolArguments: (args) => ({ page_id: args.pageId }),
    readResult: (result) => {
      const body = readNotionBody(result)
      const summary = body === null || body['object'] !== 'page' ? null : pageSummary(body)

      if (body === null || summary === null) {
        return null
      }

      const parent = body['parent']
      const detail: NotionPageDetail = {
        ...summary,
        parentType: isRecord(parent) && typeof parent['type'] === 'string' ? parent['type'] : null
      }

      return asJson<NotionMcpOperationData['get-page']>(detail)
    },
    readToolError: readNotionError
  }),

  'get-page-content': defineMcpOperation<NotionMcpOperationArguments['get-page-content']>({
    kind: 'read',
    tool: 'API-get-block-children',
    parseArguments: parsePageIdOnly,
    toolArguments: (args) => ({ block_id: args.pageId, page_size: CONTENT_PAGE_SIZE }),
    readResult: (result, args) => {
      const body = readNotionBody(result)

      if (body === null || !Array.isArray(body['results'])) {
        return null
      }

      const blocks = body['results']
        .filter(isRecord)
        .map(blockSummary)
        .filter((block): block is NotionBlockSummary => block !== null)

      return asJson<NotionMcpOperationData['get-page-content']>({
        pageId: args.pageId,
        blocks,
        hasMore: body['has_more'] === true
      })
    },
    readToolError: readNotionError
  }),

  'append-paragraph': defineMcpOperation<NotionMcpOperationArguments['append-paragraph']>({
    kind: 'write',
    tool: 'API-patch-block-children',
    parseArguments: (raw) => {
      const object = readArgumentObject(raw, ['pageId', 'text'])

      if (!object.ok) {
        return object
      }

      const pageId = readPageId(object.value)

      if (!pageId.ok) {
        return pageId
      }

      const text = readStringArgument(object.value, 'text', {
        minLength: 1,
        maxLength: PARAGRAPH_MAX_LENGTH,
        multiline: true
      })

      return text.ok ? { ok: true, value: { pageId: pageId.value, text: text.value } } : text
    },
    // `after` を渡さない ── 末尾に足す。既存のブロックには触れない。
    toolArguments: (args) => ({
      block_id: args.pageId,
      children: [
        {
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: args.text } }] }
        }
      ]
    }),
    readResult: (result, args) => {
      const body = readNotionBody(result)

      if (body === null || !Array.isArray(body['results'])) {
        return null
      }

      const appendedBlockIds = body['results']
        .filter(isRecord)
        .map((block) => normalizeNotionId(block['id']))
        .filter((id): id is string => id !== null)

      return asJson<NotionMcpOperationData['append-paragraph']>({
        pageId: args.pageId,
        appendedBlockIds
      })
    },
    readToolError: readNotionError,
    describe: (args, language) => {
      const text = APPEND_TEXT[language]

      return {
        title: text.title,
        detail: `${text.page}: ${args.pageId}\n\n${text.text}:\n${args.text}`
      }
    }
  })
}
