import { describe, expect, it } from 'vitest'
import { toEditorHover } from './hoverContent'

describe('hoverContent', () => {
  it('markdown はそのまま Monaco hover 用へ渡す', () => {
    expect(
      toEditorHover({
        contents: [{ kind: 'markdown', value: '**value**' }],
        range: { start: { line: 1, character: 2 }, end: { line: 1, character: 7 } }
      })
    ).toEqual({
      contents: [{ value: '**value**' }],
      range: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 8 }
    })
  })

  it('plaintext は Markdown として解釈されないよう escape する', () => {
    expect(
      toEditorHover({
        contents: [{ kind: 'plaintext', value: 'const *x* = [link](file:///D:/secret)\nnext' }],
        range: null
      })
    ).toEqual({
      contents: [{ value: 'const \\*x\\* = \\[link\\]\\(file:///D:/secret\\)  \nnext' }],
      range: null
    })
  })

  it('空 contents は no result にする', () => {
    expect(toEditorHover({ contents: [], range: null })).toBeNull()
  })
})
