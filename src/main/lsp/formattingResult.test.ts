import { describe, expect, it } from 'vitest'
import { LSP_FORMATTING_MAX_TEXT_LENGTH } from '@shared/lsp'
import { parseFormattingResult } from './formattingResult'

describe('parseFormattingResult', () => {
  it('TextEdit[] を現在文書向けの range + text へ normalize する', () => {
    expect(
      parseFormattingResult([
        {
          range: { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } },
          newText: 'name'
        }
      ])
    ).toEqual([
      {
        range: { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } },
        text: 'name'
      }
    ])
  })

  it('null は編集なしとして扱う', () => {
    expect(parseFormattingResult(null)).toEqual([])
  })

  it('workspace edit / command など TextEdit[] でない response は拒否する', () => {
    expect(parseFormattingResult({ changes: { 'file:///D%3A/proj/other.ts': [] } })).toBeNull()
    expect(parseFormattingResult({ command: 'run-this' })).toBeNull()
  })

  it('壊れた edit / 逆向き range / 重なり range は拒否する', () => {
    expect(parseFormattingResult([{ range: {}, newText: '' }])).toBeNull()
    expect(
      parseFormattingResult([
        {
          range: { start: { line: 2, character: 0 }, end: { line: 1, character: 0 } },
          newText: ''
        }
      ])
    ).toBeNull()
    expect(
      parseFormattingResult([
        {
          range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
          newText: 'a'
        },
        {
          range: { start: { line: 0, character: 5 }, end: { line: 1, character: 1 } },
          newText: 'b'
        }
      ])
    ).toBeNull()
  })

  it('大きすぎる replacement text は拒否する', () => {
    expect(
      parseFormattingResult([
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          newText: 'x'.repeat(LSP_FORMATTING_MAX_TEXT_LENGTH + 1)
        }
      ])
    ).toBeNull()
  })
})
