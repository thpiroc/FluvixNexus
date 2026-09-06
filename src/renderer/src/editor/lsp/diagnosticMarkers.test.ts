import { describe, expect, it } from 'vitest'
import type { LspDiagnostic } from '@shared/lsp'
import { toEditorDiagnosticMarkers } from './diagnosticMarkers'

/**
 * 届いた指摘 → Monaco の marker が要る形（Session 5-3）。
 *
 * | 観点                        | 外すと何が起きるか                                  |
 * | --------------------------- | --------------------------------------------------- |
 * | 0 起点から 1 起点へ上がる   | 赤線が1行・1文字ずつずれる                          |
 * | 逆さの範囲を畳む            | Monaco が範囲を勝手に入れ替え、思わぬ広さで線を引く |
 * | 深刻度と印を名前のまま渡す  | この層が Monaco を読み込むことになる                |
 */

function diagnosticOf(overrides: Partial<LspDiagnostic> = {}): LspDiagnostic {
  return {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    severity: 'error',
    message: 'boom',
    source: null,
    code: null,
    tags: [],
    ...overrides
  }
}

describe('toEditorDiagnosticMarkers', () => {
  it('位置を 1 起点へ上げる', () => {
    const [marker] = toEditorDiagnosticMarkers([
      diagnosticOf({
        range: { start: { line: 2, character: 4 }, end: { line: 3, character: 8 } }
      })
    ])

    expect(marker).toMatchObject({
      startLineNumber: 3,
      startColumn: 5,
      endLineNumber: 4,
      endColumn: 9
    })
  })

  it('文書の先頭は 1 行 1 桁になる', () => {
    const [marker] = toEditorDiagnosticMarkers([
      diagnosticOf({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
      })
    ])

    expect(marker).toMatchObject({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1
    })
  })

  it('深刻度・出所・番号・印をそのまま持ち回る（Monaco の enum へは直さない）', () => {
    const [marker] = toEditorDiagnosticMarkers([
      diagnosticOf({
        severity: 'warning',
        source: 'ts',
        code: '2304',
        tags: ['unnecessary']
      })
    ])

    expect(marker).toMatchObject({
      severity: 'warning',
      source: 'ts',
      code: '2304',
      tags: ['unnecessary']
    })
  })

  it('終わりが始まりより前にある範囲は、始まりへ畳む', () => {
    const [sameLine] = toEditorDiagnosticMarkers([
      diagnosticOf({
        range: { start: { line: 1, character: 8 }, end: { line: 1, character: 2 } }
      })
    ])

    expect(sameLine).toMatchObject({
      startLineNumber: 2,
      startColumn: 9,
      endLineNumber: 2,
      endColumn: 9
    })

    const acrossLines = toEditorDiagnosticMarkers([
      diagnosticOf({
        range: { start: { line: 5, character: 0 }, end: { line: 2, character: 0 } }
      })
    ])[0]

    expect(acrossLines).toMatchObject({
      startLineNumber: 6,
      startColumn: 1,
      endLineNumber: 6,
      endColumn: 1
    })
  })

  it('同じ位置で始まって終わる範囲は畳まない（空の範囲は成立する）', () => {
    const [marker] = toEditorDiagnosticMarkers([
      diagnosticOf({
        range: { start: { line: 1, character: 3 }, end: { line: 1, character: 3 } }
      })
    ])

    expect(marker?.endColumn).toBe(4)
  })

  it('複数件の順序を変えない', () => {
    const markers = toEditorDiagnosticMarkers([
      diagnosticOf({ message: 'first' }),
      diagnosticOf({ message: 'second' })
    ])

    expect(markers.map((marker) => marker.message)).toEqual(['first', 'second'])
  })

  it('空の配列は空のまま（「問題は無い」を表す）', () => {
    expect(toEditorDiagnosticMarkers([])).toEqual([])
  })
})
