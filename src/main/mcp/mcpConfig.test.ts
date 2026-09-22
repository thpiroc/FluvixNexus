import { describe, expect, it } from 'vitest'
import { readMcpToken, redactToken } from './mcpConfig'

/**
 * MCP サーバーの token の読み方（mcpConfig.ts・MCP 共通）。
 *
 * どの変数から読むかは表の行が決める（Notion の分は mcpServerCatalog.test.ts）。
 * token はテスト用の架空の値。
 */

const TOKEN = 'ntn_fictitiousTestToken0123456789'
const VARIABLE = 'FLUVIX_EXAMPLE_MCP_TOKEN'

describe('readMcpToken', () => {
  it('指定された変数から読む', () => {
    expect(readMcpToken({ [VARIABLE]: TOKEN }, VARIABLE)).toEqual({ ok: true, token: TOKEN })
  })

  it('ほかの変数は見ない', () => {
    expect(readMcpToken({ OTHER_TOKEN: TOKEN }, VARIABLE)).toEqual({
      ok: false,
      problem: 'token-missing'
    })
  })

  it('前後の空白は落とす（コピーで付いてきやすい）', () => {
    expect(readMcpToken({ [VARIABLE]: `  ${TOKEN}\r\n` }, VARIABLE)).toEqual({
      ok: true,
      token: TOKEN
    })
  })

  it('無い・空は token-missing', () => {
    expect(readMcpToken({}, VARIABLE)).toEqual({ ok: false, problem: 'token-missing' })
    expect(readMcpToken({ [VARIABLE]: '   ' }, VARIABLE)).toEqual({
      ok: false,
      problem: 'token-missing'
    })
  })

  it('制御文字・途中の空白・全角文字は token-invalid', () => {
    for (const broken of [`\u0016${TOKEN}`, `ntn_abc def`, `ntn_ａｂｃ`]) {
      expect(readMcpToken({ [VARIABLE]: broken }, VARIABLE)).toEqual({
        ok: false,
        problem: 'token-invalid'
      })
    }
  })

  it('失敗の結果に token の文字は含まれない', () => {
    const result = readMcpToken({ [VARIABLE]: `${TOKEN} x` }, VARIABLE)

    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })
})

describe('redactToken', () => {
  it('現れた token をすべて伏せる', () => {
    expect(redactToken(`Bearer ${TOKEN} and again ${TOKEN}.`, TOKEN)).toBe(
      'Bearer <redacted> and again <redacted>.'
    )
  })

  it('token が無ければそのまま返す', () => {
    expect(redactToken('nothing to hide', null)).toBe('nothing to hide')
    expect(redactToken('nothing to hide', '')).toBe('nothing to hide')
  })
})
