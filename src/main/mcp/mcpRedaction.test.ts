import { describe, expect, it } from 'vitest'
import { redactSecrets, redactToken } from './mcpRedaction'

/**
 * ログへ出す前の伏せ字（mcpRedaction.ts・MCP 共通）。
 *
 * 値はテスト用の架空のもの。
 */

const TOKEN = 'ghp_fictitiousTestToken0123456789'

describe('redactToken', () => {
  it('現れた値をすべて伏せる', () => {
    expect(redactToken(`Bearer ${TOKEN} and again ${TOKEN}.`, TOKEN)).toBe(
      'Bearer <redacted> and again <redacted>.'
    )
  })

  it('値が無ければそのまま返す', () => {
    expect(redactToken('nothing to hide', null)).toBe('nothing to hide')
    expect(redactToken('nothing to hide', '')).toBe('nothing to hide')
  })
})

describe('redactSecrets（登録したサーバーの秘密の値）', () => {
  it('すべての値を伏せる。短い値が長い値の一部でも、長い方の残りを出さない', () => {
    expect(redactSecrets(`key=${TOKEN} short=abc`, ['abc', TOKEN, null, ''])).toBe(
      'key=<redacted> short=<redacted>'
    )
    expect(redactSecrets('prefix-abcdef', ['abc', 'abcdef'])).toBe('prefix-<redacted>')
  })
})
