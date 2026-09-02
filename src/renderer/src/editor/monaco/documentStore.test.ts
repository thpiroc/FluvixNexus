import { describe, expect, it } from 'vitest'
import type * as monaco from 'monaco-editor'
import {
  EditorDocumentStore,
  type EditorDocumentSource,
  type EditorModelFactory
} from './documentStore'

/**
 * 中身を持つ層の検証 ── 別名で保存で鍵を付け替えたときに何が保たれるか（Session 4-2）。
 *
 * ## Monaco を持ち込まずに試せる
 *
 * このクラスは Monaco を `import type` でしか参照せず、Model の作り方は
 * `EditorModelFactory` として**渡される**（documentStore.ts の冒頭）。
 * その分担のおかげで、ここでは中身と版番号だけを持つ最小の Model を渡せば足りる
 * ── node 環境（vitest.config.ts）のまま、判断のある部分だけを相手にできる。
 *
 * ## ここで確かめること
 *
 * | 観点                       | なぜ                                                     |
 * | -------------------------- | -------------------------------------------------------- |
 * | 鍵が移り、Model は同じもの | 作り直すと Undo 履歴が消える（＝保存した瞬間に取り消せない） |
 * | 中身が保たれる             | 救い出した内容が、移した拍子に失われないこと             |
 * | 行き先が埋まっていたら断る | 1つの位置に2つの Model を対応させない                    |
 * | 移した後に未保存が解ける   | 救済が「済んだ」と言えるのはここが解けたときだけ         |
 */

/** 中身と版番号だけを持つ Model の代わり（このクラスが実際に使う口だけを持つ）。 */
function createFakeModel(content: string): monaco.editor.ITextModel {
  let value = content
  let versionId = 1
  const listeners = new Set<() => void>()

  const model = {
    getValue: () => value,
    getAlternativeVersionId: () => versionId,
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

      for (const listener of listeners) {
        listener()
      }

      return null
    },
    onDidChangeContent: (listener: () => void) => {
      listeners.add(listener)

      return { dispose: () => listeners.delete(listener) }
    },
    dispose: () => {
      listeners.clear()
    },
    /** テストから「打鍵」を起こす（このクラスの外の口ではない）。 */
    type: (next: string) => {
      value = next
      versionId += 1

      for (const listener of listeners) {
        listener()
      }
    }
  }

  return model as unknown as monaco.editor.ITextModel
}

const factory: EditorModelFactory = (_relativePath, source) => createFakeModel(source.content)

function sourceOf(content: string): EditorDocumentSource {
  return { content, lineEnding: 'lf', encoding: 'utf8', revision: { mtimeMs: 1, size: 1 } }
}

/** 打鍵を起こす（未保存の状態を作る）。 */
function typeInto(model: monaco.editor.ITextModel, next: string): void {
  ;(model as unknown as { type: (value: string) => void }).type(next)
}

function createStore(): EditorDocumentStore {
  return new EditorDocumentStore()
}

