import { describe, expect, it } from 'vitest'
import type * as monaco from 'monaco-editor'
import {
  EditorDocumentStore,
  type EditorDocumentSource,
  type EditorDocumentSyncEvent,
  type EditorModelFactory
} from './documentStore'

/**
 * Model の生き死にと、Language Server への同期の対応（Session 5-2）。
 *
 * documentStore.test.ts が「鍵を移したときに何が保たれるか」を見ているのに対し、
 * こちらは**その1つ1つが同期の出来事としてどう出るか**を見る。
 *
 * | 観点                                     | 外すと何が起きるか                                    |
 * | ---------------------------------------- | ----------------------------------------------------- |
 * | acquire で1度だけ opened が出る          | 同じ文書を2度開く（仕様違反）／開かないまま差分を送る |
 * | 改名が closed → opened になる            | サーバは古い URI の文書を持ち続け、新しい方を知らない |
 * | 版が `getVersionId()` から来る           | Undo で戻る数を送ると、以降の差分をサーバが捨てる     |
 * | saved に版が載らない                     | 未保存かの話が LSP の版へ混ざる                       |
 * | 受け手が居なければ組み立てない           | 打鍵1回ごとに全文を連結しうる                         |
 *
 * ## Monaco を持ち込まずに試せる
 *
 * documentStore は Monaco を `import type` でしか参照しない（あちらの冒頭）。
 * ここでは版・中身・変更イベントを持つ最小の Model を渡せば足りる。
 */

interface FakeModel extends monaco.editor.ITextModel {
  /** テストから「打鍵」を起こす（このクラスの外の口ではない）。 */
  readonly type: (next: string, change: FakeChange) => void
}

interface FakeChange {
  readonly startLineNumber: number
  readonly startColumn: number
  readonly endLineNumber: number
  readonly endColumn: number
  readonly text: string
}

/**
 * 2つの版番号を**別々に**持つ Model の代わり。
 *
 * 実物と同じく、`getVersionId()` は編集のたびに増え、
 * `getAlternativeVersionId()` は Undo で戻りうる ── この違いを写しておかないと、
 * 「混ぜていない」ことを試せない。
 */
function createFakeModel(content: string): FakeModel {
  let value = content
  let versionId = 1
  let alternativeVersionId = 1
  const listeners = new Set<(event: monaco.editor.IModelContentChangedEvent) => void>()

  const model = {
    getValue: () => value,
    getVersionId: () => versionId,
    getAlternativeVersionId: () => alternativeVersionId,
    getFullModelRange: () => ({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: value.length + 1
    }),
    pushEditOperations: (
      _before: unknown,
      operations: readonly { readonly text: string | null }[]
    ) => {
      value = operations[0]?.text ?? ''
      versionId += 1
      alternativeVersionId += 1

      emit({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 1,
        text: value
      })

      return null
    },
    onDidChangeContent: (listener: (event: monaco.editor.IModelContentChangedEvent) => void) => {
      listeners.add(listener)

      return { dispose: () => listeners.delete(listener) }
    },
    dispose: () => {
      listeners.clear()
    },
    type: (next: string, change: FakeChange) => {
      value = next
      versionId += 1
      alternativeVersionId += 1

      emit(change)
    }
  }

  function emit(change: FakeChange): void {
    const event = {
      changes: [
        {
          range: {
            startLineNumber: change.startLineNumber,
            startColumn: change.startColumn,
            endLineNumber: change.endLineNumber,
            endColumn: change.endColumn
          },
          text: change.text
        }
      ],
      eol: '\n',
      versionId,
      isUndoing: false,
      isRedoing: false,
      isFlush: false,
      isEolChange: false
    } as unknown as monaco.editor.IModelContentChangedEvent

    for (const listener of listeners) {
      listener(event)
    }
  }

  return model as unknown as FakeModel
}

const factory: EditorModelFactory = (_relativePath, source) =>
  createFakeModel(source.content) as monaco.editor.ITextModel

function sourceOf(content: string): EditorDocumentSource {
  return { content, lineEnding: 'lf', encoding: 'utf8', revision: { mtimeMs: 1, size: 1 } }
}

/** 出来事を控えるストアを1つ作る。 */
function createStore(): {
  readonly store: EditorDocumentStore
  readonly events: EditorDocumentSyncEvent[]
} {
  const store = new EditorDocumentStore()
  const events: EditorDocumentSyncEvent[] = []

  store.onDocumentSync((event) => events.push(event))

  return { store, events }
}

