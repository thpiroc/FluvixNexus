import { describe, expect, it } from 'vitest'
import { isLspFormattingOptions, LSP_FORMATTING_MAX_TAB_SIZE } from './formatting'

describe('isLspFormattingOptions', () => {
  it('tabSize と insertSpaces だけを formatting options として受ける', () => {
    expect(isLspFormattingOptions({ tabSize: 2, insertSpaces: true })).toBe(true)
    expect(
      isLspFormattingOptions({ tabSize: LSP_FORMATTING_MAX_TAB_SIZE, insertSpaces: false })
    ).toBe(true)
  })

  it('不正な tabSize / insertSpaces は拒否する', () => {
    expect(isLspFormattingOptions({ tabSize: 0, insertSpaces: true })).toBe(false)
    expect(isLspFormattingOptions({ tabSize: 1.5, insertSpaces: true })).toBe(false)
    expect(isLspFormattingOptions({ tabSize: 99, insertSpaces: true })).toBe(false)
    expect(isLspFormattingOptions({ tabSize: 2, insertSpaces: 'yes' })).toBe(false)
  })
})
