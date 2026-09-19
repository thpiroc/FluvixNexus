import { describe, expect, it } from 'vitest'
import {
  defineMcpOperation,
  findMcpOperation,
  readArgumentObject,
  readJsonTextContent,
  readStringArgument
} from './mcpOperations'

/**
 * MCP の操作の共通の枠（mcpOperations.ts）。架空の操作で確かめる
 * （Notion の操作表は notionMcpOperations.test.ts）。
 */

const READ = defineMcpOperation<{ readonly value: string }>({
  kind: 'read',
  tool: 'example-read',
  parseArguments: () => ({ ok: true, value: { value: 'x' } }),
  toolArguments: (args) => ({ value: args.value }),
  readResult: () => null
})

describe('defineMcpOperation', () => {
  it('確認の文が無い書き込みは作らせない', () => {
    expect(() =>
      defineMcpOperation({
        kind: 'write',
        tool: 'example-write',
        parseArguments: () => ({ ok: true, value: {} }),
        toolArguments: () => ({}),
        readResult: () => null
      })
    ).toThrow('needs a description')
  })
})

describe('findMcpOperation', () => {
  const table = { 'read-something': READ }

  it('表にある名前だけを返す', () => {
    expect(findMcpOperation(table, 'read-something')).toBe(READ)
  })

  it('継承した名前・文字列でない値は拾わない', () => {
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 1, null]) {
      expect(findMcpOperation(table, name)).toBeNull()
    }
  })
})

describe('readArgumentObject', () => {
  it('決まった名前だけを持つ object を受け付ける', () => {
    expect(readArgumentObject({ a: 1 }, ['a', 'b'])).toEqual({ ok: true, value: { a: 1 } })
  })

  it('知らない名前が混ざっていたら断る（黙って捨てない）', () => {
    expect(readArgumentObject({ a: 1, tool: 'x' }, ['a'])).toEqual({
      ok: false,
      reason: 'unknown argument(s): tool.'
    })
  })

  it('object でなければ断る', () => {
    for (const raw of [null, undefined, 'a', 1, ['a']]) {
      expect(readArgumentObject(raw, ['a']).ok).toBe(false)
    }
  })
})

describe('readStringArgument', () => {
  const rule = { minLength: 1, maxLength: 5, multiline: false }

  it('前後の空白を落とす', () => {
    expect(readStringArgument({ q: '  abc ' }, 'q', rule)).toEqual({ ok: true, value: 'abc' })
  })

  it('長さは文字（コードポイント）で数える', () => {
    expect(readStringArgument({ q: '😀😀😀😀😀' }, 'q', rule).ok).toBe(true)
    expect(readStringArgument({ q: '😀😀😀😀😀😀' }, 'q', rule).ok).toBe(false)
    expect(readStringArgument({ q: '   ' }, 'q', rule).ok).toBe(false)
  })

  it('制御文字を断る。改行は multiline のときだけ許す', () => {
    expect(readStringArgument({ q: 'a\u0000b' }, 'q', rule).ok).toBe(false)
    expect(readStringArgument({ q: 'a\nb' }, 'q', rule).ok).toBe(false)
    expect(readStringArgument({ q: 'a\nb' }, 'q', { ...rule, multiline: true }).ok).toBe(true)
    expect(readStringArgument({ q: 'a\tb' }, 'q', { ...rule, multiline: true }).ok).toBe(false)
  })

  it('文字列でなければ断り、理由に値を含めない', () => {
    const result = readStringArgument({ q: 12345 }, 'q', rule)

    expect(result).toEqual({ ok: false, reason: '"q" must be a string.' })
  })
})

describe('readJsonTextContent', () => {
  it('1つ目の文字の content を JSON として読む', () => {
    expect(
      readJsonTextContent({
        isError: false,
        texts: ['{"a":1}', 'ignored'],
        otherContent: 0,
        structuredContent: null
      })
    ).toEqual({ a: 1 })
  })

  it('読めなければ null', () => {
    for (const texts of [[], ['not json']]) {
      expect(
        readJsonTextContent({ isError: false, texts, otherContent: 0, structuredContent: null })
      ).toBeNull()
    }
  })
})
