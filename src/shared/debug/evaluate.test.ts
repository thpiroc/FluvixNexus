import { describe, expect, it } from 'vitest'
import {
  DEBUG_EVALUATE_CONTEXTS,
  DEBUG_EVALUATE_EXPRESSION_MAX_LENGTH,
  isDebugEvaluateContext,
  isDebugEvaluateExpressionShape
} from './evaluate'

/**
 * Evaluate の domain model（Session 6-7）。
 *
 * ここで固定するのは**閉じた集合であること**と、式として通す形の線の2つになる。
 */

describe('debug evaluate context', () => {
  it('is a closed set of exactly the two contexts Session 6-7 needs', () => {
    expect([...DEBUG_EVALUATE_CONTEXTS]).toEqual(['repl', 'watch'])
  })

  it.each(['repl', 'watch'] as const)('accepts %s', (context) => {
    expect(isDebugEvaluateContext(context)).toBe(true)
  })

  /**
   * DAP が挙げるほかの文脈も、任意の文字列も通さない。通せば「adapter に何を頼めるか」を
   * Renderer が決めることになる（shared/debug/evaluate.ts）。
   */
  it.each([
    'hover',
    'clipboard',
    'variables',
    'REPL',
    '',
    'repl ',
    'evaluate',
    'setVariable',
    1,
    null,
    undefined,
    ['repl'],
    { context: 'repl' }
  ])('rejects %j', (value) => {
    expect(isDebugEvaluateContext(value)).toBe(false)
  })
})

describe('debug evaluate expression shape', () => {
  it.each(['a', 'user.name', '  a + b  ', 'a'.repeat(DEBUG_EVALUATE_EXPRESSION_MAX_LENGTH)])(
    'accepts %j',
    (expression) => {
      expect(isDebugEvaluateExpressionShape(expression)).toBe(true)
    }
  )

  it.each([
    ['not a string', 42],
    ['null', null],
    ['undefined', undefined],
    ['an array', ['a']],
    ['empty', ''],
    ['blank', '   \t\n '],
    ['one over the limit', 'a'.repeat(DEBUG_EVALUATE_EXPRESSION_MAX_LENGTH + 1)],
    ['containing NUL', 'a\0b']
  ])('rejects %s', (_name, value) => {
    expect(isDebugEvaluateExpressionShape(value)).toBe(false)
  })

  /** 多行の式は通す ── REPL に貼り付ける式は普通に改行を含む。 */
  it('accepts a multi-line expression', () => {
    expect(isDebugEvaluateExpressionShape('a\nb')).toBe(true)
  })
})
