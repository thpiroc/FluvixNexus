import { resolve, sep } from 'path'
import { describe, expect, it } from 'vitest'
import { FILES_RELATIVE_PATH_MAX_LENGTH } from '@shared/files'
import {
  isInsideWorkspace,
  normalizeWorkspaceRelativePath,
  resolveWorkspacePath
} from './workspacePath'

/**
 * Workspace 境界の検証。
 *
 * ここが Renderer から届く相対位置に対する唯一の関門になるため、
 * 「通してよいもの」より「弾かなければならないもの」を厚く確かめる
 * （通らないものが1つ増えても使い勝手が少し落ちるだけだが、
 * 弾き漏らしは Workspace の外へ手が届くことを意味する）。
 *
 * symlink による脱出はパス文字列では判断できないため、
 * realpath を取ってから isInsideWorkspace へ通す側（readWorkspaceDirectory.ts）で担保する。
 */

const ROOT = resolve('/workspace/project')

describe('normalizeWorkspaceRelativePath', () => {
  it('空文字と空白だけの入力は Workspace root を指す', () => {
    expect(normalizeWorkspaceRelativePath('')).toBe('')
    expect(normalizeWorkspaceRelativePath('   ')).toBe('')
  })

  it('区切りを / に揃える', () => {
    expect(normalizeWorkspaceRelativePath('src/main')).toBe('src/main')
    expect(normalizeWorkspaceRelativePath('src\\main\\files')).toBe('src/main/files')
    expect(normalizeWorkspaceRelativePath('src//main///files')).toBe('src/main/files')
  })

  it('前後の余分な区切りと . の要素を落とす', () => {
    expect(normalizeWorkspaceRelativePath('src/main/')).toBe('src/main')
    expect(normalizeWorkspaceRelativePath('./src/./main')).toBe('src/main')
  })

  it('文字列でない値は受け付けない', () => {
    expect(normalizeWorkspaceRelativePath(undefined)).toBeNull()
    expect(normalizeWorkspaceRelativePath(null)).toBeNull()
    expect(normalizeWorkspaceRelativePath(42)).toBeNull()
    expect(normalizeWorkspaceRelativePath(['src'])).toBeNull()
    expect(normalizeWorkspaceRelativePath({ relativePath: 'src' })).toBeNull()
  })

  it('.. を含むものは、結果が内側に収まる形でも受け付けない', () => {
    expect(normalizeWorkspaceRelativePath('..')).toBeNull()
    expect(normalizeWorkspaceRelativePath('../secrets')).toBeNull()
    expect(normalizeWorkspaceRelativePath('../../../../Windows/System32')).toBeNull()
    expect(normalizeWorkspaceRelativePath('src/../../etc')).toBeNull()
    expect(normalizeWorkspaceRelativePath('src\\..\\..\\etc')).toBeNull()
    // 解決すれば src の中に収まるが、受け付ける理由が無い。
    expect(normalizeWorkspaceRelativePath('src/main/../main')).toBeNull()
  })

  it('絶対パスは受け付けない', () => {
    expect(normalizeWorkspaceRelativePath('/etc/passwd')).toBeNull()
    expect(normalizeWorkspaceRelativePath('\\Windows')).toBeNull()
    expect(normalizeWorkspaceRelativePath('C:\\Windows\\System32')).toBeNull()
    expect(normalizeWorkspaceRelativePath('C:/Windows')).toBeNull()
    expect(normalizeWorkspaceRelativePath('\\\\server\\share')).toBeNull()
  })

  it('ドライブ相対・代替データストリームのような : を含む要素は受け付けない', () => {
    expect(normalizeWorkspaceRelativePath('C:notes.txt')).toBeNull()
    expect(normalizeWorkspaceRelativePath('src/notes.txt:hidden')).toBeNull()
  })

  it('NUL を含むものは受け付けない（fs へ渡すと例外になる）', () => {
    expect(normalizeWorkspaceRelativePath('src\0/main')).toBeNull()
  })

  it('桁違いに長いものは受け付けない', () => {
    const long = 'a'.repeat(FILES_RELATIVE_PATH_MAX_LENGTH + 1)

    expect(normalizeWorkspaceRelativePath(long)).toBeNull()
    expect(normalizeWorkspaceRelativePath('a'.repeat(FILES_RELATIVE_PATH_MAX_LENGTH))).toBe(
      'a'.repeat(FILES_RELATIVE_PATH_MAX_LENGTH)
    )
  })

  it('特殊な文字を含む名前は通す（実在しうるファイル名のため）', () => {
    expect(normalizeWorkspaceRelativePath('画像 #1 (コピー).png')).toBe('画像 #1 (コピー).png')
    expect(normalizeWorkspaceRelativePath('src/[id]/page.tsx')).toBe('src/[id]/page.tsx')
    expect(normalizeWorkspaceRelativePath('..hidden')).toBe('..hidden')
    expect(normalizeWorkspaceRelativePath('.gitignore')).toBe('.gitignore')
  })

  /*
    ここが Session 3-5.1 で直したもの。

    相対位置を trim していると、末尾に空白を持つ名前を指した要求が
    **別のファイルを指す要求に化ける**。削除のような戻せない操作でそれが起きると、
    「操作が失敗する」では済まない。trim は判定にだけ使い、
    戻り値は生の文字列から組み立てる。
  */
  describe('利用者が指した名前を変形しない', () => {
    it('末尾の空白を落とさない', () => {
      expect(normalizeWorkspaceRelativePath('notes.txt ')).toBe('notes.txt ')
      expect(normalizeWorkspaceRelativePath('src/notes.txt ')).toBe('src/notes.txt ')
      expect(normalizeWorkspaceRelativePath('src /notes.txt')).toBe('src /notes.txt')
    })

    it('先頭の空白を落とさない', () => {
      expect(normalizeWorkspaceRelativePath(' notes.txt')).toBe(' notes.txt')
      expect(normalizeWorkspaceRelativePath('src/ notes.txt')).toBe('src/ notes.txt')
    })

    it('要素の途中の空白はこれまでどおり残る', () => {
      expect(normalizeWorkspaceRelativePath('my file.txt')).toBe('my file.txt')
    })

    it('末尾のドットも落とさない（Windows では別名になりうるが、変形はしない）', () => {
      expect(normalizeWorkspaceRelativePath('notes.')).toBe('notes.')
    })

    /*
      trim を「判定」に使うのは残す。位置を言っていない入力（空白だけ）は
      root と読む ── これは名前を変形する話ではない。
    */
    it('空白だけの入力は root のまま', () => {
      expect(normalizeWorkspaceRelativePath('   ')).toBe('')
      expect(normalizeWorkspaceRelativePath('\t\n ')).toBe('')
    })
  })

  /*
    trim をやめたことで、判定をすり抜けられるようになっていないこと。
    絶対パスの検査は trim した写しに対しても行う（弾く範囲はむしろ広い）。
  */
  describe('空白で囲んでも判定をすり抜けない', () => {
    it.each([
      ' /etc/passwd',
      '/etc/passwd ',
      '  C:\\Windows\\System32  ',
      ' C:/Windows',
      '  \\\\server\\share ',
      ' \\Windows'
    ])('絶対パス: %s', (raw) => {
      expect(normalizeWorkspaceRelativePath(raw)).toBeNull()
    })

    it.each([' ..', '.. ', ' ../secrets ', 'src/ .. /etc', ' src/../../etc'])(
      '.. を含む: %s',
      (raw) => {
        expect(normalizeWorkspaceRelativePath(raw)).toBeNull()
      }
    )

    it.each([' C:notes.txt', 'src/notes.txt:hidden ', ' a:b '])(': を含む: %s', (raw) => {
      expect(normalizeWorkspaceRelativePath(raw)).toBeNull()
    })

    it('NUL・長さの上限も変わらない', () => {
      expect(normalizeWorkspaceRelativePath(' src\0/main ')).toBeNull()
      expect(
        normalizeWorkspaceRelativePath(` ${'a'.repeat(FILES_RELATIVE_PATH_MAX_LENGTH)} `)
      ).toBeNull()
    })
  })
})

