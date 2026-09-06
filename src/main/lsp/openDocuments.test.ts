import { describe, expect, it } from 'vitest'
import { OpenDocumentRegistry, type OpenLspDocumentInput } from './openDocuments'

/**
 * 「開いている」と「伝え終えた」がずれている間の振る舞い（Session 5-2）。
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
 */

function documentOf(relativePath: string, serverId: 'typescript' | 'python'): OpenLspDocumentInput {
  return {
    relativePath,
    serverId,
    languageId: serverId === 'typescript' ? 'typescript' : 'python',
    uri: `file:///D%3A/proj/${relativePath}`
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
