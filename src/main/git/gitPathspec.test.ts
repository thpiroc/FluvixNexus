import { describe, expect, it } from 'vitest'
import { chunkGitPathspecs, normalizeGitPathspec } from './gitPathspec'

/**
 * pathspec として通してよい形かの検証（Session 3-8-3）。
 *
 * ここが通した値は、そのまま git の引数になる。**通してはいけないものを1つ通すと、
 * 利用者が指したのとは別のものが Stage される**（あるいは Workspace の外が
 * 対象になる）ため、通す側と弾く側の両方を固定しておく。
 *
 * 「Workspace の中の相対位置か」の判断そのものは Files と同じ関数が持つ
 * （main/files/workspacePath.ts）。ここではその土台の効き目も一緒に確かめる ──
 * 土台が変わったときに、Git 側でも気づけるようにするため。
 */
describe('normalizeGitPathspec', () => {
  describe('通すもの', () => {
    it('ふつうの相対位置', () => {
      expect(normalizeGitPathspec('src/main.ts')).toBe('src/main.ts')
    })

    it('日本語のファイル名', () => {
      expect(normalizeGitPathspec('ドキュメント/設計メモ.md')).toBe('ドキュメント/設計メモ.md')
    })

    it('空白を含む名前（前後の空白も落とさない）', () => {
      // 落とすと、利用者が指した `notes.txt ` が別のファイル `notes.txt` に化ける。
      expect(normalizeGitPathspec('my folder/notes.txt ')).toBe('my folder/notes.txt ')
    })

    it('引用符を含む名前', () => {
      expect(normalizeGitPathspec("it's a file.txt")).toBe("it's a file.txt")
    })

    it('先頭が `-` の名前', () => {
      // 弾かない。オプションとして読まれないようにするのは `--`（gitCommands.ts）の仕事。
      expect(normalizeGitPathspec('-lead.txt')).toBe('-lead.txt')
    })

    it('glob に見える名前', () => {
      // 弾かない。glob として読まれないようにするのは `--literal-pathspecs` の仕事。
      expect(normalizeGitPathspec('a*.txt')).toBe('a*.txt')
      expect(normalizeGitPathspec('x?[ab].md')).toBe('x?[ab].md')
    })

    it('Windows の区切りは `/` に揃える', () => {
      expect(normalizeGitPathspec('src\\main\\app.ts')).toBe('src/main/app.ts')
    })

    it('`./` は落とす', () => {
      expect(normalizeGitPathspec('./src/./main.ts')).toBe('src/main.ts')
    })

    it('`.git` で始まる名前は `.git` そのものではない', () => {
      expect(normalizeGitPathspec('.gitignore')).toBe('.gitignore')
      expect(normalizeGitPathspec('.github/workflows/ci.yml')).toBe('.github/workflows/ci.yml')
    })
  })

  describe('弾くもの', () => {
    it('空文字（pathspec の空は「1件」ではない）', () => {
      expect(normalizeGitPathspec('')).toBeNull()
      expect(normalizeGitPathspec('   ')).toBeNull()
      expect(normalizeGitPathspec('.')).toBeNull()
    })

    it('文字列でない値', () => {
      expect(normalizeGitPathspec(undefined)).toBeNull()
      expect(normalizeGitPathspec(null)).toBeNull()
      expect(normalizeGitPathspec(42)).toBeNull()
      expect(normalizeGitPathspec(['src/main.ts'])).toBeNull()
    })

    it('絶対パス', () => {
      expect(normalizeGitPathspec('/etc/passwd')).toBeNull()
      expect(normalizeGitPathspec('C:\\Windows\\System32')).toBeNull()
      expect(normalizeGitPathspec('\\\\server\\share\\file.txt')).toBeNull()
      // 空白で囲めば通る、という抜け道を作らない。
      expect(normalizeGitPathspec(' C:\\Windows ')).toBeNull()
    })

    it('Workspace の外へ出る `..`', () => {
      expect(normalizeGitPathspec('../outside.txt')).toBeNull()
      expect(normalizeGitPathspec('src/../../outside.txt')).toBeNull()
      // 解決すれば中に収まる形も通さない（判断を単純に保つ）。
      expect(normalizeGitPathspec('src/../main.ts')).toBeNull()
    })

    it('pathspec の魔法（`:` で始まる形）', () => {
      expect(normalizeGitPathspec(':(exclude)src')).toBeNull()
      expect(normalizeGitPathspec(':/')).toBeNull()
      expect(normalizeGitPathspec(':!src/main.ts')).toBeNull()
    })

    it('ドライブ相対・代替データストリーム', () => {
      expect(normalizeGitPathspec('C:notes.txt')).toBeNull()
      expect(normalizeGitPathspec('notes.txt:stream')).toBeNull()
    })

    it('NUL と制御文字', () => {
      expect(normalizeGitPathspec('src/main\0.ts')).toBeNull()
      expect(normalizeGitPathspec('src/main\n.ts')).toBeNull()
      expect(normalizeGitPathspec('src/main\t.ts')).toBeNull()
    })

    it('`.git` の中', () => {
      expect(normalizeGitPathspec('.git')).toBeNull()
      expect(normalizeGitPathspec('.git/config')).toBeNull()
      expect(normalizeGitPathspec('.git\\hooks\\pre-commit')).toBeNull()
    })

    it('桁違いに長い値', () => {
      expect(normalizeGitPathspec('a'.repeat(100_000))).toBeNull()
    })
  })
})

/**
 * 引数の分割。
 *
 * Windows のコマンドラインには全体で 32767 文字という上限があり、超えると
 * **実行そのものが失敗する** ── 「すべて Stage」が大きなリポジトリでだけ
 * 動かない、という形で表に出る。
 */
describe('chunkGitPathspecs', () => {
  it('少なければ1回で渡す', () => {
    expect(chunkGitPathspecs(['a.txt', 'b.txt'])).toEqual([['a.txt', 'b.txt']])
  })

  it('1件も無ければ何も渡さない', () => {
    expect(chunkGitPathspecs([])).toEqual([])
  })

  it('件数が多ければ分ける', () => {
    const paths = Array.from({ length: 700 }, (_, index) => `file-${index}.txt`)
    const chunks = chunkGitPathspecs(paths)

    expect(chunks.length).toBeGreaterThan(1)
    // 分けても1件も落ちない（落ちれば「すべて Stage」が黙って半端になる）。
    expect(chunks.flatMap((chunk) => [...chunk])).toEqual(paths)
  })

  it('長い path では件数が少なくても分ける', () => {
    const paths = Array.from({ length: 40 }, (_, index) => `${'d/'.repeat(400)}file-${index}.txt`)
    const chunks = chunkGitPathspecs(paths)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flatMap((chunk) => [...chunk])).toEqual(paths)
  })

  it('1件で上限を超えても、その1件は捨てない', () => {
    const huge = `${'d/'.repeat(20_000)}file.txt`
    const chunks = chunkGitPathspecs([huge, 'a.txt'])

    expect(chunks.flatMap((chunk) => [...chunk])).toEqual([huge, 'a.txt'])
  })
})
