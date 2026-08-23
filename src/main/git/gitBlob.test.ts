import { describe, expect, it } from 'vitest'
import {
  isGitObjectName,
  readBlobByteLength,
  readHeadBlobEntry,
  readIndexBlobEntry
} from './gitBlob'

/**
 * `git ls-files --stage` / `git ls-tree` の読み取り（Session 3-8-9）。
 *
 * 実物の git に対する確認は gitDiffRepository.test.ts が持つ。ここで固定するのは
 * **出力の形をどう読むか**だけで、とくに次の4つになる。
 *
 *   - 衝突している位置（stage 1 / 2 / 3）から中身を選ばないこと
 *   - 位置に改行やタブが入っていても1件を取り違えないこと
 *   - 求めた位置と違う行を「その位置の中身」として返さないこと
 *   - submodule（`commit`）を blob として読まないこと
 */

/**
 * レコードの区切り（NUL）。
 *
 * テンプレート文字列の中へ直接は書けない ── 後ろに数字が続くと
 * 「8進エスケープ」として読まれ、ビルドがそこで止まる。
 */
const NUL = String.fromCharCode(0)

/** 40桁の object 名を、見分けの付く形で作る。 */
function object(seed: string): string {
  return seed.repeat(40)
}

const A = object('a')
const B = object('b')
const C = object('c')

describe('isGitObjectName', () => {
  it('40桁の16進を通す', () => {
    expect(isGitObjectName(A)).toBe(true)
  })

  it('SHA-256 のリポジトリの64桁も通す', () => {
    expect(isGitObjectName('0'.repeat(64))).toBe(true)
  })

  it('16進以外を通さない', () => {
    expect(isGitObjectName('g'.repeat(40))).toBe(false)
    expect(isGitObjectName(`${A.slice(0, 39)}-`)).toBe(false)
  })

  it('大文字を通さない（git は小文字で返す）', () => {
    expect(isGitObjectName('A'.repeat(40))).toBe(false)
  })

  it('短すぎる / 長すぎるものを通さない', () => {
    expect(isGitObjectName('abc')).toBe(false)
    expect(isGitObjectName('a'.repeat(65))).toBe(false)
  })

  it('引数として渡ると困る形を通さない', () => {
    expect(isGitObjectName('')).toBe(false)
    expect(isGitObjectName('--upload-pack=calc')).toBe(false)
    expect(isGitObjectName(`${A} ${B}`)).toBe(false)
    expect(isGitObjectName(`${A}\n`)).toBe(false)
  })
})

describe('readIndexBlobEntry', () => {
  it('stage 0 の1件を読む', () => {
    const stdout = `100644 ${A} 0\tsrc/app.ts${NUL}`

    expect(readIndexBlobEntry(stdout, 'src/app.ts')).toEqual({
      object: A,
      relativePath: 'src/app.ts'
    })
  })

  it('求めた位置と違う行は返さない', () => {
    const stdout = `100644 ${A} 0\tsrc/app.ts${NUL}`

    expect(readIndexBlobEntry(stdout, 'src/app')).toBeNull()
  })

  it('複数返っても、位置で選ぶ', () => {
    const stdout = `100644 ${A} 0\tsrc/a.ts${NUL}100644 ${B} 0\tsrc/b.ts${NUL}`

    expect(readIndexBlobEntry(stdout, 'src/b.ts')?.object).toBe(B)
  })

  it('衝突している位置（stage 1 / 2 / 3）からは選ばない', () => {
    const stdout =
      `100644 ${A} 1\tconflict.txt${NUL}` +
      `100644 ${B} 2\tconflict.txt${NUL}` +
      `100644 ${C} 3\tconflict.txt${NUL}`

    expect(readIndexBlobEntry(stdout, 'conflict.txt')).toBeNull()
  })

  it('改行を含む位置でも1件を取り違えない', () => {
    const stdout = `100644 ${A} 0\tsrc/line\nbreak.ts${NUL}100644 ${B} 0\tsrc/next.ts${NUL}`

    expect(readIndexBlobEntry(stdout, 'src/line\nbreak.ts')?.object).toBe(A)
    expect(readIndexBlobEntry(stdout, 'src/next.ts')?.object).toBe(B)
  })

  it('タブを含む位置でも、最初のタブだけで切る', () => {
    const stdout = `100644 ${A} 0\tsrc/tab\there.ts${NUL}`

    expect(readIndexBlobEntry(stdout, 'src/tab\there.ts')?.object).toBe(A)
  })

  it('symlink（120000）も blob として読む', () => {
    const stdout = `120000 ${A} 0\tlink${NUL}`

    expect(readIndexBlobEntry(stdout, 'link')?.object).toBe(A)
  })

  it('空の出力は null', () => {
    expect(readIndexBlobEntry('', 'src/app.ts')).toBeNull()
  })

  it('形の違う行は読み飛ばす', () => {
    const stdout = `warning: something${NUL}100644 ${A} 0\tsrc/app.ts${NUL}`

    expect(readIndexBlobEntry(stdout, 'src/app.ts')?.object).toBe(A)
  })
})

describe('readHeadBlobEntry', () => {
  it('blob の1件を読む', () => {
    const stdout = `100644 blob ${A}\tsrc/app.ts${NUL}`

    expect(readHeadBlobEntry(stdout, 'src/app.ts')).toEqual({
      object: A,
      relativePath: 'src/app.ts'
    })
  })

  it('submodule（commit）は読まない', () => {
    const stdout = `160000 commit ${A}\tvendor/lib${NUL}`

    expect(readHeadBlobEntry(stdout, 'vendor/lib')).toBeNull()
  })

  it('tree は読まない', () => {
    const stdout = `040000 tree ${A}\tsrc${NUL}`

    expect(readHeadBlobEntry(stdout, 'src')).toBeNull()
  })

  it('複数返っても、位置で選ぶ', () => {
    const stdout = `100644 blob ${A}\tsrc/a.ts${NUL}100644 blob ${B}\tsrc/b.ts${NUL}`

    expect(readHeadBlobEntry(stdout, 'src/a.ts')?.object).toBe(A)
  })

  it('改行を含む位置でも1件を取り違えない', () => {
    const stdout = `100644 blob ${A}\tline\nbreak.ts${NUL}100644 blob ${B}\tnext.ts${NUL}`

    expect(readHeadBlobEntry(stdout, 'line\nbreak.ts')?.object).toBe(A)
  })

  it('空の出力は null', () => {
    expect(readHeadBlobEntry('', 'src/app.ts')).toBeNull()
  })
})

describe('readBlobByteLength', () => {
  it('数を読む', () => {
    expect(readBlobByteLength('1234\n')).toBe(1234)
  })

  it('0 を読む（空のファイル）', () => {
    expect(readBlobByteLength('0\n')).toBe(0)
  })

  it('読めないものは null（0 に倒さない）', () => {
    expect(readBlobByteLength('')).toBeNull()
    expect(readBlobByteLength('abc')).toBeNull()
    expect(readBlobByteLength('-1')).toBeNull()
  })

  it('桁があふれるものは null', () => {
    expect(readBlobByteLength('9'.repeat(30))).toBeNull()
  })
})
