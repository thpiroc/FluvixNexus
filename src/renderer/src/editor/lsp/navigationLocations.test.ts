import { describe, expect, it } from 'vitest'
import { toEditorWorkspaceLocations } from './navigationLocations'

describe('navigationLocations', () => {
  it('0 起点の LSP location を Monaco 側の 1 起点へ上げる', () => {
    expect(
      toEditorWorkspaceLocations([
        {
          relativePath: 'src/app.ts',
          range: {
            start: { line: 2, character: 4 },
            end: { line: 2, character: 10 }
          }
        }
      ])
    ).toEqual([
      {
        relativePath: 'src/app.ts',
        range: {
          startLineNumber: 3,
          startColumn: 5,
          endLineNumber: 3,
          endColumn: 11
        }
      }
    ])
  })
})