function typeInto(model: monaco.editor.ITextModel, next: string, change: FakeChange): void {
  ;(model as FakeModel).type(next, change)
}

const TYPED: FakeChange = {
  startLineNumber: 1,
  startColumn: 1,
  endLineNumber: 1,
  endColumn: 1,
  text: 'x'
}

describe('acquire', () => {
  it('新しく作ったときに1度だけ opened が出る（版と全文を持つ）', () => {
    const { store, events } = createStore()

    store.acquire('src/app.ts', sourceOf('const a = 1'), factory)

    expect(events).toEqual([
      { kind: 'opened', relativePath: 'src/app.ts', version: 1, content: 'const a = 1' }
    ])
  })

  it('既にある Model を取り直しても、2度目の opened は出ない', () => {
    const { store, events } = createStore()

    store.acquire('src/app.ts', sourceOf('a'), factory)
    store.acquire('src/app.ts', sourceOf('a'), factory)

    expect(events.filter((event) => event.kind === 'opened')).toHaveLength(1)
  })
})

describe('changed', () => {
  it('打鍵のたびに差分が出る（版は getVersionId から来る）', () => {
    const { store, events } = createStore()
    const model = store.acquire('src/app.ts', sourceOf('a'), factory)

    typeInto(model, 'ax', { ...TYPED, startColumn: 2, endColumn: 2 })

    expect(events.at(-1)).toEqual({
      kind: 'changed',
      relativePath: 'src/app.ts',
      version: 2,
      changes: [
        {
          range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } },
          text: 'x'
        }
      ]
    })
  })

  it('鍵を移した後の打鍵は、新しい位置の差分として出る', () => {
    const { store, events } = createStore()
    const model = store.acquire('a.ts', sourceOf('a'), factory)

    store.rename('a.ts', 'b.ts')
    typeInto(model, 'ax', TYPED)

    const changed = events.filter((event) => event.kind === 'changed')

    expect(changed).toHaveLength(1)
    expect(changed[0]?.relativePath).toBe('b.ts')
  })

  it('ディスクの内容を取り込んだときも差分として出る（版は進む）', () => {
    const { store, events } = createStore()

    store.acquire('a.ts', sourceOf('old'), factory)
    store.replaceContent('a.ts', sourceOf('new'))

    const changed = events.filter((event) => event.kind === 'changed')

    expect(changed).toHaveLength(1)
    expect(changed[0]?.kind === 'changed' && changed[0].version).toBe(2)
  })
})

describe('saved', () => {
  it('保存できた時点で saved が出る。**版は載らない**', () => {
    const { store, events } = createStore()
    const model = store.acquire('a.ts', sourceOf('a'), factory)

    typeInto(model, 'ax', TYPED)
    store.markSaved('a.ts', model.getAlternativeVersionId(), { mtimeMs: 2, size: 2 })

    expect(events.at(-1)).toEqual({ kind: 'saved', relativePath: 'a.ts' })
  })

  it('未保存の判定に使う数を、差分の版として送らない', () => {
    const { store, events } = createStore()
    const model = store.acquire('a.ts', sourceOf('a'), factory)

    typeInto(model, 'ax', TYPED)
    store.markSaved('a.ts', model.getAlternativeVersionId(), { mtimeMs: 2, size: 2 })
    typeInto(model, 'axy', TYPED)

    const last = events.at(-1)

    /*
      保存を挟んでも版は戻らない（3 になる）。保存済みの版を送っていれば、
      ここは 2 のままか、それ以下になる。
    */
    expect(last?.kind === 'changed' && last.version).toBe(3)
  })
})

