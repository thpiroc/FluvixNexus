import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  MAX_PROBED_ENTRIES,
  probeDeleteObstacle,
  type DeleteProbe,
  type ProbeChild,
  type ProbeEntryType
} from './deleteObstacle'

/**
 * ごみ箱へ送れなかった理由の判定。
 *
 * ## ここは作り物のファイルシステムで確かめる
 *
 * mutateWorkspaceEntry.test.ts が実物のディスクを触るのと逆の方針を取っている。
 * 確かめたいのが**「どの errno を、どういう順で、どこまで探して、何と読むか」**という
 * 判断そのもので、実物を相手にすると肝心の状態が作れないため
 * ── `EBUSY`（他プロセスが排他で開いている）は Node からは再現できず、
 * 権限の剥奪も OS ごとに手順が違う。
 *
 * 実物とのつながり（本当に `EPERM` が返ってくるか）は
 * mutateWorkspaceEntry.test.ts が受け持つ。
 */

/** errno を持つ、fs が投げるものと同じ形の例外。 */
function errnoError(code: string): NodeJS.ErrnoException {
  const error = new Error(`${code}: simulated`) as NodeJS.ErrnoException

  error.code = code

  return error
}

interface FakeNode {
  readonly type: ProbeEntryType
  /** そこを見ようとしたときに投げる errno（null なら成功）。 */
  readonly errno?: string
  readonly children?: readonly string[]
}

/** 相対位置 → その位置にあるもの、という形で作った偽のファイルシステム。 */
function fakeProbe(
  root: string,
  tree: Readonly<Record<string, FakeNode>>
): DeleteProbe & { readonly opened: string[] } {
  const opened: string[] = []

  const nodeAt = (path: string): FakeNode => {
    const relative = path === root ? '' : path.slice(root.length + 1).replaceAll('\\', '/')
    const node = tree[relative]

    if (node === undefined) {
      throw errnoError('ENOENT')
    }

    return node
  }

  return {
    opened,

    statLink: async (path) => {
      const node = nodeAt(path)

      if (node.errno !== undefined && node.type !== 'file' && node.type !== 'directory') {
        throw errnoError(node.errno)
      }

      // stat は通るが open / readdir で弾かれる、という形を作りたいので
      // ここでは errno を出さない（対象そのものが見られない場合は下の test で直接投げる）。
      return node.type
    },

    listChildren: async (path): Promise<readonly ProbeChild[]> => {
      const node = nodeAt(path)

      if (node.errno !== undefined) {
        throw errnoError(node.errno)
      }

      return (node.children ?? []).map((name) => ({
        name,
        type: nodeAt(join(path, name)).type
      }))
    },

    openForWrite: async (path) => {
      opened.push(path)

      const node = nodeAt(path)

      if (node.errno !== undefined) {
        throw errnoError(node.errno)
      }
    }
  }
}

const ROOT = join('C:', 'ws', 'target')

