import { describe, expect, it } from 'vitest'
import {
  parseLanguageServerCapabilities,
  PERMISSIVE_LANGUAGE_SERVER_CAPABILITIES
} from './serverCapabilities'

/**
 * `initialize` の応答を読む（Session 5-10）。
 *
 * 下の2つの `capabilities` は、実際に繋いで受け取ったものを写している。
 *
 * ```
 * pyright-langserver 1.1.413      … documentFormattingProvider が無い
 * typescript-language-server      … 6つとも出す
 * ```
 *
 * **この差が Session 5-10 で capabilities を読み始めた理由そのもの**なので、
 * 作り物ではなく本物の形を置いてある。
 */

/** Pyright 1.1.413 が返した `capabilities`（要る欄だけを抜いたもの）。 */
const PYRIGHT_CAPABILITIES = {
  textDocumentSync: 2,
  definitionProvider: { workDoneProgress: true },
  declarationProvider: { workDoneProgress: true },
  typeDefinitionProvider: { workDoneProgress: true },
  referencesProvider: { workDoneProgress: true },
  documentSymbolProvider: { workDoneProgress: true },
  hoverProvider: { workDoneProgress: true },
  renameProvider: { prepareProvider: true, workDoneProgress: true },
  completionProvider: {
    triggerCharacters: ['.', '[', '"', "'"],
    resolveProvider: true,
    workDoneProgress: true
  },
  workspace: { workspaceFolders: { supported: true, changeNotifications: true } }
}

/** typescript-language-server が返した `capabilities`（同上）。 */
const TYPESCRIPT_CAPABILITIES = {
  textDocumentSync: 2,
  completionProvider: { triggerCharacters: ['.', '"', "'", '/', '@', '<'], resolveProvider: true },
  definitionProvider: true,
  documentFormattingProvider: true,
  documentRangeFormattingProvider: true,
  hoverProvider: true,
  linkedEditingRangeProvider: false,
  renameProvider: { prepareProvider: true },
  referencesProvider: true
}

describe('parseLanguageServerCapabilities', () => {
  it('Pyright は formatting 以外の6つを出す', () => {
    expect(parseLanguageServerCapabilities({ capabilities: PYRIGHT_CAPABILITIES })).toEqual({
      completion: true,
      hover: true,
      definition: true,
      references: true,
      formatting: false,
      rename: true,
      'prepare-rename': true
    })
  })

  it('typescript-language-server は7つとも出す（Session 5-9 までと同じ振る舞い）', () => {
    expect(parseLanguageServerCapabilities({ capabilities: TYPESCRIPT_CAPABILITIES })).toEqual({
      completion: true,
      hover: true,
      definition: true,
      references: true,
      formatting: true,
      rename: true,
      'prepare-rename': true
    })
  })

  it('object の欄は「出す」と読む（中身は見ない）', () => {
    const parsed = parseLanguageServerCapabilities({
      capabilities: { hoverProvider: {}, definitionProvider: { workDoneProgress: false } }
    })

    expect(parsed.hover).toBe(true)
    expect(parsed.definition).toBe(true)
  })

  it('明示された false は「出さない」と読む', () => {
    const parsed = parseLanguageServerCapabilities({
      capabilities: { hoverProvider: false, definitionProvider: false, referencesProvider: false }
    })

    expect(parsed.hover).toBe(false)
    expect(parsed.definition).toBe(false)
    expect(parsed.references).toBe(false)
  })

  it('欄が無ければ「出さない」', () => {
    expect(parseLanguageServerCapabilities({ capabilities: {} })).toEqual({
      completion: false,
      hover: false,
      definition: false,
      references: false,
      formatting: false,
      rename: false,
      'prepare-rename': false
    })
  })

  it('renameProvider: true は prepareRename を出さない', () => {
    const parsed = parseLanguageServerCapabilities({ capabilities: { renameProvider: true } })

    expect(parsed.rename).toBe(true)
    expect(parsed['prepare-rename']).toBe(false)
  })

  it('prepareProvider: false も出さない', () => {
    const parsed = parseLanguageServerCapabilities({
      capabilities: { renameProvider: { prepareProvider: false } }
    })

    expect(parsed.rename).toBe(true)
    expect(parsed['prepare-rename']).toBe(false)
  })

  it('読めない応答は既定（すべて可）へ落とす', () => {
    for (const result of [null, undefined, 'ready', 42, [], {}, { capabilities: null }]) {
      expect(parseLanguageServerCapabilities(result)).toEqual(
        PERMISSIVE_LANGUAGE_SERVER_CAPABILITIES
      )
    }
  })

  it('capabilities が object でなければ既定（設定が読めないのと同じ扱い）', () => {
    expect(parseLanguageServerCapabilities({ capabilities: 'everything' })).toEqual(
      PERMISSIVE_LANGUAGE_SERVER_CAPABILITIES
    )
  })
})
