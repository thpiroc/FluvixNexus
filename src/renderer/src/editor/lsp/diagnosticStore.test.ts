import { describe, expect, it } from 'vitest'
import type { EditorDiagnosticMarker } from './diagnosticMarkers'
import { EditorDiagnosticStore } from './diagnosticStore'

/**
 * 届いた指摘の控えと、古い指摘の捨て方（Session 5-3）。
 *
 * 診断は**片道のイベント**として届く。届く順序も、いつ止まるかも、
 * 受け手から見れば決まっていない ── その中で「今どうなっているか」を
 * 1つに保つのがこの層で、Monaco を知らないのでそのまま試せる。
 *
 * | 観点                                     | 外すと何が起きるか                                    |
 * | ---------------------------------------- | ----------------------------------------------------- |
 * | 古い版で新しい版を上書きしない           | 直した箇所に、遅れて届いた古い赤線が戻る              |
 * | 空の指摘と「控えが無い」を区別する       | 問題の無いファイルで Monaco 内蔵の指摘が二重に出る    |
 * | 描き直す位置だけを控える                 | 1通ごとに marker を置き直し、開いた直後に描画が詰まる |
 * | 消えた位置も描き直しに含める             | 外すべき marker が残る                                |
 */

function markerOf(line: number, message = 'boom'): EditorDiagnosticMarker {
  return {
    startLineNumber: line,
    startColumn: 1,
    endLineNumber: line,
    endColumn: 2,
    message,
    severity: 'error',
    source: null,
    code: null,
    tags: []
  }
}

describe('set', () => {
  it('入れ替えたら true を返し、控えに載る', () => {
    const store = new EditorDiagnosticStore()

    expect(store.set('a.ts', 1, [markerOf(1)])).toBe(true)
    expect(store.get('a.ts')).toHaveLength(1)
  })

  it('足すのではなく入れ替える（publishDiagnostics は毎回その文書の全件）', () => {
    const store = new EditorDiagnosticStore()

    store.set('a.ts', 1, [markerOf(1), markerOf(2)])
    store.set('a.ts', 2, [markerOf(5)])

    expect(store.get('a.ts')?.map((marker) => marker.startLineNumber)).toEqual([5])
  })

  it('空の指摘も控えとして残る（「この文書に問題は無い」という答え）', () => {
    const store = new EditorDiagnosticStore()

    store.set('a.ts', 1, [])

    expect(store.get('a.ts')).toEqual([])
    expect(store.paths()).toEqual(['a.ts'])
  })
})

describe('古い指摘（stale）', () => {
  it('遅れて届いた古い版は捨てる', () => {
    const store = new EditorDiagnosticStore()

    store.set('a.ts', 7, [markerOf(7)])

    expect(store.set('a.ts', 6, [markerOf(6)])).toBe(false)
    expect(store.get('a.ts')?.[0]?.startLineNumber).toBe(7)
  })

  it('新しい版は通す', () => {
    const store = new EditorDiagnosticStore()

    store.set('a.ts', 7, [markerOf(7)])

    expect(store.set('a.ts', 8, [markerOf(8)])).toBe(true)
    expect(store.get('a.ts')?.[0]?.startLineNumber).toBe(8)
  })

  it('同じ版は通す（サーバが計算し直して送り直すことがある）', () => {
    const store = new EditorDiagnosticStore()

    store.set('a.ts', 7, [markerOf(7)])

    expect(store.set('a.ts', 7, [])).toBe(true)
    expect(store.get('a.ts')).toEqual([])
  })

  it('版を言わない指摘は通す（比べようが無い）', () => {
    const store = new EditorDiagnosticStore()

    store.set('a.ts', 7, [markerOf(7)])

    expect(store.set('a.ts', null, [markerOf(1)])).toBe(true)
    expect(store.get('a.ts')?.[0]?.startLineNumber).toBe(1)
  })

  it('控えの版が無ければ、どの版でも通す', () => {
    const store = new EditorDiagnosticStore()

    store.set('a.ts', null, [markerOf(9)])

    expect(store.set('a.ts', 2, [markerOf(2)])).toBe(true)
  })

  it('古さは文書ごとに見る（別の文書の版に引きずられない）', () => {
    const store = new EditorDiagnosticStore()

    store.set('a.ts', 9, [markerOf(9)])

    expect(store.set('b.ts', 1, [markerOf(1)])).toBe(true)
  })
})

