import { describe, expect, it } from 'vitest'
import {
  resolveWorkspaceDocumentUri,
  toFileUri,
  toWorkspaceRelativePath,
  toWorkspaceRootUri
} from './documentUri'

/**
 * 相対位置 → URI の変換と、そこに掛かる Workspace の境界（Session 5-2）。
 *
 * ここが「Renderer は relativePath しか扱わない」を成立させている場所で、
 * 確かめたいのは2つになる。
 *
 * | 観点                             | なぜ                                                   |
 * | -------------------------------- | ------------------------------------------------------ |
 * | 外へ出る相対位置が URI にならない | 出られれば、Renderer から任意の場所を指せることになる  |
 * | URI の形が壊れない               | `#` や空白を含む名前で、区切りとして読まれない         |
 *
 * Windows のパスを前提に書いてある（v1 の対象。DESIGN.md §2）。
 */

const ROOT = 'D:\\proj'

describe('toFileUri', () => {
  it('ドライブレターの `:` まで符号化する（VS Code と同じ表記）', () => {
    expect(toFileUri('D:\\proj\\src\\app.ts')).toBe('file:///D%3A/proj/src/app.ts')
  })

  it('空白や `#` を含む名前を、区切りとして読まれない形にする', () => {
    expect(toFileUri('D:\\my proj\\a#b.ts')).toBe('file:///D%3A/my%20proj/a%23b.ts')
  })

  it('UNC は authority を持つ形にする（`file:////…` にしない）', () => {
    expect(toFileUri('\\\\server\\share\\a.ts')).toBe('file://server/share/a.ts')
  })

  it('POSIX の絶対パスも同じ形で組み立てる', () => {
    expect(toFileUri('/home/user/a.ts')).toBe('file:///home/user/a.ts')
  })
})

describe('toWorkspaceRootUri', () => {
  it('root の URI を作る（initialize の rootUri になる）', () => {
    expect(toWorkspaceRootUri(ROOT)).toBe('file:///D%3A/proj')
  })
})

describe('resolveWorkspaceDocumentUri', () => {
  it('Workspace の中の相対位置を URI にする', () => {
    expect(resolveWorkspaceDocumentUri(ROOT, 'src/app.ts')).toBe('file:///D%3A/proj/src/app.ts')
  })

  it('区切りが `\\` でも同じ URI になる', () => {
    expect(resolveWorkspaceDocumentUri(ROOT, 'src\\app.ts')).toBe('file:///D%3A/proj/src/app.ts')
  })

  it('`..` を含む相対位置は URI にならない', () => {
    expect(resolveWorkspaceDocumentUri(ROOT, '../secret.ts')).toBeNull()
    expect(resolveWorkspaceDocumentUri(ROOT, 'src/../../secret.ts')).toBeNull()
  })

  it('絶対パスは相対位置として読み替えない', () => {
    expect(resolveWorkspaceDocumentUri(ROOT, 'C:\\Windows\\win.ini')).toBeNull()
    expect(resolveWorkspaceDocumentUri(ROOT, '/etc/passwd')).toBeNull()
  })

  it('ドライブ相対・代替データストリームも受け付けない', () => {
    expect(resolveWorkspaceDocumentUri(ROOT, 'C:app.ts')).toBeNull()
    expect(resolveWorkspaceDocumentUri(ROOT, 'app.ts:stream')).toBeNull()
  })

  it('root そのもの（空文字）は文書ではない', () => {
    expect(resolveWorkspaceDocumentUri(ROOT, '')).toBeNull()
    expect(resolveWorkspaceDocumentUri(ROOT, '   ')).toBeNull()
  })

  it('文字列でない値は受け付けない（境界の外から届く値であるため）', () => {
    expect(resolveWorkspaceDocumentUri(ROOT, undefined)).toBeNull()
    expect(resolveWorkspaceDocumentUri(ROOT, 42)).toBeNull()
    expect(resolveWorkspaceDocumentUri(ROOT, { relativePath: 'a.ts' })).toBeNull()
  })

  it('前後に空白のある名前は、名前のまま URI になる（別のファイルに化けない）', () => {
    expect(resolveWorkspaceDocumentUri(ROOT, 'notes.txt ')).toBe('file:///D%3A/proj/notes.txt%20')
  })
})

/**
 * 逆向き ── サーバが指した URI を、Workspace の中の相対位置へ落とす（Session 5-3）。
 *
 * こちらは**別のプロセスが言ってきた文字列**を受ける側になる。診断はサーバが
 * 好きな URI に対して送れるため、確かめたいのは
 * **Workspace の外を指すものが1つも通らないこと**になる。
 *
 * 通らなかったものは Renderer に見えない（main/lsp/diagnostics.ts が捨てる）。
 */
