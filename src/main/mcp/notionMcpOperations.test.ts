import { describe, expect, it } from 'vitest'
import { NOTION_MCP_OPERATIONS } from '@shared/mcp/notion'
import type { McpToolCallResult } from './mcpClient'
import { NOTION_MCP_OPERATIONS_TABLE, normalizeNotionId } from './notionMcpOperations'

/**
 * Notion MCP の操作表（notionMcpOperations.ts）。
 *
 * 確かめたいのは、Renderer から届いた値がそのままツールへ流れないこと
 * ── 引数は形を確かめてから組み立て直し、呼べるツールは表の4つだけ。
 */

const PAGE_ID = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e'
const PAGE_ID_COMPACT = '0f1e2d3c4b5a49688778695a4b3c2d1e'

function textResult(body: unknown, isError = false): McpToolCallResult {
  return { isError, texts: [JSON.stringify(body)], otherContent: 0, structuredContent: null }
}

function parse(operation: keyof typeof NOTION_MCP_OPERATIONS_TABLE, raw: unknown): unknown {
  return NOTION_MCP_OPERATIONS_TABLE[operation].parseArguments(raw)
}

describe('表', () => {
  it('shared の操作名とちょうど同じものが並ぶ', () => {
    expect(Object.keys(NOTION_MCP_OPERATIONS_TABLE).sort()).toEqual(
      [...NOTION_MCP_OPERATIONS].sort()
    )
  })

  it('書き込みは append-paragraph だけで、削除・移動・上書きのツールは載っていない', () => {
    const entries = Object.entries(NOTION_MCP_OPERATIONS_TABLE)

    expect(entries.filter(([, op]) => op.kind === 'write').map(([name]) => name)).toEqual([
      'append-paragraph'
    ])
    expect(entries.map(([, op]) => op.tool).sort()).toEqual([
      'API-get-block-children',
      'API-patch-block-children',
      'API-post-search',
      'API-retrieve-a-page'
    ])
  })
})

describe('normalizeNotionId', () => {
  it('ハイフンの有無・大文字を揃える', () => {
    expect(normalizeNotionId(PAGE_ID_COMPACT)).toBe(PAGE_ID)
    expect(normalizeNotionId(PAGE_ID.toUpperCase())).toBe(PAGE_ID)
    expect(normalizeNotionId(` ${PAGE_ID} `)).toBe(PAGE_ID)
  })

  it('UUID の形でなければ null（URL のパスへ埋め込まれるので、区切りや ../ を通さない）', () => {
    for (const value of [
      '../users',
      `${PAGE_ID}/../../users`,
      `${PAGE_ID}?x=1`,
      `https://www.notion.so/${PAGE_ID_COMPACT}`,
      PAGE_ID_COMPACT.slice(1),
      `${PAGE_ID_COMPACT}0`,
      'g'.repeat(32),
      '',
      42,
      null
    ]) {
      expect(normalizeNotionId(value)).toBeNull()
    }
  })
})

describe('search-pages', () => {
  const op = NOTION_MCP_OPERATIONS_TABLE['search-pages']

  it('query だけを受け付け、ページに絞って10件まで探す', () => {
    const parsed = op.parseArguments({ query: ' テスト ' })

    expect(parsed).toEqual({ ok: true, value: { query: 'テスト' } })
    expect(op.toolArguments({ query: 'テスト' })).toEqual({
      query: 'テスト',
      filter: { property: 'object', value: 'page' },
      page_size: 10
    })
  })

  it('空・長すぎ・改行入り・余計な引数は断る', () => {
    for (const raw of [
      { query: '' },
      { query: 'x'.repeat(201) },
      { query: 'a\nb' },
      { query: 'a', filter: {} },
      {}
    ]) {
      expect((parse('search-pages', raw) as { ok: boolean }).ok).toBe(false)
    }
  })

  it('結果からページの id・タイトル・ゴミ箱かだけを読む', () => {
    expect(
      op.readResult(
        textResult({
          object: 'list',
          results: [
            {
              object: 'page',
              id: PAGE_ID,
              in_trash: false,
              url: 'https://www.notion.so/x',
              properties: {
                Name: { type: 'title', title: [{ plain_text: 'A' }, { plain_text: 'B' }] }
              }
            },
            { object: 'data_source', id: PAGE_ID },
            { object: 'page', id: 'broken' }
          ]
        }),
        { query: 'x' }
      )
    ).toEqual({ pages: [{ id: PAGE_ID, title: 'AB', inTrash: false }] })
  })

  it('形が違えば null', () => {
    expect(op.readResult(textResult({ results: 'x' }), { query: 'x' })).toBeNull()
  })
})