describe('clear / clearAll', () => {
  it('控えを外すと「サーバが答えていない」状態に戻る（空の指摘とは違う）', () => {
    const store = new EditorDiagnosticStore()

    store.set('a.ts', 1, [])

    expect(store.clear('a.ts')).toBe(true)
    expect(store.get('a.ts')).toBeNull()
    expect(store.paths()).toEqual([])
  })

  it('知らない位置を外しても失敗にしない', () => {
    expect(new EditorDiagnosticStore().clear('gone.ts')).toBe(false)
  })

  it('すべて外す（Workspace の切り替え・サーバの全停止）', () => {
    const store = new EditorDiagnosticStore()

    store.set('a.ts', 1, [markerOf(1)])
    store.set('b.py', 1, [markerOf(1)])
    store.clearAll()

    expect(store.paths()).toEqual([])
    expect(store.get('a.ts')).toBeNull()
  })

  it('外した後は、古さの比較もやり直しになる', () => {
    const store = new EditorDiagnosticStore()

    store.set('a.ts', 9, [markerOf(9)])
    store.clear('a.ts')

    expect(store.set('a.ts', 1, [markerOf(1)])).toBe(true)
  })
})

describe('takeDirty', () => {
  it('変わった位置だけを返し、取り出すと空になる', () => {
    const store = new EditorDiagnosticStore()

    store.set('a.ts', 1, [markerOf(1)])
    store.set('b.py', 1, [markerOf(1)])

    expect([...store.takeDirty()].sort()).toEqual(['a.ts', 'b.py'])
    expect(store.takeDirty()).toEqual([])
  })

  it('同じ位置が何度変わっても1つにまとまる（1通ごとに描かない）', () => {
    const store = new EditorDiagnosticStore()

    store.set('a.ts', 1, [markerOf(1)])
    store.set('a.ts', 2, [markerOf(2)])
    store.set('a.ts', 3, [markerOf(3)])

    expect(store.takeDirty()).toEqual(['a.ts'])
  })

  it('捨てた（古い）指摘では描き直さない', () => {
    const store = new EditorDiagnosticStore()

    store.set('a.ts', 7, [markerOf(7)])
    store.takeDirty()
    store.set('a.ts', 6, [markerOf(6)])

    expect(store.takeDirty()).toEqual([])
  })

  it('消えた位置も含む（外すべき marker が残らないように）', () => {
    const store = new EditorDiagnosticStore()

    store.set('a.ts', 1, [markerOf(1)])
    store.takeDirty()
    store.clear('a.ts')

    expect(store.takeDirty()).toEqual(['a.ts'])
  })

  it('clearAll でも、消えた位置が全部含まれる', () => {
    const store = new EditorDiagnosticStore()

    store.set('a.ts', 1, [markerOf(1)])
    store.set('b.py', 1, [markerOf(1)])
    store.takeDirty()
    store.clearAll()

    expect([...store.takeDirty()].sort()).toEqual(['a.ts', 'b.py'])
  })
})

describe('isServedByLsp', () => {
  it('その言語の控えが1つでもあれば true（Monaco 内蔵を止めてよい）', () => {
    const store = new EditorDiagnosticStore()

    store.set('src/app.ts', 1, [])

    expect(store.isServedByLsp('typescript')).toBe(true)
    expect(store.isServedByLsp('javascript')).toBe(false)
  })

  it('`.tsx` も TypeScript として数える（Monaco の言語 id で見る）', () => {
    const store = new EditorDiagnosticStore()

    store.set('src/App.tsx', 1, [])

    expect(store.isServedByLsp('typescript')).toBe(true)
  })

  it('控えが無くなれば false（内蔵の指摘へ戻す）', () => {
    const store = new EditorDiagnosticStore()

    store.set('src/app.ts', 1, [markerOf(1)])
    store.clear('src/app.ts')

    expect(store.isServedByLsp('typescript')).toBe(false)
  })

  it('サーバが1つも答えていなければ false（LSP が入っていない PC）', () => {
    expect(new EditorDiagnosticStore().isServedByLsp('typescript')).toBe(false)
  })

  it('別の言語の控えは数に入れない', () => {
    const store = new EditorDiagnosticStore()

    store.set('main.py', 1, [markerOf(1)])

    expect(store.isServedByLsp('typescript')).toBe(false)
    expect(store.isServedByLsp('javascript')).toBe(false)
    expect(store.isServedByLsp('python')).toBe(true)
  })
})