describe('rename', () => {
  it('鍵を移し、Model はそのまま使い続ける（中身と版が保たれる）', () => {
    const store = createStore()
    const model = store.acquire('notes.txt', sourceOf('original'), factory)

    typeInto(model, 'rescued content')

    expect(store.isDirty('notes.txt')).toBe(true)
    expect(store.rename('notes.txt', 'rescued.txt')).toBe(true)

    // 同じ Model が、新しい位置から取れる。
    expect(store.getModel('rescued.txt')).toBe(model)
    expect(store.getModel('notes.txt')).toBeNull()
    expect(store.getModel('rescued.txt')?.getValue()).toBe('rescued content')
  })

  it('移した後に未保存の印が解ける（＝救い出せた、と言える状態）', () => {
    const store = createStore()
    const model = store.acquire('notes.txt', sourceOf('original'), factory)

    typeInto(model, 'edited')
    store.markMissing('notes.txt')

    expect(store.getState('notes.txt')).toBe('deleted')

    store.rename('notes.txt', 'rescued.txt')

    // 移しただけでは解けない（書けたかどうかは、この層は知らない）。
    expect(store.getState('rescued.txt')).toBe('deleted')

    const snapshot = store.readForSave('rescued.txt')

    if (snapshot === null) {
      throw new Error('unexpected')
    }

    store.markSaved('rescued.txt', snapshot.versionId, { mtimeMs: 2, size: 6 })

    // 未保存も「消えていた」も、書けた時点で両方解ける。
    expect(store.getState('rescued.txt')).toBe('clean')
    expect(store.isDirty('rescued.txt')).toBe(false)
    // 中身はそのまま。
    expect(store.getModel('rescued.txt')?.getValue()).toBe('edited')
  })

  it('移した後の打鍵も、新しい位置の未保存として数える', () => {
    const store = createStore()
    const model = store.acquire('notes.txt', sourceOf('a'), factory)

    store.rename('notes.txt', 'rescued.txt')
    typeInto(model, 'b')

    expect(store.isDirty('rescued.txt')).toBe(true)
    expect(store.listDirtyPaths()).toEqual(['rescued.txt'])
  })

  /*
    ここが Session 4-2 で見つかった不具合そのもの（別名で保存より前からあった。
    アプリの外での改名でも同じことが起きていた）。

    中身の変化の購読が `acquire` の引数を閉じ込めていたため、位置を付け替えた後も
    **古い位置**を知らせ続けていた。知らせる相手（タブ）の鍵も位置なので、
    そこにはもうタブが居らず通知は捨てられる ── 打っても未保存の印が出ないタブが
    できていた。印が出ないだけで中身は未保存のままなので、閉じる前の確認にも並ばず、
    そのまま閉じれば黙って失われる。

    `isDirty` を見るだけでは掴めない（そちらは Map を直に引くため動いていた）。
    **通知の側**を見るのがこのテストの要点。
  */
  it('移した後の打鍵を、新しい位置として知らせる（古い位置へ知らせない）', () => {
    const store = createStore()
    const model = store.acquire('notes.txt', sourceOf('a'), factory)

    const seen: string[] = []
    store.onStateChange((relativePath, state) => seen.push(`${relativePath}:${state}`))

    store.rename('notes.txt', 'rescued.txt')
    typeInto(model, 'edited')

    expect(seen).toEqual(['rescued.txt:dirty'])
  })

  it('アプリの外での改名の後も、打鍵を新しい位置として知らせる', () => {
    const store = createStore()
    const model = store.acquire('src/a.ts', sourceOf('a'), factory)

    const seen: string[] = []
    store.onStateChange((relativePath, state) => seen.push(`${relativePath}:${state}`))

    store.applyFileChanges([
      { kind: 'renamed', fromRelativePath: 'src', toRelativePath: 'lib', entryType: 'directory' }
    ])

    typeInto(model, 'edited')

    expect(seen).toEqual(['lib/a.ts:dirty'])
  })

  it('2回続けて移しても、最後の位置として知らせる', () => {
    const store = createStore()
    const model = store.acquire('a.txt', sourceOf('a'), factory)

    store.rename('a.txt', 'b.txt')
    store.rename('b.txt', 'c.txt')

    const seen: string[] = []
    store.onStateChange((relativePath, state) => seen.push(`${relativePath}:${state}`))

    typeInto(model, 'edited')

    expect(seen).toEqual(['c.txt:dirty'])
  })

  it('行き先が埋まっていれば移さない（1つの位置に2つの Model を作らない）', () => {
    const store = createStore()
    const source = store.acquire('a.txt', sourceOf('source'), factory)
    const occupant = store.acquire('b.txt', sourceOf('occupant'), factory)

    typeInto(occupant, 'occupant edited')

    expect(store.rename('a.txt', 'b.txt')).toBe(false)

    // どちらも無傷。相手の未保存の変更を捨てない。
    expect(store.getModel('a.txt')).toBe(source)
    expect(store.getModel('b.txt')).toBe(occupant)
    expect(store.getModel('b.txt')?.getValue()).toBe('occupant edited')
    expect(store.isDirty('b.txt')).toBe(true)
  })

  it('同じ位置への rename は何もせず成功として返る', () => {
    const store = createStore()
    const model = store.acquire('a.txt', sourceOf('x'), factory)

    expect(store.rename('a.txt', 'a.txt')).toBe(true)
    expect(store.getModel('a.txt')).toBe(model)
  })

  it('開いていない位置は移せない', () => {
    const store = createStore()

    expect(store.rename('missing.txt', 'other.txt')).toBe(false)
    expect(store.getModel('other.txt')).toBeNull()
  })

  it('状態を知らせない（2つの層の位置がずれている間は黙る）', () => {
    const store = createStore()
    const model = store.acquire('a.txt', sourceOf('x'), factory)
    typeInto(model, 'y')

    const seen: string[] = []
    store.onStateChange((relativePath, state) => seen.push(`${relativePath}:${state}`))

    store.rename('a.txt', 'b.txt')

    // 移す最中は誰にも知らせない（揃えるのは useEditorSession の仕事）。
    expect(seen).toEqual([])

    // 揃った後の通知はふつうに届く。
    const snapshot = store.readForSave('b.txt')

    if (snapshot === null) {
      throw new Error('unexpected')
    }

    store.markSaved('b.txt', snapshot.versionId, { mtimeMs: 2, size: 1 })

    expect(seen).toEqual(['b.txt:clean'])
  })

  it('移した後に閉じれば、新しい位置の Model が捨てられる', () => {
    const store = createStore()
    store.acquire('a.txt', sourceOf('x'), factory)
    store.rename('a.txt', 'b.txt')

    store.release('b.txt')

    expect(store.getModel('b.txt')).toBeNull()
    expect(store.listDirtyPaths()).toEqual([])
  })
})

describe('readForSave', () => {
  it('移した後も、書き出す一式が同じ形で取れる（BOM と版を持ち回る）', () => {
    const store = createStore()
    const model = store.acquire(
      'a.txt',
      { content: 'x', lineEnding: 'crlf', encoding: 'utf8-bom', revision: { mtimeMs: 9, size: 1 } },
      factory
    )

    typeInto(model, 'edited')
    store.rename('a.txt', 'b.txt')

    const snapshot = store.readForSave('b.txt')

    expect(snapshot?.content).toBe('edited')
    // 開いたときの文字コードは、位置が変わっても持ち回る（BOM が消えない）。
    expect(snapshot?.encoding).toBe('utf8-bom')
    expect(snapshot?.baseRevision).toEqual({ mtimeMs: 9, size: 1 })
  })
})
