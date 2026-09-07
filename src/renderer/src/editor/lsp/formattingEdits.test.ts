import { describe, expect, it } from 'vitest'
import { toEditorFormattingEdits, type FormattingDocumentShape } from './formattingEdits'

const document: FormattingDocumentShape = {
  lineCount: 3,
  getLineMaxColumn: (lineNumber) => [0, 11, 6, 1][lineNumber] ?? 1
}

describe('formattingEdits', () => {
  it('LSP の 0 起点 range を Monaco 用の 1 起点 range へ変換する', () => {
    expect(
      toEditorFormattingEdits(
        [
          {
            range: { start: { line: 0, character: 2 }, end: { line: 1, character: 5 } },
            text: 'formatted'
          }
        ],
        document
      )
    ).toEqual([
      {
        range: { startLineNumber: 1, startColumn: 3, endLineNumber: 2, endColumn: 6 },
        text: 'formatted'
      }
    ])
  })

  it('現在の文書に収まらない range は全体を拒否する', () => {
    expect(
      toEditorFormattingEdits(
        [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 9, character: 0 } },
            text: ''
          }
        ],
        document
      )
    ).toBeNull()

    expect(
      toEditorFormattingEdits(
        [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 1, character: 99 } },
            text: ''
          }
        ],
        document
      )
    ).toBeNull()
  })

  it('逆向き / 重なり range は拒否する', () => {
    expect(
      toEditorFormattingEdits(
        [
          {
            range: { start: { line: 1, character: 1 }, end: { line: 0, character: 1 } },
            text: ''
          }
        ],
        document
      )
    ).toBeNull()

    expect(
      toEditorFormattingEdits(
        [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 1, character: 1 } },
            text: 'a'
          },
          {
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } },
            text: 'b'
          }
        ],
        document
      )
    ).toBeNull()
  })
})
