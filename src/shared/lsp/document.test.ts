import { describe, expect, it } from 'vitest'
import { isTextDocumentContentChange, isTextDocumentVersion } from './document'

/**
 * 境界の外から届いた値の形（Session 5-2）。
 *
 * この2つを通った値は、そのまま子プロセスの標準入力へ流れる電文になる
 * （main/ipc/handlers/lsp.ts）。だから確かめるのは
 * **通してはいけないものが通らないこと**の側になる。
 */

describe('isTextDocumentVersion', () => {
  it('0 以上の整数だけを通す', () => {
    expect(isTextDocumentVersion(0)).toBe(true)
    expect(isTextDocumentVersion(42)).toBe(true)
  })

  it('負・小数・数でないものは通さない', () => {
    expect(isTextDocumentVersion(-1)).toBe(false)
    expect(isTextDocumentVersion(1.5)).toBe(false)
    expect(isTextDocumentVersion('1')).toBe(false)
    expect(isTextDocumentVersion(null)).toBe(false)
    expect(isTextDocumentVersion(undefined)).toBe(false)
  })

  it('数として扱えない値（NaN / Infinity）は通さない', () => {
    expect(isTextDocumentVersion(Number.NaN)).toBe(false)
    expect(isTextDocumentVersion(Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('isTextDocumentContentChange', () => {
  const range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 3 }
  }

  it('範囲を持つ変更を通す', () => {
    expect(isTextDocumentContentChange({ range, text: 'abc' })).toBe(true)
  })

  it('範囲を持たない変更（全置換）も通す', () => {
    expect(isTextDocumentContentChange({ range: null, text: 'whole' })).toBe(true)
  })

  it('本文が文字列でないものは通さない', () => {
    expect(isTextDocumentContentChange({ range, text: 123 })).toBe(false)
    expect(isTextDocumentContentChange({ range })).toBe(false)
  })

  it('範囲の形が欠けているものは通さない', () => {
    expect(isTextDocumentContentChange({ range: { start: range.start }, text: 'a' })).toBe(false)
    expect(isTextDocumentContentChange({ range: { start: {}, end: {} }, text: 'a' })).toBe(false)
  })

  it('位置が負・小数のものは通さない', () => {
    const negative = { start: { line: -1, character: 0 }, end: { line: 0, character: 0 } }
    const fractional = { start: { line: 0, character: 0.5 }, end: { line: 0, character: 1 } }

    expect(isTextDocumentContentChange({ range: negative, text: 'a' })).toBe(false)
    expect(isTextDocumentContentChange({ range: fractional, text: 'a' })).toBe(false)
  })

  it('オブジェクトでないものは通さない', () => {
    expect(isTextDocumentContentChange(null)).toBe(false)
    expect(isTextDocumentContentChange('abc')).toBe(false)
    expect(isTextDocumentContentChange(undefined)).toBe(false)
  })
})