describe('resolveWorkspacePath', () => {
  it('root からの絶対パスを作る', () => {
    expect(resolveWorkspacePath(ROOT, '')).toBe(ROOT)
    expect(resolveWorkspacePath(ROOT, 'src/main')).toBe(resolve(ROOT, 'src/main'))
  })

  it('root の外を指す相対位置は作らない', () => {
    // 正規化を通さずに渡された場合の最後の砦（呼び出し順が変わっても外へ出ない）。
    expect(resolveWorkspacePath(ROOT, '../other')).toBeNull()
    expect(resolveWorkspacePath(ROOT, '../../')).toBeNull()
  })

  /*
    末尾に空白を持つ名前でも、行き先は root の直下のまま。
    変形しないことと、境界の中に収まっていることは両立する。
  */
  it('末尾に空白を持つ名前も、そのまま root の中に収まる', () => {
    const target = resolveWorkspacePath(ROOT, 'notes.txt ')

    expect(target).toBe(resolve(ROOT, 'notes.txt '))
    expect(target).not.toBe(resolve(ROOT, 'notes.txt'))
    expect(isInsideWorkspace(ROOT, target as string)).toBe(true)
  })
})

describe('isInsideWorkspace', () => {
  it('root 自身は内側として扱う', () => {
    expect(isInsideWorkspace(ROOT, ROOT)).toBe(true)
    expect(isInsideWorkspace(ROOT, `${ROOT}${sep}`)).toBe(true)
  })

  it('root の配下は内側', () => {
    expect(isInsideWorkspace(ROOT, resolve(ROOT, 'src'))).toBe(true)
    expect(isInsideWorkspace(ROOT, resolve(ROOT, 'src/main/index.ts'))).toBe(true)
  })

  it('名前の前方一致だけでは内側と見なさない', () => {
    // "project" と "project-backup" は別のフォルダ。区切りまで含めて比べる。
    expect(isInsideWorkspace(ROOT, `${ROOT}-backup`)).toBe(false)
    expect(isInsideWorkspace(ROOT, `${ROOT}-backup${sep}secrets.txt`)).toBe(false)
  })

  it('root の外は外側', () => {
    expect(isInsideWorkspace(ROOT, resolve('/workspace'))).toBe(false)
    expect(isInsideWorkspace(ROOT, resolve('/workspace/other/file.txt'))).toBe(false)
  })

  it('symlink の指し先が外なら外側と判定できる（realpath 済みの値を渡す想定）', () => {
    expect(isInsideWorkspace(ROOT, resolve('/etc/passwd'))).toBe(false)
  })
})