describe('probeDeleteObstacle', () => {
  /* ------------------------------------------------------------ 対象自身 */

  it('対象が既に無ければ not-found', async () => {
    const probe = fakeProbe(ROOT, {})

    expect(await probeDeleteObstacle(ROOT, probe)).toEqual({ kind: 'not-found', at: '' })
  })

  it.each([
    ['EBUSY', 'busy'],
    ['ETXTBSY', 'busy'],
    ['EPERM', 'permission-denied'],
    ['EACCES', 'permission-denied']
  ])('対象のファイルが %s なら %s', async (errno, kind) => {
    const probe = fakeProbe(ROOT, { '': { type: 'file', errno } })

    expect(await probeDeleteObstacle(ROOT, probe)).toEqual({ kind, at: '' })
  })

  it('読めるファイルなら理由は分からない（unknown）', async () => {
    const probe = fakeProbe(ROOT, { '': { type: 'file' } })

    expect(await probeDeleteObstacle(ROOT, probe)).toEqual({ kind: 'unknown', at: null })
  })

  it('心当たりの無い errno は unknown（知った風に言わない）', async () => {
    const probe = fakeProbe(ROOT, { '': { type: 'file', errno: 'EIO' } })

    expect(await probeDeleteObstacle(ROOT, probe)).toEqual({ kind: 'unknown', at: null })
  })

  /* ------------------------------------------------------ フォルダの中 */

  it('フォルダを止めているのが中のファイルなら、その位置まで返す', async () => {
    const probe = fakeProbe(ROOT, {
      '': { type: 'directory', children: ['src'] },
      src: { type: 'directory', children: ['app.dll'] },
      'src/app.dll': { type: 'file', errno: 'EBUSY' }
    })

    expect(await probeDeleteObstacle(ROOT, probe)).toEqual({
      kind: 'busy',
      at: 'src/app.dll'
    })
  })

  it('フォルダ自身が開けなければ、その理由を返す', async () => {
    const probe = fakeProbe(ROOT, { '': { type: 'directory', errno: 'EACCES' } })

    expect(await probeDeleteObstacle(ROOT, probe)).toEqual({
      kind: 'permission-denied',
      at: ''
    })
  })

  it('中のものが消えていることは、消せない理由にしない', async () => {
    const probe = fakeProbe(ROOT, {
      '': { type: 'directory', children: ['gone.txt'] },
      'gone.txt': { type: 'file', errno: 'ENOENT' }
    })

    expect(await probeDeleteObstacle(ROOT, probe)).toEqual({ kind: 'unknown', at: null })
  })

  /*
    読み取り専用属性のファイルは open('r+') が EPERM を返すが、ごみ箱へは入る
    （deleteObstacle.ts の冒頭。実機で確認済み）。先に見つけた EPERM で打ち切ると、
    本当の原因である「使用中」が読み取り専用のファイル1つで隠れてしまう。
  */
  it('EPERM より EBUSY を優先する（先に EPERM を見つけていても探し続ける）', async () => {
    const probe = fakeProbe(ROOT, {
      '': { type: 'directory', children: ['readonly.md', 'held.log'] },
      'readonly.md': { type: 'file', errno: 'EPERM' },
      'held.log': { type: 'file', errno: 'EBUSY' }
    })

    expect(await probeDeleteObstacle(ROOT, probe)).toEqual({ kind: 'busy', at: 'held.log' })
  })

  it('EBUSY がどこにも無ければ、最初に見つけた EPERM を答えにする', async () => {
    const probe = fakeProbe(ROOT, {
      '': { type: 'directory', children: ['a.md', 'b.md'] },
      'a.md': { type: 'file', errno: 'EPERM' },
      'b.md': { type: 'file', errno: 'EACCES' }
    })

    expect(await probeDeleteObstacle(ROOT, probe)).toEqual({
      kind: 'permission-denied',
      at: 'a.md'
    })
  })

  /* -------------------------------------------------------------- リンク */

  /*
    リンクを open すると指し先を触ることになる。Workspace の中のジャンクション1つで
    外を歩けてしまうため、種別を見るだけで素通りする
    （mutateWorkspaceEntry.ts の「消すのはリンクそのもの」と同じ理由）。
  */
  it('リンクは開かない', async () => {
    const probe = fakeProbe(ROOT, {
      '': { type: 'directory', children: ['outside', 'note.md'] },
      outside: { type: 'link', errno: 'EBUSY' },
      'note.md': { type: 'file' }
    })

    expect(await probeDeleteObstacle(ROOT, probe)).toEqual({ kind: 'unknown', at: null })
    expect(probe.opened).toEqual([join(ROOT, 'note.md')])
  })

  it('対象そのものがリンクなら、開かずに unknown', async () => {
    const probe = fakeProbe(ROOT, { '': { type: 'link' } })

    expect(await probeDeleteObstacle(ROOT, probe)).toEqual({ kind: 'unknown', at: null })
    expect(probe.opened).toEqual([])
  })

  /* ---------------------------------------------------------------- 上限 */

  it('大きなフォルダでも、見る数に上限がある', async () => {
    const names = Array.from({ length: 5000 }, (_, index) => `file-${index}.txt`)
    const tree: Record<string, FakeNode> = {
      '': { type: 'directory', children: names }
    }

    for (const name of names) {
      tree[name] = { type: 'file' }
    }

    const probe = fakeProbe(ROOT, tree)

    expect(await probeDeleteObstacle(ROOT, probe)).toEqual({ kind: 'unknown', at: null })
    // 対象自身の1件ぶんを除いて、上限まで。
    expect(probe.opened.length).toBeLessThan(MAX_PROBED_ENTRIES)
  })

  it('深さにも上限がある（際限なく潜らない）', async () => {
    const tree: Record<string, FakeNode> = {}
    let path = ''

    // 上限より深いところに EBUSY を置く。届かないので unknown になる。
    for (let depth = 0; depth < 20; depth += 1) {
      const child = 'nested'
      tree[path] = { type: 'directory', children: [child] }
      path = path === '' ? child : `${path}/${child}`
    }

    tree[path] = { type: 'file', errno: 'EBUSY' }

    const probe = fakeProbe(ROOT, tree)

    expect(await probeDeleteObstacle(ROOT, probe)).toEqual({ kind: 'unknown', at: null })
  })
})
