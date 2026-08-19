import { describe, expect, it } from 'vitest'
import {
  FALLBACK_EDITOR_LANGUAGE_ID,
  resolveEditorLanguageId,
  resolveEditorLanguageIdByExtension
} from './language'

/**
 * 言語判定（editor/monaco/language.ts）。
 *
 * ここでテストできるのは、この判断が Monaco を import していないから
 * （そのファイルの冒頭を参照）。Monaco 本体の組み込みは実際に起動して確認する。
 */

describe('resolveEditorLanguageId', () => {
  it('Session 3-4 で扱うと決めた拡張子をすべて解決する', () => {
    const expected: ReadonlyArray<readonly [string, string]> = [
      ['src/App.tsx', 'typescript'],
      ['src/main.ts', 'typescript'],
      ['scripts/build.mts', 'typescript'],
      ['scripts/legacy.cts', 'typescript'],
      ['src/legacy.js', 'javascript'],
      ['src/Widget.jsx', 'javascript'],
      ['tools/run.mjs', 'javascript'],
      ['tools/run.cjs', 'javascript'],
      ['package.json', 'json'],
      ['tsconfig.jsonc', 'json'],
      ['public/index.html', 'html'],
      ['public/legacy.htm', 'html'],
      ['src/styles/theme.css', 'css'],
      ['README.md', 'markdown'],
      ['docs/guide.markdown', 'markdown'],
      ['tools/convert.py', 'python'],
      ['tools/gui.pyw', 'python'],
      ['tools/types.pyi', 'python'],
      ['src/Program.cs', 'csharp'],
      ['scripts/build.csx', 'csharp'],
      ['notes.txt', 'plaintext']
    ]

    for (const [relativePath, languageId] of expected) {
      expect(resolveEditorLanguageId(relativePath)).toBe(languageId)
    }
  })

  it('大文字の拡張子でも同じ言語になる', () => {
    expect(resolveEditorLanguageId('src/App.TSX')).toBe('typescript')
    expect(resolveEditorLanguageId('README.MD')).toBe('markdown')
    expect(resolveEditorLanguageId('src/Program.CS')).toBe('csharp')
  })

  it('知らない拡張子は Plain Text へ落とす', () => {
    expect(resolveEditorLanguageId('build/output.wasm')).toBe(FALLBACK_EDITOR_LANGUAGE_ID)
    expect(resolveEditorLanguageId('src/main.rs')).toBe(FALLBACK_EDITOR_LANGUAGE_ID)
    expect(resolveEditorLanguageId('data.yaml')).toBe(FALLBACK_EDITOR_LANGUAGE_ID)
  })

  it('拡張子を持たないファイルは Plain Text', () => {
    expect(resolveEditorLanguageId('LICENSE')).toBe('plaintext')
    expect(resolveEditorLanguageId('src/Makefile')).toBe('plaintext')
  })

  it('先頭のドットは拡張子として扱わない', () => {
    // `.gitignore` を「gitignore という拡張子のファイル」と読むと、
    // 将来ファイル名そのものの規則を足したときに二重の判断になる。
    expect(resolveEditorLanguageId('.gitignore')).toBe('plaintext')
    expect(resolveEditorLanguageId('src/.env')).toBe('plaintext')
  })

  it('フォルダ名に含まれるドットに引きずられない', () => {
    expect(resolveEditorLanguageId('my.project/README.md')).toBe('markdown')
    expect(resolveEditorLanguageId('my.project/LICENSE')).toBe('plaintext')
  })

  it('多重の拡張子は末尾で決まる', () => {
    expect(resolveEditorLanguageId('src/component.test.ts')).toBe('typescript')
    expect(resolveEditorLanguageId('archive.tar.gz')).toBe('plaintext')
  })
})

describe('resolveEditorLanguageIdByExtension', () => {
  it('FileEntry.extension（拡張子だけ・null あり）をそのまま渡せる', () => {
    expect(resolveEditorLanguageIdByExtension('ts')).toBe('typescript')
    expect(resolveEditorLanguageIdByExtension('CS')).toBe('csharp')
    expect(resolveEditorLanguageIdByExtension(null)).toBe('plaintext')
    expect(resolveEditorLanguageIdByExtension('')).toBe('plaintext')
  })
})
