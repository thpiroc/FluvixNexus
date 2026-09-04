import { describe, expect, it } from 'vitest'
import { THEME_IDS } from '@shared/theme'
import {
  monacoThemeBase,
  THEME_TOKEN_NAMES,
  toMonacoThemeColors,
  toTerminalThemeColors,
  type ThemeTokens
} from './themeTokens'

/**
 * CSS 変数から Monaco / xterm の色を組み立てる部分（Session 4-4）。
 *
 * DOM に触るのは `readThemeTokens` だけで、ここが試すのはその先 ── 表を1つ
 * 渡せば済む（このプロジェクトのテストは DOM に依存しない層を対象にしている。
 * vitest.config.ts）。
 *
 * 確かめたいのは3つ。
 *
 *   - **`theme.css` の値がそのまま行くこと**（写しではないので、途中で
 *     色が書き換わる場所が無い）
 *   - **読めなかった変数でも色として不正にならないこと**（1つの綴り間違いで
 *     Monaco のテーマ定義ごと失敗する、を作らない）
 *   - **ANSI の16色を渡していないこと**（シェルの持ち物。Theme で変えない）
 */

/** 実際の値の代わり。どの変数がどこへ行くかが分かるよう、名前をそのまま値にする。 */
function tokensOf(overrides: Partial<Record<string, string>> = {}): ThemeTokens {
  const tokens: Record<string, string> = {}

  for (const name of THEME_TOKEN_NAMES) {
    tokens[name] = overrides[name] ?? `value(${name})`
  }

  return tokens as ThemeTokens
}

describe('toMonacoThemeColors', () => {
  it('CSS 変数の値がそのまま Monaco の色になる', () => {
    const colors = toMonacoThemeColors(tokensOf())

    expect(colors['editor.background']).toBe('value(--fx-color-surface)')
    expect(colors['editor.foreground']).toBe('value(--fx-color-text)')
    expect(colors['editorLineNumber.foreground']).toBe('value(--fx-color-text-faint)')
    expect(colors['editorLineNumber.activeForeground']).toBe('value(--fx-color-text)')
    expect(colors['editor.lineHighlightBorder']).toBe('value(--fx-color-surface-hover)')
    expect(colors['editorWidget.background']).toBe('value(--fx-color-surface-raised)')
    expect(colors['editorWidget.border']).toBe('value(--fx-color-border-strong)')
  })

  /*
    変数名を間違えた場合。**そのまま渡すと Monaco はテーマの定義ごと失敗する**
    （色として不正なため）ので、代替値へ落として画面は成立させる。
    名前が揃っていること自体は styles/themeCss.test.ts が見張る。
  */
  it('読めなかった変数は、色として不正にならない値へ落ちる', () => {
    const colors = toMonacoThemeColors(tokensOf({ '--fx-color-surface': '' }))

    expect(colors['editor.background']).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('Theme ごとに継承元が変わる', () => {
    expect(monacoThemeBase('dark')).toBe('vs-dark')
    expect(monacoThemeBase('light')).toBe('vs')

    for (const theme of THEME_IDS) {
      expect(['vs', 'vs-dark']).toContain(monacoThemeBase(theme))
    }
  })
})

describe('toTerminalThemeColors', () => {
  it('地は sunken、文字は text（xterm へ渡す4色）', () => {
    expect(toTerminalThemeColors(tokensOf())).toEqual({
      background: 'value(--fx-color-surface-sunken)',
      foreground: 'value(--fx-color-text)',
      cursor: 'value(--fx-color-text)',
      // カーソルの下に来る文字の色。地と同じにすることで反転して見える。
      cursorAccent: 'value(--fx-color-surface-sunken)',
      selectionBackground: 'value(--fx-color-surface-hover)'
    })
  })

  /*
    シェルとその中の CLI が使う色であって、このアプリが決めるものではない。
    ここに `black` / `red` … が現れた時点で、`git status` の緑や npm の警告の
    黄色が、他のターミナルで見たときと違う色になる。
  */
  it('ANSI の16色は渡さない（Theme を変えても地の色だけが変わる）', () => {
    const colors = toTerminalThemeColors(tokensOf()) as unknown as Record<string, unknown>

    for (const ansi of ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']) {
      expect(colors[ansi]).toBeUndefined()
      expect(colors[`bright${ansi[0].toUpperCase()}${ansi.slice(1)}`]).toBeUndefined()
    }
  })

  it('読めなかった変数は、色として不正にならない値へ落ちる', () => {
    const colors = toTerminalThemeColors(tokensOf({ '--fx-color-text': '' }))

    expect(colors.foreground).toMatch(/^#[0-9a-f]{6}$/i)
  })
})