describe('toWorkspaceRelativePath', () => {
  it('Workspace の中の URI を相対位置にする', () => {
    expect(toWorkspaceRelativePath(ROOT, 'file:///D%3A/proj/src/app.ts')).toBe('src/app.ts')
  })

  it('`:` を符号化していない URI も読む（サーバによって表記が違う）', () => {
    expect(toWorkspaceRelativePath(ROOT, 'file:///D:/proj/src/app.ts')).toBe('src/app.ts')
  })

  it('大文字小文字の違うドライブレターでも同じ位置として読む（Windows）', () => {
    expect(toWorkspaceRelativePath(ROOT, 'file:///d%3A/proj/src/app.ts')).toBe('src/app.ts')
  })

  it('符号化された名前を元に戻す', () => {
    expect(toWorkspaceRelativePath(ROOT, 'file:///D%3A/proj/my%20dir/a%23b.ts')).toBe(
      'my dir/a#b.ts'
    )
  })

  it('`localhost` の authority は自分のディスクとして読む', () => {
    expect(toWorkspaceRelativePath(ROOT, 'file://localhost/D%3A/proj/a.ts')).toBe('a.ts')
  })

  /* ------------------------------------------------ ここから先は「断る」側 */

  it('Workspace の外の絶対パスは断る', () => {
    expect(toWorkspaceRelativePath(ROOT, 'file:///D%3A/other/a.ts')).toBeNull()
    expect(toWorkspaceRelativePath(ROOT, 'file:///C%3A/Windows/win.ini')).toBeNull()
    expect(toWorkspaceRelativePath(ROOT, 'file:///D%3A/a.ts')).toBeNull()
  })

  it('前方一致するだけの別フォルダは断る（`D:\\proj` と `D:\\project`）', () => {
    expect(toWorkspaceRelativePath(ROOT, 'file:///D%3A/project/a.ts')).toBeNull()
  })

  it('`..` で外へ出る URI は断る', () => {
    expect(toWorkspaceRelativePath(ROOT, 'file:///D%3A/proj/../secret.ts')).toBeNull()
  })

  it('`file:` 以外の scheme は断る', () => {
    expect(toWorkspaceRelativePath(ROOT, 'untitled:Untitled-1')).toBeNull()
    expect(toWorkspaceRelativePath(ROOT, 'git:/D%3A/proj/a.ts')).toBeNull()
    expect(toWorkspaceRelativePath(ROOT, 'https://example.com/a.ts')).toBeNull()
    expect(toWorkspaceRelativePath(ROOT, 'deno:/https/example.com/a.ts')).toBeNull()
  })

  it('別ホストの UNC は断る（この PC のディスクではない）', () => {
    expect(toWorkspaceRelativePath(ROOT, 'file://server/share/a.ts')).toBeNull()
  })

  it('query / fragment を持つ URI は断る（1つのファイルを指していない）', () => {
    expect(toWorkspaceRelativePath(ROOT, 'file:///D%3A/proj/a.ts?v=1')).toBeNull()
    expect(toWorkspaceRelativePath(ROOT, 'file:///D%3A/proj/a.ts#L3')).toBeNull()
  })

  it('壊れた符号化で落ちない（相手の文字列で Main を止めない）', () => {
    expect(() => toWorkspaceRelativePath(ROOT, 'file:///D%3A/proj/%zz.ts')).not.toThrow()
    expect(toWorkspaceRelativePath(ROOT, 'file:///D%3A/proj/%zz.ts')).toBeNull()
  })

  it('符号化で区切りや NUL を持ち込む形は断る', () => {
    expect(toWorkspaceRelativePath(ROOT, 'file:///D%3A/proj/a%2F..%2F..%2Fsecret.ts')).toBeNull()
    expect(toWorkspaceRelativePath(ROOT, 'file:///D%3A/proj/a%00.ts')).toBeNull()
  })

  it('root そのものを指す URI は断る（フォルダは文書ではない）', () => {
    expect(toWorkspaceRelativePath(ROOT, 'file:///D%3A/proj')).toBeNull()
    expect(toWorkspaceRelativePath(ROOT, 'file:///D%3A/proj/')).toBeNull()
  })

  it('文字列でない値・空の値は断る', () => {
    expect(toWorkspaceRelativePath(ROOT, undefined)).toBeNull()
    expect(toWorkspaceRelativePath(ROOT, null)).toBeNull()
    expect(toWorkspaceRelativePath(ROOT, 42)).toBeNull()
    expect(toWorkspaceRelativePath(ROOT, '')).toBeNull()
    expect(toWorkspaceRelativePath(ROOT, { uri: 'file:///D%3A/proj/a.ts' })).toBeNull()
  })

  it('往復しても同じ位置に戻る（送る側と受ける側で表記が食い違わない）', () => {
    for (const relativePath of ['src/app.ts', 'my dir/a#b.ts', 'deep/nest/ed/file.py']) {
      const uri = resolveWorkspaceDocumentUri(ROOT, relativePath)

      expect(uri).not.toBeNull()
      expect(toWorkspaceRelativePath(ROOT, uri)).toBe(relativePath)
    }
  })
})
