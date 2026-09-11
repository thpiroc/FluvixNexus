import { describe, expect, it } from 'vitest'
import { DEBUG_VARIABLE_VALUE_MAX_LENGTH } from '@shared/debug'
import {
  createScopesArguments,
  createVariablesArguments,
  parseScopesResponse,
  parseVariablesResponse,
  readSupportsVariablePaging,
  sanitizeVariableValue
} from './dapVariables'

describe('DAP scopes response', () => {
  it('normalizes scopes and keeps variablesReference apart from the Renderer shape', () => {
    const parsed = parseScopesResponse(
      {
        scopes: [
          {
            name: 'Locals',
            presentationHint: 'locals',
            variablesReference: 1000,
            namedVariables: 3,
            expensive: false,
            source: { path: 'D:\\secret\\app.ts' },
            line: 4,
            column: 2
          },
          {
            name: 'Globals',
            variablesReference: 1001,
            expensive: true,
            presentationHint: 'globals'
          }
        ]
      },
      500
    )

    expect(parsed).toEqual({
      truncated: false,
      entries: [
        {
          reference: 1000,
          scope: {
            name: 'Locals',
            kind: 'locals',
            expensive: false,
            namedCount: 3,
            indexedCount: null
          }
        },
        {
          reference: 1001,
          scope: {
            name: 'Globals',
            kind: 'other',
            expensive: true,
            namedCount: null,
            indexedCount: null
          }
        }
      ]
    })
    expect(JSON.stringify(parsed?.entries.map((entry) => entry.scope))).not.toContain('secret')
  })

  it('drops non-object scopes and folds malformed fields', () => {
    const parsed = parseScopesResponse(
      {
        scopes: [
          null,
          'Locals',
          [1],
          { name: 42, variablesReference: -1, expensive: 'yes', namedVariables: 1.5 },
          { name: 'Arguments', variablesReference: 1.2, presentationHint: 'arguments' }
        ]
      },
      500
    )

    expect(parsed?.entries).toEqual([
      {
        reference: 0,
        scope: {
          name: 'Scope',
          kind: 'other',
          expensive: false,
          namedCount: null,
          indexedCount: null
        }
      },
      {
        reference: 0,
        scope: {
          name: 'Arguments',
          kind: 'arguments',
          expensive: false,
          namedCount: null,
          indexedCount: null
        }
      }
    ])
  })

  it('returns null for a malformed response body', () => {
    expect(parseScopesResponse(undefined, 500)).toBeNull()
    expect(parseScopesResponse({ scopes: 'nope' }, 500)).toBeNull()
    expect(parseScopesResponse([], 500)).toBeNull()
  })
})

describe('DAP variables response', () => {
  it('normalizes variables, including leaves, nested references, and counts', () => {
    const parsed = parseVariablesResponse(
      {
        variables: [
          { name: 'count', value: '3', type: 'number', variablesReference: 0 },
          {
            name: 'user',
            value: '{…}',
            type: 'User',
            variablesReference: 2001,
            namedVariables: 2,
            presentationHint: { kind: 'class', attributes: ['readOnly'], visibility: 'private' },
            evaluateName: 'user',
            memoryReference: '0xdeadbeef',
            declarationLocationReference: 7,
            valueLocationReference: 8
          },
          {
            name: 'items',
            value: 'Array(3)',
            variablesReference: 2002,
            indexedVariables: 3,
            presentationHint: { kind: 'somethingNew' }
          }
        ]
      },
      500
    )

    expect(parsed).toEqual({
      truncated: false,
      entries: [
        {
          reference: 0,
          variable: {
            name: 'count',
            value: '3',
            type: 'number',
            kind: 'other',
            namedCount: null,
            indexedCount: null
          }
        },
        {
          reference: 2001,
          variable: {
            name: 'user',
            value: '{…}',
            type: 'User',
            kind: 'class',
            namedCount: 2,
            indexedCount: null
          }
        },
        {
          reference: 2002,
          variable: {
            name: 'items',
            value: 'Array(3)',
            type: null,
            kind: 'other',
            namedCount: null,
            indexedCount: 3
          }
        }
      ]
    })

    const serialized = JSON.stringify(parsed?.entries.map((entry) => entry.variable))

    for (const leaked of [
      'evaluateName',
      'memoryReference',
      '0xdeadbeef',
      'Location',
      'readOnly'
    ]) {
      expect(serialized).not.toContain(leaked)
    }
  })

  it('keeps malformed variables visible as leaves and drops non-objects', () => {
    const parsed = parseVariablesResponse(
      {
        variables: [
          42,
          { value: 7, variablesReference: '12' },
          { name: '  spaced \n name  ', value: 'ok', type: 99, variablesReference: Number.NaN }
        ]
      },
      500
    )

    expect(parsed?.entries).toEqual([
      {
        reference: 0,
        variable: {
          name: '(unnamed)',
          value: '',
          type: null,
          kind: 'other',
          namedCount: null,
          indexedCount: null
        }
      },
      {
        reference: 0,
        variable: {
          name: 'spaced name',
          value: 'ok',
          type: null,
          kind: 'other',
          namedCount: null,
          indexedCount: null
        }
      }
    ])
  })

  it('reads only up to the limit and reports truncation for a large list', () => {
    const variables = Array.from({ length: 2_000 }, (_, index) => ({
      name: `item${String(index)}`,
      value: String(index),
      variablesReference: 0
    }))

    const parsed = parseVariablesResponse({ variables }, 500)

    expect(parsed?.entries).toHaveLength(500)
    expect(parsed?.truncated).toBe(true)
    expect(parsed?.entries.at(-1)?.variable.name).toBe('item499')
    expect(parseVariablesResponse({ variables: variables.slice(0, 500) }, 500)?.truncated).toBe(
      false
    )
  })

  it('returns null for a malformed response body', () => {
    expect(parseVariablesResponse(null, 500)).toBeNull()
    expect(parseVariablesResponse({ variables: {} }, 500)).toBeNull()
    expect(parseVariablesResponse({ scopes: [] }, 500)).toBeNull()
  })
})

describe('variable value sanitization', () => {
  it('removes NUL, flattens control characters, and truncates long values', () => {
    expect(sanitizeVariableValue('a\0b\nc\td')).toBe('ab c d')
    expect(sanitizeVariableValue('  keep  spaces  ')).toBe('  keep  spaces  ')
    expect(sanitizeVariableValue(undefined)).toBe('')
    expect(sanitizeVariableValue({ toString: () => 'x' })).toBe('')

    const long = sanitizeVariableValue('x'.repeat(DEBUG_VARIABLE_VALUE_MAX_LENGTH + 10))

    expect(long).toHaveLength(DEBUG_VARIABLE_VALUE_MAX_LENGTH + 1)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('DAP scopes / variables arguments', () => {
  it('builds scopes arguments from the frame id only', () => {
    expect(createScopesArguments(11)).toEqual({ frameId: 11 })
  })

  it('adds start / count only when the adapter supports variable paging', () => {
    expect(createVariablesArguments(1000, false, 500)).toEqual({ variablesReference: 1000 })
    expect(createVariablesArguments(1000, true, 500)).toEqual({
      variablesReference: 1000,
      start: 0,
      count: 501
    })
  })

  it('reads supportsVariablePaging only when it is exactly true', () => {
    expect(readSupportsVariablePaging({ supportsVariablePaging: true })).toBe(true)
    expect(readSupportsVariablePaging({ supportsVariablePaging: 'true' })).toBe(false)
    expect(readSupportsVariablePaging({})).toBe(false)
    expect(readSupportsVariablePaging(null)).toBe(false)
  })
})
