import { describe, expect, it } from 'vitest'
import { LSP_DIAGNOSTIC_MESSAGE_MAX_LENGTH, LSP_DIAGNOSTICS_MAX_PER_DOCUMENT } from '@shared/lsp'
import { parsePublishDiagnosticsParams } from './publishDiagnostics'

/**
 * 相手のプロセスが送ってきた JSON の読み方（Session 5-3）。
 *
 * ここは**境界の外から届く値**を最初に受ける場所になる。だから確かめたいのは
 * 「正しいものが読めること」より、**壊れたものが素通りしないこと**の側になる。
 *
 * | 観点                             | 素通りすると何が起きるか                          |
 * | -------------------------------- | ------------------------------------------------- |
 * | 全体が読めなければ null          | 形の違うものが Renderer まで運ばれる              |
 * | 1件が読めなくても残りは通す      | 1件の不備で、正しい指摘まで出なくなる             |
 * | 数を名前へ直す                   | Renderer が LSP の仕様を知ることになる            |
 * | 件数と長さを切る                 | 1通で JSON-RPC の上限に当たる / Monaco が詰まる   |
 */

function rangeOf(startLine: number, startCharacter: number): Record<string, unknown> {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: startLine, character: startCharacter + 1 }
  }
}

describe('parsePublishDiagnosticsParams', () => {
  it('uri・版・指摘を読む', () => {
    const parsed = parsePublishDiagnosticsParams({
      uri: 'file:///D%3A/proj/a.ts',
      version: 4,
      diagnostics: [
        { range: rangeOf(2, 6), severity: 1, message: 'boom', source: 'ts', code: 2304 }
      ]
    })

    expect(parsed).toEqual({
      uri: 'file:///D%3A/proj/a.ts',
      version: 4,
      diagnostics: [
        {
          range: { start: { line: 2, character: 6 }, end: { line: 2, character: 7 } },
          severity: 'error',
          message: 'boom',
          source: 'ts',
          code: '2304',
          tags: []
        }
      ]
    })
  })

  it('指摘が空でも読める（「問題は無い」という答え）', () => {
    const parsed = parsePublishDiagnosticsParams({ uri: 'file:///a', diagnostics: [] })

    expect(parsed?.diagnostics).toEqual([])
    expect(parsed?.version).toBeNull()
  })

  it('版を言わないサーバもある（null になる）', () => {
    expect(
      parsePublishDiagnosticsParams({ uri: 'file:///a', version: 'v2', diagnostics: [] })?.version
    ).toBeNull()
  })

  it('全体が読めない形は null（空の指摘とは違う）', () => {
    expect(parsePublishDiagnosticsParams(null)).toBeNull()
    expect(parsePublishDiagnosticsParams('nope')).toBeNull()
    expect(parsePublishDiagnosticsParams({ diagnostics: [] })).toBeNull()
    expect(parsePublishDiagnosticsParams({ uri: '', diagnostics: [] })).toBeNull()
    expect(parsePublishDiagnosticsParams({ uri: 'file:///a' })).toBeNull()
    expect(parsePublishDiagnosticsParams({ uri: 'file:///a', diagnostics: 'none' })).toBeNull()
  })

  it('深刻度を名前へ直す', () => {
    const parsed = parsePublishDiagnosticsParams({
      uri: 'file:///a',
      diagnostics: [1, 2, 3, 4].map((severity) => ({
        range: rangeOf(0, 0),
        severity,
        message: 'x'
      }))
    })

    expect(parsed?.diagnostics.map((diagnostic) => diagnostic.severity)).toEqual([
      'error',
      'warning',
      'information',
      'hint'
    ])
  })

  it('深刻度が無い / 知らない番号なら error（見落として困るのは常に error）', () => {
    const parsed = parsePublishDiagnosticsParams({
      uri: 'file:///a',
      diagnostics: [
        { range: rangeOf(0, 0), message: 'x' },
        { range: rangeOf(0, 0), severity: 9, message: 'y' }
      ]
    })

    expect(parsed?.diagnostics.map((diagnostic) => diagnostic.severity)).toEqual(['error', 'error'])
  })

  it('印を名前へ直し、知らない印と重複は落とす', () => {
    const parsed = parsePublishDiagnosticsParams({
      uri: 'file:///a',
      diagnostics: [{ range: rangeOf(0, 0), message: 'x', tags: [1, 2, 1, 7, 'nope'] }]
    })

    expect(parsed?.diagnostics[0]?.tags).toEqual(['unnecessary', 'deprecated'])
  })

  it('code は数でも文字列でも文字列にして運ぶ', () => {
    const parsed = parsePublishDiagnosticsParams({
      uri: 'file:///a',
      diagnostics: [
        { range: rangeOf(0, 0), message: 'a', code: 7016 },
        { range: rangeOf(0, 0), message: 'b', code: 'no-unused' },
        { range: rangeOf(0, 0), message: 'c', code: { value: 1 } },
        { range: rangeOf(0, 0), message: 'd' }
      ]
    })

    expect(parsed?.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      '7016',
      'no-unused',
      null,
      null
    ])
  })

  it('source は空文字なら null（出所の無い指摘として扱う）', () => {
    const parsed = parsePublishDiagnosticsParams({
      uri: 'file:///a',
      diagnostics: [{ range: rangeOf(0, 0), message: 'x', source: '' }]
    })

    expect(parsed?.diagnostics[0]?.source).toBeNull()
  })

  it('範囲や本文が読めない1件だけを捨て、残りは通す', () => {
    const parsed = parsePublishDiagnosticsParams({
      uri: 'file:///a',
      diagnostics: [
        { range: rangeOf(0, 0), message: 'kept' },
        { message: 'no range' },
        { range: { start: { line: 1 } }, message: 'broken range' },
        { range: rangeOf(1, 0) },
        { range: rangeOf(2, 0), message: 'also kept' }
      ]
    })

    expect(parsed?.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'kept',
      'also kept'
    ])
  })

  it('負の位置は 0 へ寄せる（数え間違いを、指摘を隠す理由にしない）', () => {
    const parsed = parsePublishDiagnosticsParams({
      uri: 'file:///a',
      diagnostics: [
        {
          range: { start: { line: -1, character: -5 }, end: { line: 0, character: 2 } },
          message: 'x'
        }
      ]
    })

    expect(parsed?.diagnostics[0]?.range.start).toEqual({ line: 0, character: 0 })
  })

  it('小数の位置は読めないものとして、その1件を捨てる', () => {
    const parsed = parsePublishDiagnosticsParams({
      uri: 'file:///a',
      diagnostics: [
        {
          range: { start: { line: 0.5, character: 0 }, end: { line: 1, character: 0 } },
          message: 'x'
        }
      ]
    })

    expect(parsed?.diagnostics).toEqual([])
  })

  it('件数を上限で切る', () => {
    const parsed = parsePublishDiagnosticsParams({
      uri: 'file:///a',
      diagnostics: Array.from(
        { length: LSP_DIAGNOSTICS_MAX_PER_DOCUMENT + 50 },
        (_unused, index) => ({
          range: rangeOf(index, 0),
          message: `x${index}`
        })
      )
    })

    expect(parsed?.diagnostics).toHaveLength(LSP_DIAGNOSTICS_MAX_PER_DOCUMENT)
    // 先頭から採るので、行の若い側が残る。
    expect(parsed?.diagnostics[0]?.message).toBe('x0')
  })

  it('長い本文を切り、切れていることを分かる形にする', () => {
    const message = 'a'.repeat(LSP_DIAGNOSTIC_MESSAGE_MAX_LENGTH + 100)
    const parsed = parsePublishDiagnosticsParams({
      uri: 'file:///a',
      diagnostics: [{ range: rangeOf(0, 0), message }]
    })

    const trimmed = parsed?.diagnostics[0]?.message ?? ''

    expect(trimmed).toHaveLength(LSP_DIAGNOSTIC_MESSAGE_MAX_LENGTH + 1)
    expect(trimmed.endsWith('…')).toBe(true)
  })
})
