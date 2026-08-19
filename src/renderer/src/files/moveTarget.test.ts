import { describe, expect, it } from 'vitest'
import { WORKSPACE_ROOT_RELATIVE_PATH, type FileEntry } from '@shared/files'
import { canMoveInto, findMoveRejection } from './moveTarget'

/**
 * 移動先として選べるか（メニューに「ここへ移動」を出すかの判断）。
 *
 * 正本は Main 側にあり、ここが決めるのは**出し分け**だけ。
 * それでも試験を置くのは、間違えると「できるはずの移動が選べない」
 * （項目が出ないので気づけない）という、失敗しない形の壊れ方をするため。
 */

function file(relativePath: string): FileEntry {
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)

  return { id: `f:${relativePath}`, name, relativePath, type: 'file', extension: null }
}

function directory(relativePath: string): FileEntry {
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)

  return { id: `d:${relativePath}`, name, relativePath, type: 'directory', extension: null }
}

describe('findMoveRejection', () => {
  it('別のフォルダへは動かせる', () => {
    expect(findMoveRejection(file('src/main.ts'), 'docs')).toBeNull()
    expect(findMoveRejection(directory('src/lib'), 'docs')).toBeNull()
  })

  it('Workspace root は移動先になれる', () => {
    expect(findMoveRejection(file('src/main.ts'), WORKSPACE_ROOT_RELATIVE_PATH)).toBeNull()
  })

  /* 動かしても何も変わらない。IPC を往復させる意味が無い。 */
  it('今いるフォルダは移動先にならない', () => {
    expect(findMoveRejection(file('src/main.ts'), 'src')).toBe('same-parent')
    expect(findMoveRejection(file('main.ts'), WORKSPACE_ROOT_RELATIVE_PATH)).toBe('same-parent')
  })

  it('自分自身とその中は移動先にならない', () => {
    expect(findMoveRejection(directory('src'), 'src')).toBe('into-self')
    expect(findMoveRejection(directory('src'), 'src/lib')).toBe('into-self')
    expect(findMoveRejection(directory('src'), 'src/lib/deep')).toBe('into-self')
  })

  /*
    前方一致は区切り文字まで含めて見る（shared/files/relativePath.ts の isAtOrUnder）。
    `src` と `src2` は文字列としては前方一致でも別のフォルダで、
    ここを取り違えると隣のフォルダへ動かせなくなる。
  */
  it('名前が前方一致するだけの別フォルダは移動先になる', () => {
    expect(findMoveRejection(directory('src'), 'src2')).toBeNull()
  })

  /*
    root（空文字）を動かすことはできない（Files の操作範囲の外）ため、
    source が root になる組み合わせは呼び出し側で起こらない。
    それでも空文字が「すべての祖先」にあたることの影響は固定しておく。
  */
  it('root 自身は自分の中へ動かせない扱いになる', () => {
    expect(findMoveRejection(directory(WORKSPACE_ROOT_RELATIVE_PATH), 'src')).toBe('into-self')
  })
})

describe('canMoveInto', () => {
  it('理由が無いときだけ true', () => {
    expect(canMoveInto(file('src/main.ts'), 'docs')).toBe(true)
    expect(canMoveInto(file('src/main.ts'), 'src')).toBe(false)
    expect(canMoveInto(directory('src'), 'src/lib')).toBe(false)
  })
})
