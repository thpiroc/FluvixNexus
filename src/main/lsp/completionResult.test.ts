import { describe, expect, it } from 'vitest'
import {
  LSP_COMPLETION_COMMIT_CHARACTERS_MAX,
  LSP_COMPLETION_MAX_ITEMS,
  LSP_COMPLETION_TEXT_MAX_LENGTH
} from '@shared/lsp'
import { parseCompletionResult } from './completionResult'

function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { label: 'console', kind: 6, ...overrides }
}

function range(line = 0, character = 0): Record<string, unknown> {
  return {
    start: { line, character },
    end: { line, character: character + 1 }
  }
}

describe('parseCompletionResult', () => {
  it('CompletionList を正規化する', () => {
    const parsed = parseCompletionResult({
      isIncomplete: true,
      items: [
        item({
          detail: 'Console',
          documentation: { kind: 'markdown', value: '**global**' },
          sortText: '0',
          filterText: 'con',
          insertText: 'console',
          insertTextFormat: 1,
          commitCharacters: ['.', '.', ';', 'too-long'],
          preselect: true
        })
      ]
    })

    expect(parsed).toEqual({
      isIncomplete: true,
      items: [
        {
          label: 'console',
          kind: 'variable',
          detail: 'Console',
          documentation: '**global**',
          sortText: '0',
          filterText: 'con',
          insertText: 'console',
          textEdit: null,
          insertTextFormat: 'plainText',
          commitCharacters: ['.', ';'],
          preselect: true
        }
      ]
    })
  })

  it('CompletionItem[] も正規化する', () => {
    const parsed = parseCompletionResult([item({ label: 'map', kind: 3 })])

    expect(parsed).toMatchObject({
      isIncomplete: false,
      items: [{ label: 'map', kind: 'function' }]
    })
  })

  it('全体が読めない形は null にする', () => {
    expect(parseCompletionResult(null)).toBeNull()
    expect(parseCompletionResult('nope')).toBeNull()
    expect(parseCompletionResult({ isIncomplete: false })).toBeNull()
    expect(parseCompletionResult({ items: 'nope' })).toBeNull()
  })

  it('読めない item だけを捨てる', () => {
    const parsed = parseCompletionResult([
      item({ label: 'kept' }),
      { detail: 'missing label' },
      'broken',
      item({ label: '' })
    ])

    expect(parsed?.items.map((entry) => entry.label)).toEqual(['kept'])
  })

  it('Completion kind を shared の名前へ写す', () => {
    const parsed = parseCompletionResult([
      item({ label: 'class', kind: 7 }),
      item({ label: 'property', kind: 10 }),
      item({ label: 'enumMember', kind: 20 }),
      item({ label: 'unknown', kind: 999 })
    ])

    expect(parsed?.items.map((entry) => entry.kind)).toEqual([
      'class',
      'property',
      'enum-member',
      null
    ])
  })

  it('textEdit と snippet を通す', () => {
    const parsed = parseCompletionResult([
      item({
        label: 'for',
        insertText: 'ignored',
        insertTextFormat: 2,
        textEdit: { range: range(2, 4), newText: 'for (const x of xs) {$0}' }
      })
    ])

    expect(parsed?.items[0]).toMatchObject({
      insertText: 'ignored',
      insertTextFormat: 'snippet',
      textEdit: {
        range: { start: { line: 2, character: 4 }, end: { line: 2, character: 5 } },
        newText: 'for (const x of xs) {$0}'
      }
    })
  })

  it('insert/replace textEdit を現在文書内の範囲だけで通す', () => {
    const parsed = parseCompletionResult([
      item({
        textEdit: {
          insert: range(1, 2),
          replace: range(1, 2),
          newText: 'value'
        }
      })
    ])

    expect(parsed?.items[0]?.textEdit).toEqual({
      range: {
        insert: { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } },
        replace: { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } }
      },
      newText: 'value'
    })
  })

  it('workspace edit や command は公開しない', () => {
    const parsed = parseCompletionResult([
      item({
        command: { command: 'write-file' },
        additionalTextEdits: [{ range: range(), newText: 'x' }],
        data: { uri: 'file:///outside.ts' }
      })
    ])

    expect(parsed?.items[0]).not.toHaveProperty('command')
    expect(parsed?.items[0]).not.toHaveProperty('additionalTextEdits')
    expect(parsed?.items[0]).not.toHaveProperty('data')
  })

  it('件数・長さ・commit character 数を上限で切る', () => {
    const parsed = parseCompletionResult(
      Array.from({ length: LSP_COMPLETION_MAX_ITEMS + 10 }, (_unused, index) =>
        item({
          label: `x${index}`,
          detail: 'a'.repeat(LSP_COMPLETION_TEXT_MAX_LENGTH + 20),
          commitCharacters: Array.from(
            { length: LSP_COMPLETION_COMMIT_CHARACTERS_MAX + 5 },
            (_entry, characterIndex) => String.fromCharCode(65 + characterIndex)
          )
        })
      )
    )

    expect(parsed?.items).toHaveLength(LSP_COMPLETION_MAX_ITEMS)
    expect(parsed?.items[0]?.detail).toHaveLength(LSP_COMPLETION_TEXT_MAX_LENGTH)
    expect(parsed?.items[0]?.commitCharacters).toHaveLength(LSP_COMPLETION_COMMIT_CHARACTERS_MAX)
  })
})
