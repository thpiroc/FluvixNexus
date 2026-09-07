import { describe, expect, it } from 'vitest'
import { LSP_NAVIGATION_MAX_LOCATIONS } from '@shared/lsp'
import { parseDefinitionResult, parseReferencesResult } from './navigationResult'

const ROOT = 'D:\\proj'

function range(line = 0, character = 0): Record<string, unknown> {
  return {
    start: { line, character },
    end: { line, character: character + 4 }
  }
}

function location(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uri: 'file:///D%3A/proj/src/app.ts',
    range: range(1, 2),
    ...overrides
  }
}

describe('parseDefinitionResult', () => {
  it('Location と Location[] を Workspace 相対位置へ正規化する', () => {
    expect(parseDefinitionResult(ROOT, location())).toEqual([
      {
        relativePath: 'src/app.ts',
        range: { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } }
      }
    ])

    expect(
      parseDefinitionResult(ROOT, [location({ uri: 'file:///D%3A/proj/src/other.ts' })])
    ).toEqual([
      {
        relativePath: 'src/other.ts',
        range: { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } }
      }
    ])
  })

  it('LocationLink は targetSelectionRange を優先して読む', () => {
    expect(
      parseDefinitionResult(ROOT, [
        {
          targetUri: 'file:///D%3A/proj/src/target.ts',
          targetRange: range(10, 0),
          targetSelectionRange: range(12, 4)
        }
      ])
    ).toEqual([
      {
        relativePath: 'src/target.ts',
        range: { start: { line: 12, character: 4 }, end: { line: 12, character: 8 } }
      }
    ])
  })

  it('workspace 外 URI と壊れた location は捨てる', () => {
    expect(
      parseDefinitionResult(ROOT, [
        location({ uri: 'file:///D%3A/other/outside.ts' }),
        location({ uri: 'https://example.com/app.ts' }),
        { uri: 'file:///D%3A/proj/src/app.ts' },
        location({ uri: 'file:///D%3A/proj/src/app.ts' })
      ])
    ).toHaveLength(1)
  })

  it('null は no result、読めない top-level は malformed として返す', () => {
    expect(parseDefinitionResult(ROOT, null)).toEqual([])
    expect(parseDefinitionResult(ROOT, 'nope')).toBeNull()
  })
})

describe('parseReferencesResult', () => {
  it('重複 location を除去する', () => {
    expect(
      parseReferencesResult(ROOT, [location(), location(), location({ range: range(2, 0) })])
    ).toEqual([
      {
        relativePath: 'src/app.ts',
        range: { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } }
      },
      {
        relativePath: 'src/app.ts',
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 4 } }
      }
    ])
  })

  it('件数を上限で切る', () => {
    const parsed = parseReferencesResult(
      ROOT,
      Array.from({ length: LSP_NAVIGATION_MAX_LOCATIONS + 20 }, (_entry, index) =>
        location({ range: range(index, 0) })
      )
    )

    expect(parsed).toHaveLength(LSP_NAVIGATION_MAX_LOCATIONS)
  })

  it('null は no result、配列以外は malformed として返す', () => {
    expect(parseReferencesResult(ROOT, null)).toEqual([])
    expect(parseReferencesResult(ROOT, location())).toBeNull()
  })
})
