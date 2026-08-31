import { describe, expect, it } from 'vitest'
import {
  isGitObjectName,
  readBlobByteLength,
  readConflictStages,
  readHeadBlobEntry,
  readIndexBlobEntry,
  toGitConflictShape,
  type GitConflictStages
} from './gitBlob'

/**
 * `git ls-files --stage` / `git ls-tree` の読み取り（Session 3-8-9 / 3-8-21）。
 *
 * 実物の git に対する確認は gitDiffRepository.test.ts（3-8-9）と
 * gitConflictDiffRepository.test.ts（3-8-21）が持つ。ここで固定するのは
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

/**
 * 競合している位置の段（Session 3-8-21）。
 *
 * 3-8-9 の `readIndexBlobEntry` が**捨てている** stage 1 / 2 / 3 を、こちらが
 * 拾う。実物の git に対する確認は gitConflictDiffRepository.test.ts が持ち、
 * ここで固定するのは**出力の形をどう読むか**だけになる。とくに次の5つ。
 *
 *   - 段の番号が名前（base / ours / theirs）に変わること
 *   - 求めた位置と違う行を、その位置の段として返さないこと
 *   - submodule（mode 160000）を blob として読まないこと
 *   - 段の在り方から競合の形が一意に決まること（`XY` を読み直さない）
 *   - 段が1つも無ければ**形を推測しない**こと（null）
 */
describe('readConflictStages', () => {
  it('3段すべてを、番号ではなく名前で返す', () => {
    const stdout =
      `100644 ${A} 1\tconflict.txt${NUL}` +
      `100644 ${B} 2\tconflict.txt${NUL}` +
      `100644 ${C} 3\tconflict.txt${NUL}`

    expect(readConflictStages(stdout, 'conflict.txt')).toEqual({
      base: { object: A, submodule: false },
      ours: { object: B, submodule: false },
      theirs: { object: C, submodule: false }
    })
  })

  it('返らなかった段は null（片方が削除された競合）', () => {
    const stdout = `100644 ${A} 1\tgone.txt${NUL}100644 ${B} 2\tgone.txt${NUL}`
    const stages = readConflictStages(stdout, 'gone.txt')

    expect(stages.ours?.object).toBe(B)
    expect(stages.theirs).toBeNull()
  })

  it('stage 0（競合していない位置）は拾わない', () => {
    const stdout = `100644 ${A} 0\tsrc/app.ts${NUL}`

    expect(readConflictStages(stdout, 'src/app.ts')).toEqual({
      base: null,
      ours: null,
      theirs: null
    })
  })

  it('求めた位置と違う行は、その位置の段にしない', () => {
    const stdout = `100644 ${A} 2\tother.txt${NUL}100644 ${B} 2\twanted.txt${NUL}`

    expect(readConflictStages(stdout, 'wanted.txt').ours?.object).toBe(B)
    expect(readConflictStages(stdout, 'wanted').ours).toBeNull()
  })

  it('改行を含む位置でも1件を取り違えない', () => {
    const stdout = `100644 ${A} 2\tline\nbreak.txt${NUL}100644 ${B} 2\tnext.txt${NUL}`

    expect(readConflictStages(stdout, 'line\nbreak.txt').ours?.object).toBe(A)
    expect(readConflictStages(stdout, 'next.txt').ours?.object).toBe(B)
  })

  it('submodule（160000）の段は、そうと分かる形で返す', () => {
    const stdout = `160000 ${A} 2\tvendor/lib${NUL}160000 ${B} 3\tvendor/lib${NUL}`
    const stages = readConflictStages(stdout, 'vendor/lib')

    expect(stages.ours?.submodule).toBe(true)
    expect(stages.theirs?.submodule).toBe(true)
  })

  it('symlink（120000）は submodule ではない', () => {
    const stdout = `120000 ${A} 2\tlink${NUL}`

    expect(readConflictStages(stdout, 'link').ours?.submodule).toBe(false)
  })

  it('形の違う行は読み飛ばす', () => {
    const stdout = `warning: something${NUL}100644 ${A} 2\tsrc/app.ts${NUL}`

    expect(readConflictStages(stdout, 'src/app.ts').ours?.object).toBe(A)
  })

  it('空の出力ではすべて null', () => {
    expect(readConflictStages('', 'src/app.ts')).toEqual({ base: null, ours: null, theirs: null })
  })
})

describe('toGitConflictShape', () => {
  /** 段の在り方を、テストから読める形で組み立てる。 */
  function stages(present: {
    base?: boolean
    ours?: boolean
    theirs?: boolean
  }): GitConflictStages {
    const entry = { object: A, submodule: false }

    return {
      base: present.base === true ? entry : null,
      ours: present.ours === true ? entry : null,
      theirs: present.theirs === true ? entry : null
    }
  }

  it('1・2・3 が揃えば「両方で変更」（UU）', () => {
    expect(toGitConflictShape(stages({ base: true, ours: true, theirs: true }))).toBe(
      'both-modified'
    )
  })

  it('2・3 だけなら「両方で追加」（AA）── 共通の元が無い', () => {
    expect(toGitConflictShape(stages({ ours: true, theirs: true }))).toBe('both-added')
  })

  it('1・2 なら「theirs で削除」（UD）', () => {
    expect(toGitConflictShape(stages({ base: true, ours: true }))).toBe('deleted-by-them')
  })

  it('1・3 なら「ours で削除」（DU）', () => {
    expect(toGitConflictShape(stages({ base: true, theirs: true }))).toBe('deleted-by-us')
  })

  it('1 だけなら「両方で削除」（DD）', () => {
    expect(toGitConflictShape(stages({ base: true }))).toBe('both-deleted')
  })

  it('2 だけなら「ours だけが追加」（AU）', () => {
    expect(toGitConflictShape(stages({ ours: true }))).toBe('added-by-us')
  })

  it('3 だけなら「theirs だけが追加」（UA）', () => {
    expect(toGitConflictShape(stages({ theirs: true }))).toBe('added-by-them')
  })

  it('段が1つも無ければ null（形を推測しない）', () => {
    expect(toGitConflictShape(stages({}))).toBeNull()
  })
})
