import { describe, expect, it } from 'vitest'
import {
  isAtOrUnder,
  joinRelativePath,
  parentRelativePath,
  rebaseRelativePath,
  splitRelativePath
} from './relativePath'

/**
 * relativePath（区切りは `/`・root は空文字）に対する判断。
 *
 * Main は「操作が起きるフォルダ」を求めるのに、Renderer は「消えたものの配下」を
 * 畳むのに使う。**両者が同じ答えを見ること**が前提なので、規則をここで固定する。
 */

describe('splitRelativePath', () => {
  it('root 直下は親が空文字になる', () => {
    expect(splitRelativePath('README.md')).toEqual({ parent: '', name: 'README.md' })
  })

  it('深い位置は最後の区切りで分かれる', () => {
    expect(splitRelativePath('src/main/index.ts')).toEqual({
      parent: 'src/main',
      name: 'index.ts'
    })
  })

  // root 自身を消す・改名する要求を、ここで成立しないものとして落とす。
  it('root（空文字）は親を持たないので null', () => {
    expect(splitRelativePath('')).toBeNull()
  })

  it('名前が空になる形は null', () => {
    expect(splitRelativePath('src/')).toBeNull()
  })
})

describe('parentRelativePath', () => {
  it('その位置を含むフォルダを返す', () => {
    expect(parentRelativePath('src/main/index.ts')).toBe('src/main')
    expect(parentRelativePath('README.md')).toBe('')
  })

  it('root には親が無い', () => {
    expect(parentRelativePath('')).toBeNull()
  })
})

describe('joinRelativePath', () => {
  it('root 直下は `/name` にしない', () => {
    expect(joinRelativePath('', 'README.md')).toBe('README.md')
  })

  it('深い位置は区切りでつなぐ', () => {
    expect(joinRelativePath('src/main', 'index.ts')).toBe('src/main/index.ts')
  })
})

describe('isAtOrUnder', () => {
  it('自分自身も配下として扱う', () => {
    expect(isAtOrUnder('src', 'src')).toBe(true)
  })

  it('配下は真', () => {
    expect(isAtOrUnder('src', 'src/main/index.ts')).toBe(true)
  })

  // 前方一致だけで比べると `src2` まで巻き込む。
  it('名前の前方一致では巻き込まない', () => {
    expect(isAtOrUnder('src', 'src2/index.ts')).toBe(false)
    expect(isAtOrUnder('src', 'srcery')).toBe(false)
  })

  it('root はすべての祖先', () => {
    expect(isAtOrUnder('', 'src/index.ts')).toBe(true)
  })

  it('関係が無ければ偽', () => {
    expect(isAtOrUnder('docs', 'src/index.ts')).toBe(false)
  })
})

describe('rebaseRelativePath', () => {
  it('改名された当人はそのまま新しい位置になる', () => {
    expect(rebaseRelativePath('src', 'src', 'source')).toBe('source')
  })

  it('配下は先頭だけが差し替わる', () => {
    expect(rebaseRelativePath('src/main/index.ts', 'src', 'source')).toBe('source/main/index.ts')
  })

  it('配下でなければ null（呼び出し側が「関係なかった」と判断できる）', () => {
    expect(rebaseRelativePath('docs/guide.md', 'src', 'source')).toBeNull()
    expect(rebaseRelativePath('src2/index.ts', 'src', 'source')).toBeNull()
  })
})
