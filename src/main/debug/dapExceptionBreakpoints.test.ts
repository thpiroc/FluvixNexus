import { describe, expect, it } from 'vitest'
import {
  readDapExceptionBreakpointFilterIds,
  selectDapExceptionBreakpointFilters
} from './dapExceptionBreakpoints'

/** 実 debugpy 1.8.21 の `initialize` の応答が名乗った filter。 */
const DEBUGPY_CAPABILITIES = {
  supportsExceptionInfoRequest: true,
  exceptionBreakpointFilters: [
    { filter: 'raised', label: 'Raised Exceptions', default: false },
    { filter: 'uncaught', label: 'Uncaught Exceptions', default: true },
    { filter: 'userUnhandled', label: 'User Uncaught Exceptions', default: false }
  ]
}

describe('setExceptionBreakpoints filters', () => {
  it('reads the advertised filter ids and drops malformed entries', () => {
    expect(readDapExceptionBreakpointFilterIds(DEBUGPY_CAPABILITIES)).toEqual([
      'raised',
      'uncaught',
      'userUnhandled'
    ])
    expect(
      readDapExceptionBreakpointFilterIds({
        exceptionBreakpointFilters: [
          null,
          'uncaught',
          { filter: '' },
          { filter: 3 },
          { filter: 'a' },
          { filter: 'a' }
        ]
      })
    ).toEqual(['a'])
    expect(readDapExceptionBreakpointFilterIds({ exceptionBreakpointFilters: 'uncaught' })).toEqual(
      []
    )
    expect(readDapExceptionBreakpointFilterIds(undefined)).toEqual([])
  })

  it('sends only uncaught to debugpy (the shipped python table)', () => {
    expect(selectDapExceptionBreakpointFilters(DEBUGPY_CAPABILITIES, ['uncaught'])).toEqual({
      filters: ['uncaught']
    })
  })

  it('does not rely on the adapter default flag', () => {
    expect(selectDapExceptionBreakpointFilters(DEBUGPY_CAPABILITIES, [])).toBeNull()
  })

  it('does not send ids the adapter did not advertise', () => {
    expect(selectDapExceptionBreakpointFilters(DEBUGPY_CAPABILITIES, ['all'])).toBeNull()
    expect(selectDapExceptionBreakpointFilters(DEBUGPY_CAPABILITIES, ['all', 'uncaught'])).toEqual({
      filters: ['uncaught']
    })
    expect(selectDapExceptionBreakpointFilters({}, ['uncaught'])).toBeNull()
    expect(
      selectDapExceptionBreakpointFilters({ exceptionBreakpointFilters: [] }, ['uncaught'])
    ).toBeNull()
  })

  it('keeps the table order and removes duplicates', () => {
    expect(
      selectDapExceptionBreakpointFilters(DEBUGPY_CAPABILITIES, ['uncaught', 'raised', 'uncaught'])
    ).toEqual({ filters: ['uncaught', 'raised'] })
  })
})
