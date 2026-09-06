import { describe, expect, it } from 'vitest'
import type { LspCompletionList } from '@shared/lsp'
import { toEditorCompletionList } from './completionItems'

describe('toEditorCompletionList', () => {
  it('0 起点の textEdit を Monaco 側の 1 起点へ上げる', () => {
    const completion: LspCompletionList = {
      isIncomplete: false,
      items: [
        {
          label: 'console',
          kind: 'variable',
          detail: null,
          documentation: null,
          sortText: null,
          filterText: null,
          insertText: null,
          textEdit: {
            newText: 'console',
            range: {
              start: { line: 2, character: 4 },
              end: { line: 2, character: 7 }
            }
          },
          insertTextFormat: 'plainText',
          commitCharacters: [],
          preselect: false
        }
      ]
    }

    expect(toEditorCompletionList(completion).items[0]).toMatchObject({
      insertText: 'console',
      textEditRange: {
        startLineNumber: 3,
        startColumn: 5,
        endLineNumber: 3,
        endColumn: 8
      }
    })
  })

  it('textEdit の newText を insertText より優先する', () => {
    const completion: LspCompletionList = {
      isIncomplete: true,
      items: [
        {
          label: 'for',
          kind: 'snippet',
          detail: 'loop',
          documentation: 'docs',
          sortText: '0',
          filterText: 'fo',
          insertText: 'ignored',
          textEdit: {
            newText: 'for (const item of items) {$0}',
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 3 }
            }
          },
          insertTextFormat: 'snippet',
          commitCharacters: [';'],
          preselect: true
        }
      ]
    }

    expect(toEditorCompletionList(completion)).toMatchObject({
      incomplete: true,
      items: [
        {
          label: 'for',
          kind: 'snippet',
          detail: 'loop',
          documentation: 'docs',
          sortText: '0',
          filterText: 'fo',
          insertText: 'for (const item of items) {$0}',
          insertTextFormat: 'snippet',
          commitCharacters: [';'],
          preselect: true
        }
      ]
    })
  })

  it('insert/replace range も 1 起点へ上げる', () => {
    const completion: LspCompletionList = {
      isIncomplete: false,
      items: [
        {
          label: 'answer',
          kind: null,
          detail: null,
          documentation: null,
          sortText: null,
          filterText: null,
          insertText: null,
          textEdit: {
            newText: 'answer',
            range: {
              insert: {
                start: { line: 1, character: 2 },
                end: { line: 1, character: 2 }
              },
              replace: {
                start: { line: 1, character: 2 },
                end: { line: 1, character: 8 }
              }
            }
          },
          insertTextFormat: 'plainText',
          commitCharacters: [],
          preselect: false
        }
      ]
    }

    expect(toEditorCompletionList(completion).items[0]?.textEditRange).toEqual({
      insert: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 3 },
      replace: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 9 }
    })
  })
})
