import { describe, expect, it } from 'vitest'
import { LSP_HOVER_MAX_CONTENTS, LSP_HOVER_TEXT_MAX_LENGTH } from '@shared/lsp'
import { parseHoverResult } from './hoverResult'

function range(line = 0, character = 0): Record<string, unknown> {
  return {
    start: { line, character },
    end: { line, character: character + 1 }
  }
}

describe('parseHoverResult', () => {
  it('MarkupContent を最小形式へ正規化する', () => {
    expect(
      parseHoverResult({
        contents: { kind: 'markdown', value: '**symbol**' },
        range: range(2, 4)
      })
    ).toEqual({
      contents: [{ kind: 'markdown', value: '**symbol**' }],
      range: { start: { line: 2, character: 4 }, end: { line: 2, character: 5 } }
    })
  })

  it('plaintext と MarkedString[] を通す', () => {
    expect(
      parseHoverResult({
        contents: [
          { kind: 'plaintext', value: 'const value: number' },
          'plain string',
          { language: 'ts', value: 'const answer = 42' }
        ]
      })
    ).toEqual({
      contents: [
        { kind: 'plaintext', value: 'const value: number' },
        { kind: 'plaintext', value: 'plain string' },
        { kind: 'markdown', value: '```ts\nconst answer = 42\n```' }
      ],
      range: null
    })
  })

  it('空・不正・未対応レスポンスは null にする', () => {
    expect(parseHoverResult(null)).toBeNull()
    expect(parseHoverResult('nope')).toBeNull()
    expect(parseHoverResult({ contents: [] })).toBeNull()
    expect(parseHoverResult({ contents: { kind: 'markdown', value: '' } })).toBeNull()
    expect(parseHoverResult({ contents: { kind: 'html', value: '<b>x</b>' } })).toBeNull()
  })

  it('読めない content と range は安全に捨てる', () => {
    expect(
      parseHoverResult({
        contents: [{ kind: 'markdown', value: 'kept' }, 123],
        range: { start: { line: 1, character: 2 }, end: 'broken' }
      })
    ).toEqual({
      contents: [{ kind: 'markdown', value: 'kept' }],
      range: null
    })
  })

  it('件数と長さを上限で切り、余計な payload は公開しない', () => {
    const parsed = parseHoverResult({
      contents: Array.from({ length: LSP_HOVER_MAX_CONTENTS + 4 }, (_unused, index) => ({
        kind: 'markdown',
        value: `${index}${'a'.repeat(LSP_HOVER_TEXT_MAX_LENGTH + 20)}`,
        command: { command: 'write-file' },
        data: { uri: 'file:///outside.ts' }
      })),
      executable: 'typescript-language-server',
      args: ['--stdio'],
      cwd: 'D:\\proj'
    })

    expect(parsed?.contents).toHaveLength(LSP_HOVER_MAX_CONTENTS)
    expect(parsed?.contents[0]?.value).toHaveLength(LSP_HOVER_TEXT_MAX_LENGTH)
    expect(parsed).not.toHaveProperty('executable')
    expect(parsed?.contents[0]).not.toHaveProperty('command')
    expect(parsed?.contents[0]).not.toHaveProperty('data')
  })
})
