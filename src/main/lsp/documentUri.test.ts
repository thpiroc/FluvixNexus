import { describe, expect, it } from 'vitest'
import { resolveWorkspaceDocumentUri, toFileUri, toWorkspaceRootUri } from './documentUri'

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
