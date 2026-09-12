import { describe, expect, it } from 'vitest'
import {
  DEBUG_EVALUATE_CONTEXTS,
  DEBUG_VARIABLE_VALUE_MAX_LENGTH,
  type DebugEvaluateContext
} from '@shared/debug'
import { createEvaluateArguments, parseEvaluateResponse } from './dapEvaluate'

/**
 * DAP `evaluate` の組み立てと読み取り（Session 6-7）。
 *
 * `variablesReference` が **Renderer 形に現れない**ことと、応答から採らない欄を
 * ここで固定する。
 */

describe('createEvaluateArguments', () => {
  it('sends the expression, the main-checked frame id and the translated context', () => {
    expect(createEvaluateArguments('user.name', 11, 'repl')).toEqual({
      expression: 'user.name',
      frameId: 11,
      context: 'repl'
    })
    expect(createEvaluateArguments('total', 12, 'watch')).toEqual({
      expression: 'total',
      frameId: 12,
      context: 'watch'
    })
  })

  /** 翻訳表が閉じた集合を網羅していること（値を足すと必ずここへ来る）。 */
  it.each(DEBUG_EVALUATE_CONTEXTS)('translates the %s context', (context) => {
    expect(typeof createEvaluateArguments('a', 1, context).context).toBe('string')
  })

  it('does not reshape the expression', () => {
    expect(createEvaluateArguments('  a + b  ', 1, 'repl').expression).toBe('  a + b  ')
  })

  it('carries no field beyond the three the request needs', () => {
    expect(Object.keys(createEvaluateArguments('a', 1, 'repl')).sort()).toEqual([
      'context',
      'expression',
      'frameId'
    ])
  })
})

describe('parseEvaluateResponse', () => {
  it('splits the variablesReference away from the renderer-safe value', () => {
    const parsed = parseEvaluateResponse({
      result: '{ name: "Ada" }',
      type: 'User',
      variablesReference: 4001,
      namedVariables: 2,
      indexedVariables: 0,
      presentationHint: { kind: 'class', attributes: ['readOnly'], visibility: 'public' },
      memoryReference: '0x00007ff6',
      valueLocationReference: 9
    })

    expect(parsed).toEqual({
      reference: 4001,
      value: {
        value: '{ name: "Ada" }',
        type: 'User',
        kind: 'class',
        namedCount: 2,
        indexedCount: 0
      }
    })
    expect(JSON.stringify(parsed?.value)).not.toContain('4001')
    expect(JSON.stringify(parsed?.value)).not.toContain('0x00007ff6')
  })

  it('folds an absent or unreadable variablesReference to 0 (a leaf)', () => {
    expect(parseEvaluateResponse({ result: '3' })?.reference).toBe(0)
    expect(parseEvaluateResponse({ result: '3', variablesReference: 0 })?.reference).toBe(0)
    expect(parseEvaluateResponse({ result: '3', variablesReference: -1 })?.reference).toBe(0)
    expect(parseEvaluateResponse({ result: '3', variablesReference: 1.5 })?.reference).toBe(0)
    expect(parseEvaluateResponse({ result: '3', variablesReference: '1000' })?.reference).toBe(0)
  })

  it('keeps an empty result (some adapters print nothing for undefined)', () => {
    expect(parseEvaluateResponse({ result: '', variablesReference: 0 })).toEqual({
      reference: 0,
      value: { value: '', type: null, kind: 'other', namedCount: null, indexedCount: null }
    })
  })

  it('folds an unknown presentation hint to "other"', () => {
    expect(
      parseEvaluateResponse({ result: '1', presentationHint: { kind: 'nope' } })?.value.kind
    ).toBe('other')
    expect(parseEvaluateResponse({ result: '1', presentationHint: 'data' })?.value.kind).toBe(
      'other'
    )
  })

  it('replaces control characters and truncates a very long value', () => {
    const parsed = parseEvaluateResponse({ result: `ab\tc${'x'.repeat(2000)}` })

    expect(parsed?.value.value.startsWith('a b c')).toBe(true)
    expect(parsed?.value.value.length).toBe(DEBUG_VARIABLE_VALUE_MAX_LENGTH + 1)
    expect(parsed?.value.value.endsWith('…')).toBe(true)
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an array', []],
    ['a string', 'result'],
    ['a number', 3],
    ['a body without result', { variablesReference: 1000 }],
    ['a non-string result', { result: 3 }],
    ['a null result', { result: null }]
  ])('rejects a malformed response (%s)', (_name, body) => {
    expect(parseEvaluateResponse(body)).toBeNull()
  })

  /** 型はラベルとして整える（別プロセスの文字列をそのまま持ち回らない）。 */
  it('drops an empty or unreadable type', () => {
    expect(parseEvaluateResponse({ result: '1', type: '' })?.value.type).toBeNull()
    expect(parseEvaluateResponse({ result: '1', type: 42 })?.value.type).toBeNull()
    expect(parseEvaluateResponse({ result: '1' })?.value.type).toBeNull()
  })
})

/** 型のうえでも、閉じた集合の外は渡せない。 */
const CONTEXTS: readonly DebugEvaluateContext[] = DEBUG_EVALUATE_CONTEXTS

describe('evaluate context table', () => {
  it('covers every context in the closed set', () => {
    expect(CONTEXTS.length).toBe(2)
  })
})