describe('get-page / get-page-content', () => {
  it('pageId だけを受け付け、ハイフン付きへ揃えて渡す', () => {
    expect(parse('get-page', { pageId: PAGE_ID_COMPACT })).toEqual({
      ok: true,
      value: { pageId: PAGE_ID }
    })
    expect(NOTION_MCP_OPERATIONS_TABLE['get-page'].toolArguments({ pageId: PAGE_ID })).toEqual({
      page_id: PAGE_ID
    })
    expect(
      NOTION_MCP_OPERATIONS_TABLE['get-page-content'].toolArguments({ pageId: PAGE_ID })
    ).toEqual({ block_id: PAGE_ID, page_size: 100 })
  })

  it('壊れた pageId は断る', () => {
    for (const raw of [
      { pageId: '../users' },
      { pageId: PAGE_ID, extra: 1 },
      { page_id: PAGE_ID }
    ]) {
      expect((parse('get-page', raw) as { ok: boolean }).ok).toBe(false)
      expect((parse('get-page-content', raw) as { ok: boolean }).ok).toBe(false)
    }
  })

  it('ページの親の種類と、ブロックの平文を読む', () => {
    expect(
      NOTION_MCP_OPERATIONS_TABLE['get-page'].readResult(
        textResult({
          object: 'page',
          id: PAGE_ID,
          archived: false,
          parent: { type: 'workspace', workspace: true },
          properties: { title: { type: 'title', title: [{ plain_text: 'T' }] } }
        }),
        { pageId: PAGE_ID }
      )
    ).toEqual({ id: PAGE_ID, title: 'T', inTrash: false, parentType: 'workspace' })

    expect(
      NOTION_MCP_OPERATIONS_TABLE['get-page-content'].readResult(
        textResult({
          object: 'list',
          has_more: false,
          results: [
            {
              object: 'block',
              id: '11111111222233334444555555555555',
              type: 'paragraph',
              paragraph: { rich_text: [{ plain_text: 'hello' }] }
            },
            {
              object: 'block',
              id: '66666666-7777-8888-9999-000000000000',
              type: 'divider',
              divider: {}
            }
          ]
        }),
        { pageId: PAGE_ID }
      )
    ).toEqual({
      pageId: PAGE_ID,
      blocks: [
        { id: '11111111-2222-3333-4444-555555555555', type: 'paragraph', text: 'hello' },
        { id: '66666666-7777-8888-9999-000000000000', type: 'divider', text: null }
      ],
      hasMore: false
    })
  })
})

describe('append-paragraph', () => {
  const op = NOTION_MCP_OPERATIONS_TABLE['append-paragraph']

  it('書き込みで、段落1つを末尾に足す引数だけを組み立てる（after を渡さない）', () => {
    expect(op.kind).toBe('write')
    expect(op.toolArguments({ pageId: PAGE_ID, text: '本文' })).toEqual({
      block_id: PAGE_ID,
      children: [
        {
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: '本文' } }] }
        }
      ]
    })
  })

  it('改行は許し、空・2000文字超・制御文字・余計な引数は断る', () => {
    expect(parse('append-paragraph', { pageId: PAGE_ID, text: '1行目\n2行目' })).toEqual({
      ok: true,
      value: { pageId: PAGE_ID, text: '1行目\n2行目' }
    })

    for (const raw of [
      { pageId: PAGE_ID, text: ' ' },
      { pageId: PAGE_ID, text: 'x'.repeat(2001) },
      { pageId: PAGE_ID, text: 'a\u0007b' },
      { pageId: PAGE_ID, text: 'a', after: PAGE_ID },
      { pageId: '../users', text: 'a' },
      { text: 'a' }
    ]) {
      expect((parse('append-paragraph', raw) as { ok: boolean }).ok).toBe(false)
    }
  })

  it('確認の文に、どのページへ何を足すかを出す（日本語・英語）', () => {
    const args = { pageId: PAGE_ID, text: 'FluvixNexus MCP 書き込みテスト成功' }

    expect(op.describe?.(args, 'ja')).toEqual({
      title: 'Notion のページに段落を追記します',
      detail: expect.stringContaining(PAGE_ID)
    })
    expect(op.describe?.(args, 'ja').detail).toContain(args.text)
    expect(op.describe?.(args, 'en').title).toBe('Append a paragraph to a Notion page')
  })

  it('足したブロックの id を読む', () => {
    expect(
      op.readResult(
        textResult({
          object: 'list',
          results: [{ object: 'block', id: '11111111222233334444555555555555' }]
        }),
        { pageId: PAGE_ID, text: 'x' }
      )
    ).toEqual({ pageId: PAGE_ID, appendedBlockIds: ['11111111-2222-3333-4444-555555555555'] })
  })
})

describe('readToolError', () => {
  it('Notion のエラーから番号と分類だけを読む（本文は読まない）', () => {
    const summary = NOTION_MCP_OPERATIONS_TABLE['get-page'].readToolError?.(
      textResult(
        { object: 'error', status: 403, code: 'restricted_resource', message: 'secret detail' },
        true
      )
    )

    expect(summary).toEqual({ status: 403, code: 'restricted_resource' })
  })

  it('isError が無くても、エラーの形（object: error / 400 以上の status）ならエラーと読む', () => {
    const read = NOTION_MCP_OPERATIONS_TABLE['get-page'].readToolError

    // サーバーが包んだ形（架空の token で実物から返った形）
    expect(read?.(textResult({ status: 401, code: 'unauthorized' }))).toEqual({
      status: 401,
      code: 'unauthorized'
    })
    expect(read?.(textResult({ object: 'error', code: 'validation_error' }))).toEqual({
      status: null,
      code: 'validation_error'
    })
  })

  it('成功した応答はエラーと読まない', () => {
    const read = NOTION_MCP_OPERATIONS_TABLE['get-page'].readToolError

    for (const body of [
      { object: 'page', id: PAGE_ID },
      { object: 'list', results: [] },
      { status: 200 }
    ]) {
      expect(read?.(textResult(body))).toBeNull()
    }

    expect(
      read?.({ isError: false, texts: ['not json'], otherContent: 0, structuredContent: null })
    ).toBeNull()
  })
})
