import { describe, expect, it } from 'vitest'
import type * as monaco from 'monaco-editor'
import { toTextDocumentContentChanges } from './documentChanges'

/**
 * Monaco の編集イベント → 境界を越えられる差分（Session 5-2）。
 *
 * | 観点                              | 外すと何が起きるか                                   |
 * | --------------------------------- | ---------------------------------------------------- |
 * | 1 起点から 0 起点へ落ちる         | 変更位置が1文字・1行ずつずれる                       |
 * | 改行コードの変更が全文になる      | サーバ側の本文だけ古い改行のまま残り、以降がずれる    |
 * | setValue が全文になる             | 同上（差分として表せない編集）                        |
 * | 並べ替えない                      | 複数カーソルの編集が、適用順の違いでずれる            |
 * | 要らないときに全文を読まない      | 打鍵1回ごとに全行を連結することになる                 |
 */

interface FakeChange {
  readonly range: {
    readonly startLineNumber: number
    readonly startColumn: number
    readonly endLineNumber: number
    readonly endColumn: number
  }
  readonly text: string
}

function eventOf(
  changes: readonly FakeChange[],
  flags?: { readonly isFlush?: boolean; readonly isEolChange?: boolean }
): monaco.editor.IModelContentChangedEvent {
  return {
    changes,
    eol: '\n',
    versionId: 2,
    isUndoing: false,
    isRedoing: false,
    isFlush: flags?.isFlush ?? false,
    isEolChange: flags?.isEolChange ?? false
  } as unknown as monaco.editor.IModelContentChangedEvent
}

function changeOf(
  startLineNumber: number,
  startColumn: number,
  endLineNumber: number,
  endColumn: number,
  text: string
): FakeChange {
  return { range: { startLineNumber, startColumn, endLineNumber, endColumn }, text }
}

describe('toTextDocumentContentChanges', () => {
  it('1 起点の行・桁を 0 起点へ落とす', () => {
    const changes = toTextDocumentContentChanges(eventOf([changeOf(3, 5, 3, 7, 'ab')]), () => {
      throw new Error('全文は読まれないはず')
    })

    expect(changes).toEqual([
      {
        range: { start: { line: 2, character: 4 }, end: { line: 2, character: 6 } },
        text: 'ab'
      }
    ])
  })

  it('文書の先頭は line 0 / character 0 になる', () => {
    const changes = toTextDocumentContentChanges(eventOf([changeOf(1, 1, 1, 1, 'x')]), () => '')

    expect(changes[0]?.range).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 }
    })
  })

  it('改行コードだけの変更は、全文の置き換え1件になる', () => {
    const changes = toTextDocumentContentChanges(eventOf([], { isEolChange: true }), () => 'a\r\nb')

    expect(changes).toEqual([{ range: null, text: 'a\r\nb' }])
  })

  it('setValue（isFlush）も全文の置き換え1件になる', () => {
    const changes = toTextDocumentContentChanges(
      eventOf([changeOf(1, 1, 5, 1, 'whole')], { isFlush: true }),
      () => 'whole'
    )

    expect(changes).toEqual([{ range: null, text: 'whole' }])
  })

  it('変更が1つも無いイベントも全文へ落とす（形の無い差分を送らない）', () => {
    expect(toTextDocumentContentChanges(eventOf([]), () => 'text')).toEqual([
      { range: null, text: 'text' }
    ])
  })

  it('複数の変更を、Monaco が返した順のまま渡す', () => {
    const changes = toTextDocumentContentChanges(
      eventOf([changeOf(5, 1, 5, 2, 'z'), changeOf(1, 1, 1, 2, 'a')]),
      () => ''
    )

    expect(changes.map((change) => change.text)).toEqual(['z', 'a'])
    expect(changes[0]?.range?.start.line).toBe(4)
    expect(changes[1]?.range?.start.line).toBe(0)
  })

  it('差分で足りる編集では、全文を読みに行かない', () => {
    let reads = 0

    toTextDocumentContentChanges(eventOf([changeOf(1, 1, 1, 2, 'a')]), () => {
      reads += 1
      return ''
    })

    expect(reads).toBe(0)
  })
})
