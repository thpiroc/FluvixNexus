import { describe, expect, it } from 'vitest'
import {
  FILE_NAME_MAX_LENGTH,
  findExistingNameProblem,
  findFileNameProblem,
  normalizeFileName
} from './fileName'

/**
 * ファイル / フォルダ名として受け付ける形。
 *
 * この規則は Main（fs へ渡す前の検査）と Renderer（入力中の表示）の両方が使う。
 * **どちらか一方だけを直すとずれる**性質のものなので、規則そのものをここで固定する。
 *
 * 通す側より弾く側を厚く確かめる。名前の検査は「区切り文字を含む名前を通さない」ことで
 * 作成先が1階層に閉じることの担保にもなっており（mutateWorkspaceEntry.ts）、
 * ここが緩むと境界の検証の前提が崩れる。
 */

describe('findFileNameProblem（受け付ける名前）', () => {
  it.each([
    'index.ts',
    'README.md',
    '.gitignore',
    'my file.txt',
    'テスト.txt',
    'a',
    'con-fig.json', // 予約名は完全一致のときだけ
    'console.log.txt',
    'components',
    'file-name_v2.spec.tsx'
  ])('%s', (name) => {
    expect(findFileNameProblem(name)).toBeNull()
  })

  it('255 文字ちょうどは通す', () => {
    expect(findFileNameProblem('a'.repeat(FILE_NAME_MAX_LENGTH))).toBeNull()
  })
})

describe('findFileNameProblem（受け付けない名前）', () => {
  it('空文字', () => {
    expect(findFileNameProblem('')).toBe('empty')
  })

  it('長すぎる', () => {
    expect(findFileNameProblem('a'.repeat(FILE_NAME_MAX_LENGTH + 1))).toBe('too-long')
  })

  /*
    区切り文字を弾くことが「名前は必ず1階層ぶん」の担保になっている。
    ここが通ると、作成先が parentRelativePath だけでは決まらなくなる。
  */
  it.each(['src/index.ts', 'src\\index.ts', '../outside.txt', '..\\outside.txt', '/etc/passwd'])(
    '区切り文字を含む: %s',
    (name) => {
      expect(findFileNameProblem(name)).toBe('invalid-characters')
    }
  )

  it.each(['a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b'])(
    'Windows で使えない記号: %s',
    (name) => {
      expect(findFileNameProblem(name)).toBe('invalid-characters')
    }
  )

  // 制御文字はコード値から組み立てる（ソース上に生の制御文字を置かないため）。
  it.each([
    ['NUL', 0x00],
    ['タブ', 0x09],
    ['改行', 0x0a],
    ['ESC', 0x1b],
    ['DEL', 0x7f]
  ])('制御文字（%s）', (_label, codePoint) => {
    const name = 'a' + String.fromCharCode(codePoint) + 'b'

    expect(findFileNameProblem(name)).toBe('invalid-characters')
  })

  it.each(['.', '..'])('位置を指す記号: %s', (name) => {
    expect(findFileNameProblem(name)).toBe('dot-name')
  })

  it.each(['name.', 'name '])('末尾が「.」か空白: %s', (name) => {
    expect(findFileNameProblem(name)).toBe('trailing-character')
  })

  it.each([
    'CON',
    'con',
    'Con',
    'PRN',
    'AUX',
    'NUL',
    'COM1',
    'com9',
    'LPT1',
    'lpt9',
    // 拡張子を付けても予約は解けない。
    'con.txt',
    'NUL.log'
  ])('Windows の予約デバイス名: %s', (name) => {
    expect(findFileNameProblem(name)).toBe('reserved')
  })

  it('COM0 / LPT0 は予約ではない', () => {
    expect(findFileNameProblem('COM0')).toBeNull()
    expect(findFileNameProblem('LPT0')).toBeNull()
  })
})

/**
 * 既に在るものを指すときの規則。
 *
 * **弾く側より通す側を厚く確かめる。** ここは「新規作成のための規則を、実在するものへ
 * 当ててしまっていないか」を見る場所で、Session 3-5.1 で直した不具合
 * （`aux.ts` が削除できない）が戻ってきたらここが落ちる。
 *
 * 1階層ぶんの名前として成立しているかは、こちらも同じだけ確かめる ──
 * 「触るのは親フォルダの realpath の直下だけ」がその担保に乗っているため
 * （main/files/mutateWorkspaceEntry.ts）。
 */
describe('findExistingNameProblem（既に在るものを指せる名前）', () => {
  /*
    どれも Windows のエクスプローラからは作れないが、ディスク上には在りうる
    （他の OS で作られたものを clone / コピーすれば普通に並ぶ）。
    実在するものを消せない・改名できないのは、守るものが何も無い不便でしかない。
  */
  it.each([
    'aux.ts',
    'CON',
    'con.txt',
    'NUL.log',
    'com1.txt',
    'lpt9',
    'notes.txt ', // 末尾が空白
    'notes.', // 末尾がドット
    ' leading.txt',
    '...hidden'
  ])('新規作成では受け付けない名前でも指せる: %s', (name) => {
    expect(findExistingNameProblem(name)).toBeNull()
  })

  it.each(['index.ts', 'README.md', '.gitignore', 'my file.txt', 'テスト.txt'])(
    '普通の名前も当然通る: %s',
    (name) => {
      expect(findExistingNameProblem(name)).toBeNull()
    }
  )

  /* 1階層ぶんであることは、こちらでも譲らない。 */
  it.each(['src/index.ts', 'src\\index.ts', '../outside.txt', '/etc/passwd', 'a:b', 'a*b', 'a|b'])(
    '区切り文字・記号は指せない: %s',
    (name) => {
      expect(findExistingNameProblem(name)).toBe('invalid-characters')
    }
  )

  it('制御文字は指せない', () => {
    expect(findExistingNameProblem('a\0b')).toBe('invalid-characters')
    expect(findExistingNameProblem('a\nb')).toBe('invalid-characters')
  })

  it.each(['.', '..'])('位置を指す記号は名前ではない: %s', (name) => {
    expect(findExistingNameProblem(name)).toBe('dot-name')
  })

  it('空文字と長すぎる名前は指せない', () => {
    expect(findExistingNameProblem('')).toBe('empty')
    expect(findExistingNameProblem('a'.repeat(FILE_NAME_MAX_LENGTH + 1))).toBe('too-long')
    expect(findExistingNameProblem('a'.repeat(FILE_NAME_MAX_LENGTH))).toBeNull()
  })

  /*
    2つの規則の関係。**新しい名前の規則は、既存の規則に上乗せしたもの**なので、
    指せない名前が作れることは起きない（逆はある）。
  */
  it('新しい名前として通るものは、既存のものとしても必ず指せる', () => {
    for (const name of ['index.ts', '.gitignore', 'my file.txt', 'con-fig.json', 'COM0']) {
      expect(findFileNameProblem(name)).toBeNull()
      expect(findExistingNameProblem(name)).toBeNull()
    }
  })
})

describe('normalizeFileName', () => {
  it('前後の空白は落とす', () => {
    expect(normalizeFileName('  index.ts  ')).toBe('index.ts')
  })

  it('中の空白は名前の一部として残す', () => {
    expect(normalizeFileName(' my file.txt ')).toBe('my file.txt')
  })

  it('空白だけの入力は空になる（＝ empty として弾かれる）', () => {
    expect(findFileNameProblem(normalizeFileName('   '))).toBe('empty')
  })
})
