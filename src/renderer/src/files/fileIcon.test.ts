import { describe, expect, it } from 'vitest'
import {
  resolveDirectoryIconId,
  resolveEntryIconId,
  resolveFileIconId,
  type FileIconId
} from './fileIcon'

/**
 * 種類別アイコンの判定（Session 3-6-6）。
 *
 * 見ているのは3つ。
 *   - 主要な種類がそれぞれ別のアイコンになること
 *   - **名前の表が拡張子の表より先に効く**こと（package.json / README.md）
 *   - 判定できない形（拡張子なし・ドットファイル・未知の拡張子）でも
 *     必ず何かを返すこと（アイコンが無くて行が崩れる状態を作らない）
 */

describe('resolveFileIconId', () => {
  it('主要な拡張子をそれぞれ別のアイコンにする', () => {
    const cases: readonly (readonly [string, FileIconId])[] = [
      ['index.ts', 'typescript'],
      ['App.tsx', 'typescript-react'],
      ['main.js', 'javascript'],
      ['App.jsx', 'javascript-react'],
      ['tsconfig.json', 'json'],
      ['index.html', 'html'],
      ['files.css', 'css'],
      ['DESIGN.md', 'markdown'],
      ['train.py', 'python'],
      ['Program.cs', 'csharp'],
      ['logo.png', 'image'],
      ['notes.txt', 'text']
    ]

    for (const [name, icon] of cases) {
      expect(resolveFileIconId(name), name).toBe(icon)
    }
  })

  it('同じ系統の別表記も同じアイコンにする', () => {
    expect(resolveFileIconId('config.mts')).toBe('typescript')
    expect(resolveFileIconId('config.cjs')).toBe('javascript')
    expect(resolveFileIconId('index.htm')).toBe('html')
    expect(resolveFileIconId('theme.scss')).toBe('css')
    expect(resolveFileIconId('types.pyi')).toBe('python')
    expect(resolveFileIconId('photo.jpeg')).toBe('image')
  })

  it('拡張子の大文字小文字を区別しない', () => {
    expect(resolveFileIconId('MAIN.TS')).toBe('typescript')
    expect(resolveFileIconId('App.TSX')).toBe('typescript-react')
    expect(resolveFileIconId('LOGO.PNG')).toBe('image')
    expect(resolveFileIconId('Notes.Txt')).toBe('text')
  })

  it('複数のドットを含む名前は、最後のドットから後ろだけを見る', () => {
    expect(resolveFileIconId('fileIcon.test.ts')).toBe('typescript')
    expect(resolveFileIconId('vite.config.mts')).toBe('typescript')
    expect(resolveFileIconId('logo.min.svg')).toBe('image')
    // 途中のドットが拡張子に見えても引きずられない（gz は表に無い）。
    expect(resolveFileIconId('archive.tar.gz')).toBe('file')
  })

  it('拡張子を持たない名前は無地のアイコンになる', () => {
    expect(resolveFileIconId('Makefile')).toBe('file')
    expect(resolveFileIconId('LICENSE')).toBe('file')
    // 末尾がドットの名前も「拡張子がある」とは扱わない。
    expect(resolveFileIconId('notes.')).toBe('file')
    expect(resolveFileIconId('')).toBe('file')
  })

  it('先頭のドットは拡張子ではない', () => {
    // 名前の表にあるものは引ける。
    expect(resolveFileIconId('.gitignore')).toBe('git')
    // 表に無いドットファイルは、`env` を拡張子として引きに行かない。
    expect(resolveFileIconId('.env')).toBe('file')
    expect(resolveFileIconId('.ts')).toBe('file')
  })

  it('未知の拡張子は無地のアイコンになる', () => {
    expect(resolveFileIconId('data.xyz')).toBe('file')
    expect(resolveFileIconId('report.docx')).toBe('file')
  })

  /* ------------------------------------------ 名前の表が先に効く */

  it('名前そのものに意味があるファイルは、拡張子より優先する', () => {
    expect(resolveFileIconId('package.json')).toBe('package')
    expect(resolveFileIconId('package-lock.json')).toBe('package')
    expect(resolveFileIconId('README.md')).toBe('readme')
    expect(resolveFileIconId('Dockerfile')).toBe('docker')
    expect(resolveFileIconId('.gitignore')).toBe('git')
  })

  it('名前の表も大文字小文字を区別しない', () => {
    expect(resolveFileIconId('dockerfile')).toBe('docker')
    expect(resolveFileIconId('DOCKERFILE')).toBe('docker')
    expect(resolveFileIconId('readme.md')).toBe('readme')
    expect(resolveFileIconId('Package.json')).toBe('package')
  })

  it('名前が完全一致しないものは、拡張子の表へ落ちる', () => {
    // README の仲間に見えても、md でなければ md のアイコンにはならない。
    expect(resolveFileIconId('readme.txt')).toBe('text')
    // 派生形は拾わない（完全一致だけを見る）。
    expect(resolveFileIconId('Dockerfile.dev')).toBe('file')
    expect(resolveFileIconId('my-package.json')).toBe('json')
  })
})

/* ---------------------------------------------------------------- フォルダ */

describe('resolveDirectoryIconId', () => {
  it('閉じているときと展開しているときで別のアイコンになる', () => {
    expect(resolveDirectoryIconId(false)).toBe('folder')
    expect(resolveDirectoryIconId(true)).toBe('folder-open')
  })
})

describe('resolveEntryIconId', () => {
  it('ファイルは名前から、フォルダは開閉から決まる', () => {
    expect(resolveEntryIconId({ type: 'file', name: 'App.tsx' })).toBe('typescript-react')
    expect(resolveEntryIconId({ type: 'directory', name: 'src' })).toBe('folder')
    expect(resolveEntryIconId({ type: 'directory', name: 'src' }, true)).toBe('folder-open')
  })

  it('フォルダには種類の表を当てない', () => {
    // ファイル名として意味を持つ名前でも、フォルダはフォルダとして出す。
    expect(resolveEntryIconId({ type: 'directory', name: 'Dockerfile' })).toBe('folder')
    expect(resolveEntryIconId({ type: 'directory', name: 'styles.css' }, true)).toBe('folder-open')
  })

  it('展開状態を渡さなければ閉じたフォルダになる（検索結果）', () => {
    expect(resolveEntryIconId({ type: 'directory', name: 'src' })).toBe('folder')
  })
})