describe('rename / rekey', () => {
  it('別名で保存は closed → opened になる（移動を伝える通知は LSP に無い）', () => {
    const { store, events } = createStore()

    store.acquire('notes.txt', sourceOf('body'), factory)
    events.length = 0

    store.rename('notes.txt', 'renamed.txt')

    expect(events).toEqual([
      { kind: 'closed', relativePath: 'notes.txt' },
      { kind: 'opened', relativePath: 'renamed.txt', version: 1, content: 'body' }
    ])
  })

  it('開き直しに載る中身は、移した時点の（未保存を含む）中身になる', () => {
    const { store, events } = createStore()
    const model = store.acquire('notes.txt', sourceOf('original'), factory)

    typeInto(model, 'edited', TYPED)
    events.length = 0

    store.rename('notes.txt', 'renamed.txt')

    const opened = events.find((event) => event.kind === 'opened')

    expect(opened?.kind === 'opened' && opened.content).toBe('edited')
    expect(opened?.kind === 'opened' && opened.version).toBe(2)
  })

  it('アプリの外での改名も、同じ closed → opened になる', () => {
    const { store, events } = createStore()

    store.acquire('src/a.ts', sourceOf('a'), factory)
    events.length = 0

    store.applyFileChanges([
      { kind: 'renamed', fromRelativePath: 'src', toRelativePath: 'lib', entryType: 'directory' }
    ])

    expect(events).toEqual([
      { kind: 'closed', relativePath: 'src/a.ts' },
      { kind: 'opened', relativePath: 'lib/a.ts', version: 1, content: 'a' }
    ])
  })

  it('行き先が埋まっていて移せなかった場合は、何も出ない', () => {
    const { store, events } = createStore()

    store.acquire('a.ts', sourceOf('a'), factory)
    store.acquire('b.ts', sourceOf('b'), factory)
    events.length = 0

    expect(store.rename('a.ts', 'b.ts')).toBe(false)
    expect(events).toEqual([])
  })
})

describe('closed', () => {
  it('タブを閉じると closed が出る', () => {
    const { store, events } = createStore()

    store.acquire('a.ts', sourceOf('a'), factory)
    events.length = 0

    store.release('a.ts')

    expect(events).toEqual([{ kind: 'closed', relativePath: 'a.ts' }])
  })

  it('外で消されたファイル（未保存でない）も閉じたことになる', () => {
    const { store, events } = createStore()

    store.acquire('a.ts', sourceOf('a'), factory)
    events.length = 0

    store.applyFileChanges([{ kind: 'deleted', relativePath: 'a.ts', entryType: 'file' }])

    expect(events).toEqual([{ kind: 'closed', relativePath: 'a.ts' }])
  })

  it('未保存のまま消されたファイルは閉じない（中身がまだここにある）', () => {
    const { store, events } = createStore()
    const model = store.acquire('a.ts', sourceOf('a'), factory)

    typeInto(model, 'edited', TYPED)
    events.length = 0

    store.applyFileChanges([{ kind: 'deleted', relativePath: 'a.ts', entryType: 'file' }])

    expect(events.filter((event) => event.kind === 'closed')).toEqual([])
  })

  it('Workspace を切り替えると、開いていたものが全部閉じる', () => {
    const { store, events } = createStore()

    store.acquire('a.ts', sourceOf('a'), factory)
    store.acquire('b.py', sourceOf('b'), factory)
    events.length = 0

    store.disposeAll()

    expect(events).toEqual([
      { kind: 'closed', relativePath: 'a.ts' },
      { kind: 'closed', relativePath: 'b.py' }
    ])
  })
})

describe('listOpenDocuments', () => {
  it('今の版と中身を返す（開き直しの依頼に応えるため）', () => {
    const { store } = createStore()
    const model = store.acquire('a.ts', sourceOf('a'), factory)

    store.acquire('b.py', sourceOf('b'), factory)
    typeInto(model, 'ax', TYPED)

    expect(store.listOpenDocuments()).toEqual([
      { relativePath: 'a.ts', version: 2, content: 'ax' },
      { relativePath: 'b.py', version: 1, content: 'b' }
    ])
  })
})

describe('受け手が居ないとき', () => {
  it('出来事を組み立てない（打鍵ごとに全文を連結しない）', () => {
    const store = new EditorDocumentStore()
    const unsubscribe = store.onDocumentSync(() => undefined)

    unsubscribe()

    /*
      `getVersionId` を持たない Model でも通ることをもって「組み立てていない」と見る
      ── 組み立てていれば、ここで例外になる。
    */
    const model = store.acquire('a.ts', sourceOf('a'), (_path, source) => {
      const fake = createFakeModel(source.content) as unknown as Record<string, unknown>

      fake.getVersionId = () => {
        throw new Error('組み立てられているはずがない')
      }

      return fake as unknown as monaco.editor.ITextModel
    })

    expect(() => typeInto(model, 'ax', TYPED)).not.toThrow()
    expect(() => store.release('a.ts')).not.toThrow()
  })
})
