import { describe, expect, it } from 'vitest'
import { resolveLspDocumentLanguage } from './documentLanguage'

/**
 * 拡張子 → 行き先の表（Session 5-2）。
 *
 * ここが「どのサーバを起動するか」の唯一の決め手になる ── Renderer から
 * サーバを名指しする欄は無く、起動は常にこの表の結果として起きる
 * （main/lsp/documentSync.ts）。したがって確かめたいのは次の3つ。
 *
 * | 観点                                   | なぜ                                             |
 * | -------------------------------------- | ------------------------------------------------ |
 * | JS と TS が同じサーバへ行く            | 1本で両方を見る（表の行が別なのは languageId だけ） |
 * | `.tsx` が `typescriptreact` になる     | LSP は Monaco と違って JSX を別の言語として扱う  |
 * | 対応が無い拡張子は null                | 開けないのではなく、サーバが要らないだけ         |
 */

describe('resolveLspDocumentLanguage', () => {
  it('TypeScript は typescript サーバへ行く', () => {
    expect(resolveLspDocumentLanguage('src/app.ts')).toEqual({
      serverId: 'typescript',
      languageId: 'typescript'
    })
  })

  it('`.tsx` は typescriptreact として渡す（Monaco の id とは別の表）', () => {
    expect(resolveLspDocumentLanguage('src/App.tsx')).toEqual({
      serverId: 'typescript',
      languageId: 'typescriptreact'
    })
  })

  it('JavaScript も同じサーバが見る（languageId だけが違う）', () => {
    expect(resolveLspDocumentLanguage('a.js')).toEqual({
      serverId: 'typescript',
      languageId: 'javascript'
    })
    expect(resolveLspDocumentLanguage('a.jsx')).toEqual({
      serverId: 'typescript',
      languageId: 'javascriptreact'
    })
  })

  it('Python と C# は、それぞれのサーバへ行く', () => {
    expect(resolveLspDocumentLanguage('main.py')).toEqual({
      serverId: 'python',
      languageId: 'python'
    })
    expect(resolveLspDocumentLanguage('Program.cs')).toEqual({
      serverId: 'csharp',
      languageId: 'csharp'
    })
  })

  it('大文字の拡張子でも同じ答えになる', () => {
    expect(resolveLspDocumentLanguage('src/App.TSX')?.languageId).toBe('typescriptreact')
  })

  it('対応するサーバが無い拡張子は null（同期しないだけで、編集はできる）', () => {
    expect(resolveLspDocumentLanguage('README.md')).toBeNull()
    expect(resolveLspDocumentLanguage('tsconfig.json')).toBeNull()
    expect(resolveLspDocumentLanguage('notes.txt')).toBeNull()
  })

  it('先頭のドットは拡張子ではない（Monaco 側の読み方と揃える）', () => {
    expect(resolveLspDocumentLanguage('.gitignore')).toBeNull()
    expect(resolveLspDocumentLanguage('src/.ts')).toBeNull()
  })

  it('拡張子を持たないファイルは null', () => {
    expect(resolveLspDocumentLanguage('Makefile')).toBeNull()
  })

  it('フォルダ名に付いたドットに引きずられない', () => {
    expect(resolveLspDocumentLanguage('some.dir/Makefile')).toBeNull()
    expect(resolveLspDocumentLanguage('some.dir/app.ts')?.serverId).toBe('typescript')
  })
})
