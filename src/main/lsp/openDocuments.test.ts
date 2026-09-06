import { describe, expect, it } from 'vitest'
import { OpenDocumentRegistry, type OpenLspDocumentInput } from './openDocuments'

/**
 * 「開いている」と「伝え終えた」がずれている間の振る舞い（Session 5-2 / 5-3）。
 *
 * この2つがずれる時間は必ずある ── サーバの初期化中と、落ちて立ち直るまで。
 * その間に何をするかが文書同期の要点になるため、控えの側だけを取り出して試す
 * （restartPolicy.ts と同じ分け方）。
 *
 * | 観点                                   | 外すと何が起きるか                                  |
 * | -------------------------------------- | --------------------------------------------------- |
 * | 2度目の登録で synced が戻らない        | 届いている文書へ2通目の didOpen を送る（仕様違反）  |
 * | サーバが止まると synced が戻る         | 立ち直った後、サーバが知らない文書へ差分を送り続ける |
 * | 止まっても控えそのものは消えない       | Editor では開いたままなのに、開き直しの対象から漏れる |
 * | 版が進む（5-3）                        | 届いた診断がすべて「古い」と判断され、1件も出ない   |
 */

function documentOf(
  relativePath: string,
  serverId: 'typescript' | 'python',
  version = 1
): OpenLspDocumentInput {
  return {
    relativePath,
    serverId,
    languageId: serverId === 'typescript' ? 'typescript' : 'python',
    uri: `file:///D%3A/proj/${relativePath}`,
    version
  }
}

describe('register', () => {
  it('最初は「まだ伝えていない」から始まる', () => {
    const registry = new OpenDocumentRegistry()

    expect(registry.register(documentOf('a.ts', 'typescript')).synced).toBe(false)
    expect(registry.hasUnsynced('typescript')).toBe(true)
  })

  it('伝え終えた後の2度目の登録で、状態を戻さない（開き直しの余分な返事）', () => {
    const registry = new OpenDocumentRegistry()

    registry.register(documentOf('a.ts', 'typescript'))
    registry.markSynced('a.ts')

    expect(registry.register(documentOf('a.ts', 'typescript')).synced).toBe(true)
    expect(registry.hasUnsynced('typescript')).toBe(false)
  })

  it('行き先が変わった場合は、伝えていない状態から始め直す', () => {
    const registry = new OpenDocumentRegistry()

    registry.register(documentOf('a.ts', 'typescript'))
    registry.markSynced('a.ts')

    const moved = registry.register(documentOf('a.ts', 'python'))

    expect(moved.serverId).toBe('python')
    expect(moved.synced).toBe(false)
  })
})

describe('version（Session 5-3）', () => {
  it('登録した版が控えられる（診断の古さを判断する基準になる）', () => {
    const registry = new OpenDocumentRegistry()

    expect(registry.register(documentOf('a.ts', 'typescript', 3)).version).toBe(3)
  })

  it('2度目の登録では synced を戻さず、版だけを進める', () => {
    const registry = new OpenDocumentRegistry()

    registry.register(documentOf('a.ts', 'typescript', 1))
    registry.markSynced('a.ts')

    const reopened = registry.register(documentOf('a.ts', 'typescript', 9))

    expect(reopened.version).toBe(9)
    expect(reopened.synced).toBe(true)
  })

  it('差分を送れたぶんだけ版が進む', () => {
    const registry = new OpenDocumentRegistry()

    registry.register(documentOf('a.ts', 'typescript', 1))
    registry.setVersion('a.ts', 4)

    expect(registry.get('a.ts')?.version).toBe(4)
  })

  it('知らない位置の版は進めない（控えを作らない）', () => {
    const registry = new OpenDocumentRegistry()

    registry.setVersion('gone.ts', 2)

    expect(registry.get('gone.ts')).toBeNull()
  })

  it('サーバが止まっても版は残る（開き直しで上書きされるまで）', () => {
    const registry = new OpenDocumentRegistry()

    registry.register(documentOf('a.ts', 'typescript', 5))
    registry.markSynced('a.ts')
    registry.markServerStopped('typescript')

    expect(registry.get('a.ts')?.version).toBe(5)
  })
})

describe('listPaths（Session 5-3）', () => {
  it('そのサーバが担当している位置だけを返す', () => {
    const registry = new OpenDocumentRegistry()

    registry.register(documentOf('a.ts', 'typescript'))
    registry.register(documentOf('b.py', 'python'))
    registry.register(documentOf('c.ts', 'typescript'))

    expect(registry.listPaths('typescript')).toEqual(['a.ts', 'c.ts'])
    expect(registry.listPaths('python')).toEqual(['b.py'])
  })

  it('伝え終えていない文書も含む（Editor では開いており、marker が残りうる）', () => {
    const registry = new OpenDocumentRegistry()

    registry.register(documentOf('a.ts', 'typescript'))

    expect(registry.listPaths('typescript')).toEqual(['a.ts'])
  })

  it('担当が1つも無ければ空', () => {
    expect(new OpenDocumentRegistry().listPaths('csharp')).toEqual([])
  })
})

describe('markServerStopped', () => {
  it('そのサーバの文書だけを「まだ伝えていない」へ戻す', () => {
    const registry = new OpenDocumentRegistry()

    registry.register(documentOf('a.ts', 'typescript'))
    registry.register(documentOf('b.py', 'python'))
    registry.markSynced('a.ts')
    registry.markSynced('b.py')

    registry.markServerStopped('typescript')

    expect(registry.get('a.ts')?.synced).toBe(false)
    expect(registry.get('b.py')?.synced).toBe(true)
    expect(registry.hasUnsynced('typescript')).toBe(true)
    expect(registry.hasUnsynced('python')).toBe(false)
  })

  it('控えそのものは消さない（Editor ではまだ開いている）', () => {
    const registry = new OpenDocumentRegistry()

    registry.register(documentOf('a.ts', 'typescript'))
    registry.markSynced('a.ts')
    registry.markServerStopped('typescript')

    expect(registry.list()).toHaveLength(1)
  })
})

describe('remove / clear', () => {
  it('閉じたものを返す（伝え終えていたかが、didClose を送るかの判断になる）', () => {
    const registry = new OpenDocumentRegistry()

    registry.register(documentOf('a.ts', 'typescript'))
    registry.markSynced('a.ts')

    expect(registry.remove('a.ts')?.synced).toBe(true)
    expect(registry.get('a.ts')).toBeNull()
  })

  it('知らない位置を外しても失敗にしない', () => {
    expect(new OpenDocumentRegistry().remove('gone.ts')).toBeNull()
  })

  it('すべて外す（Workspace の切り替え）', () => {
    const registry = new OpenDocumentRegistry()

    registry.register(documentOf('a.ts', 'typescript'))
    registry.register(documentOf('b.py', 'python'))

    expect(registry.clear()).toHaveLength(2)
    expect(registry.list()).toHaveLength(0)
  })
})
