import { describe, expect, it } from 'vitest'
import { FILES_RELATIVE_PATH_MAX_LENGTH } from '@shared/files'
import { normalizeWorkspaceRelativePath } from '../../files/workspacePath'
import { normalizeAgentRelativePath } from './agentPathSyntax'

/**
 * Agent のパス文字列の検査（Security Core v1 の STEP2）。
 *
 * ここは純粋関数なので、Windows 固有の形も**どの OS でも**同じ答えになることを確かめる
 * （Windows で読み替えられる形を、POSIX の CI でも弾けていることが要点）。
 * 実体（symlink・ジャンクション・hard link）は workspaceBoundary.test.ts が見る。
 */

describe('normalizeAgentRelativePath', () => {
  describe('通すもの', () => {
    it('Workspace 直下と入れ子の相対位置', () => {
      expect(normalizeAgentRelativePath('README.md')).toBe('README.md')
      expect(normalizeAgentRelativePath('src/main/index.ts')).toBe('src/main/index.ts')
      expect(normalizeAgentRelativePath('src\\main\\index.ts')).toBe('src/main/index.ts')
      expect(normalizeAgentRelativePath('./src//main/')).toBe('src/main')
    })

    it('空文字は Workspace root', () => {
      expect(normalizeAgentRelativePath('')).toBe('')
      expect(normalizeAgentRelativePath('.')).toBe('')
    })

    it('ドットで始まる名前・記号を含む名前', () => {
      expect(normalizeAgentRelativePath('.gitignore')).toBe('.gitignore')
      expect(normalizeAgentRelativePath('..hidden')).toBe('..hidden')
      expect(normalizeAgentRelativePath('src/[id]/page.tsx')).toBe('src/[id]/page.tsx')
      expect(normalizeAgentRelativePath('画像 #1 (コピー).png')).toBe('画像 #1 (コピー).png')
    })

    it('予約デバイス名を含むだけの普通の名前', () => {
      expect(normalizeAgentRelativePath('console.ts')).toBe('console.ts')
      expect(normalizeAgentRelativePath('nullable.ts')).toBe('nullable.ts')
      expect(normalizeAgentRelativePath('com10.txt')).toBe('com10.txt')
      expect(normalizeAgentRelativePath('auxiliary/index.ts')).toBe('auxiliary/index.ts')
    })
  })

  it('文字列でないものは受け付けない', () => {
    for (const raw of [undefined, null, 42, true, ['a'], { relativePath: 'a' }]) {
      expect(normalizeAgentRelativePath(raw)).toBeNull()
    }
  })

  it.each(['..', '../secret', 'src/../../etc', 'src\\..\\..\\etc', 'src/../src', '.. ', ' ..'])(
    'Traversal: %s',
    (raw) => {
      expect(normalizeAgentRelativePath(raw)).toBeNull()
    }
  )

  it.each([
    '/etc/passwd',
    '\\Windows',
    'C:\\Windows\\System32',
    'C:/Windows',
    'c:\\',
    ' /etc/passwd',
    '  C:\\Windows  '
  ])('絶対パス: %s', (raw) => {
    expect(normalizeAgentRelativePath(raw)).toBeNull()
  })

  it.each(['C:foo', 'c:foo\\bar', 'D:', 'src/C:foo', ' C:foo'])('ドライブ相対: %s', (raw) => {
    expect(normalizeAgentRelativePath(raw)).toBeNull()
  })

  /*
    POSIX の path.parse は `\\server\share` を root と見なさないため、既存の検査だけだと
    `server/share` という相対位置として通る。Agent 側では OS を問わず弾く。
  */
  it.each([
    '\\\\server\\share',
    '\\\\server\\share\\file.txt',
    '//server/share',
    ' \\\\server\\share'
  ])('UNC: %s', (raw) => {
    expect(normalizeAgentRelativePath(raw)).toBeNull()
  })

  it.each([
    '\\\\?\\C:\\Windows',
    '\\\\?\\UNC\\server\\share',
    '\\\\.\\PhysicalDrive0',
    '\\\\.\\pipe\\name',
    '//?/C:/Windows',
    '//./C:/Windows',
    '\\??\\C:\\Windows'
  ])('デバイス / 名前空間のパス: %s', (raw) => {
    expect(normalizeAgentRelativePath(raw)).toBeNull()
  })

  /*
    代替データストリーム。ドライブレター（`C:`）と同じ `:` だが、こちらは要素の途中に現れる。
    どちらも `:` を含む要素として弾く（drive letter かどうかで扱いを分けない）。
  */
  it.each([
    'file.txt:stream',
    'file.txt::$DATA',
    'file.txt:stream:$DATA',
    'src/file.txt:hidden',
    'src:stream/file.txt',
    ':stream'
  ])('代替データストリーム: %s', (raw) => {
    expect(normalizeAgentRelativePath(raw)).toBeNull()
  })

  it.each(['a<b', 'a>b', 'a"b', 'a|b', 'a?b', 'a*b', 'src/*.ts', 'a\tb', 'a\u0001b', 'a\0b'])(
    'Windows が名前に使えない文字・制御文字: %j',
    (raw) => {
      expect(normalizeAgentRelativePath(raw)).toBeNull()
    }
  )

  it.each(['.env.', '.env ', 'src/secret.txt.', 'src./a.ts', 'notes.txt  '])(
    '末尾がドットか空白の要素（Windows では別の名前に読み替わる）: %j',
    (raw) => {
      expect(normalizeAgentRelativePath(raw)).toBeNull()
    }
  )

  it.each([
    'CON',
    'con',
    'nul',
    'NUL.txt',
    'nul.tar.gz',
    'con .txt',
    'PRN',
    'aux',
    'COM1',
    'com9.log',
    'LPT1',
    'COM¹',
    'CONIN$',
    'conout$',
    'src/nul',
    'nul/file.txt'
  ])('予約デバイス名: %s', (raw) => {
    expect(normalizeAgentRelativePath(raw)).toBeNull()
  })

  it('長さの上限は既存の検査と同じ', () => {
    expect(normalizeAgentRelativePath('a'.repeat(FILES_RELATIVE_PATH_MAX_LENGTH + 1))).toBeNull()
  })

  /*
    既存の検査より緩くならないこと。Files の検査が弾くものは、Agent でも必ず弾く。
  */
  it('既存の normalizeWorkspaceRelativePath が弾くものは必ず弾く', () => {
    const samples = [
      '..',
      '../x',
      'C:\\x',
      'C:x',
      'x:y',
      '\\\\s\\x',
      'x\0y',
      '/x',
      ' .. ',
      '...',
      'a/.../b'
    ]

    for (const raw of samples) {
      if (normalizeWorkspaceRelativePath(raw) === null) {
        expect(normalizeAgentRelativePath(raw)).toBeNull()
      }
    }
  })
})
