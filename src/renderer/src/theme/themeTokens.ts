import type { ThemeId } from '@shared/theme'

/**
 * CSS 変数から、Monaco と xterm が要求する色を**生成する**（Session 4-4）。
 *
 * ## 何を解いているか
 *
 * Monaco も xterm も CSS 変数を読まない。色を JavaScript の値として要求するため、
 * Session 4-3B までは `monacoSetup.ts` と `xtermSetup.ts` の中に
 * **`theme.css` と同じ 16進数が書き写されて**いた。どちらのファイルにも
 * 「theme.css と同じ値を書き写しているので、片方を変えるときは両方を直すこと」
 * という注意書きが付いていた ── その注意書きが要ること自体が、写しである証拠に
 * ほかならない。Theme が2つになれば写しは倍になり、直し忘れは
 * 「Light にしたのにエディタの中だけ黒い」という形で出る。
 *
 * そこでこの層を挟む。**読む先は `theme.css` の1箇所だけ**で、
 * Monaco / xterm はここが組み立てたものを受け取る。
 *
 * ```
 * styles/theme.css        色の実体（Dark / Light の36色）
 *        ↓ getComputedStyle
 * themeTokens.ts          読んで、道具ごとの形へ組み立てる（ここ）
 *        ↓                        ↓
 * monacoSetup.ts          xtermSetup.ts
 * ```
 *
 * Theme を1つ足したときに触るのは `theme.css` と `shared/theme/theme.ts` だけで、
 * Monaco と xterm は何も知らないまま付いてくる。
 *
 * ## 読み取りと組み立てを分ける
 *
 * `readThemeTokens` だけが DOM に触れ、その先（`toMonacoThemeColors` /
 * `toTerminalThemeColors`）は**素の値の変換**にしかならない。分けてあるのは
 * このプロジェクトのテストが DOM に依存しない層を対象にしているためで
 * （vitest.config.ts）、組み立ての側は表を1つ渡すだけで試せる。
 *
 * ## 読めなかった値は落とさない
 *
 * `getComputedStyle` が空文字を返すのは、変数名を間違えたか、CSS がまだ
 * 当たっていない場合に限る。**そのまま Monaco へ渡すと色指定として不正になり、
 * テーマの定義ごと失敗する**（1つの綴り間違いでエディタが既定の見た目に戻る）。
 * 読めなかったものは代替値へ落とし、画面は成立させる ── その代わり、
 * 必要な変数が両 Theme に揃っていることはテストが見張る（styles/themeCss.test.ts）。
 */

/**
 * Monaco / xterm が要る CSS 変数。
 *
 * **この表がテストの入力でもある。** ここに載っている名前が `theme.css` の
 * Dark と Light の両方に定義されていることを styles/themeCss.test.ts が確かめる
 * ── 名前を変えたのに片方だけ直した、を通さないため。
 */
export const THEME_TOKEN_NAMES = [
  '--fx-color-app-bg',
  '--fx-color-surface',
  '--fx-color-surface-sunken',
  '--fx-color-surface-raised',
  '--fx-color-surface-hover',
  '--fx-color-border-strong',
  '--fx-color-text',
  '--fx-color-text-faint'
] as const

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number]

/** 読み取った変数の表（名前 → 値）。読めなかったものは空文字。 */
export type ThemeTokens = Readonly<Record<ThemeTokenName, string>>

/**
 * 読めなかった変数の代替。
 *
 * ここに並ぶのは「色として不正でない」ことだけが目的の値で、
 * **Theme の設計の一部ではない**（設計は `theme.css` にしかない）。
 * 実際に使われるのは変数名を間違えたときだけで、そのときは
 * テストが先に落ちている。
 */
const TOKEN_FALLBACK = '#808080'

/* -------------------------------------------------------------- 読み取り */

/**
 * `<html>` に当たっている今の Theme から、必要な変数を読む。
 *
 * 呼ぶ時点で `data-fx-theme` は既に当たっている（`ThemeProvider` が
 * 描画の中で当てるため。ThemeProvider.tsx の「effect にしない理由」）。
 */
export function readThemeTokens(element: Element = document.documentElement): ThemeTokens {
  const style = getComputedStyle(element)
  const tokens: Record<string, string> = {}

  for (const name of THEME_TOKEN_NAMES) {
    tokens[name] = style.getPropertyValue(name).trim()
  }

  return tokens as ThemeTokens
}

function pick(tokens: ThemeTokens, name: ThemeTokenName): string {
  const value = tokens[name]

  return value.length > 0 ? value : TOKEN_FALLBACK
}

/* ---------------------------------------------------------------- Monaco */

/**
 * Monaco のテーマが土台にするもの。
 *
 * 構文ハイライトのトークン色を自前で持たないため、Monaco の標準テーマを継承する
 * （Session 3-4 からの判断で、独自の配色を決めるのは色の設計をひととおり
 * 終えてからでよい）。**これは色ではなく Monaco の語彙**なので `theme.css` には
 * 置けず、Theme 名との対応をここが持つ。
 */
const MONACO_BASE: Readonly<Record<ThemeId, 'vs' | 'vs-dark'>> = {
  dark: 'vs-dark',
  light: 'vs'
}

export function monacoThemeBase(theme: ThemeId): 'vs' | 'vs-dark' {
  return MONACO_BASE[theme]
}

/**
 * Monaco の `colors`（エディタの面まわり）。
 *
 * 並べるのは**このアプリが決めたところ**だけで、それ以外は継承元に任せる。
 * どれも `theme.css` の変数そのもので、対応は右のコメントではなく
 * コード自体が持っている（写しではないので、ずれようがない）。
 */
export function toMonacoThemeColors(tokens: ThemeTokens): Record<string, string> {
  const surface = pick(tokens, '--fx-color-surface')
  const text = pick(tokens, '--fx-color-text')
  const borderStrong = pick(tokens, '--fx-color-border-strong')
  const raised = pick(tokens, '--fx-color-surface-raised')

  return {
    'editor.background': surface,
    'editor.foreground': text,
    'editorLineNumber.foreground': pick(tokens, '--fx-color-text-faint'),
    'editorLineNumber.activeForeground': text,
    'editorCursor.foreground': text,
    'editor.lineHighlightBorder': pick(tokens, '--fx-color-surface-hover'),
    'editorWidget.background': raised,
    'editorWidget.border': borderStrong,
    'editorSuggestWidget.background': raised,
    'editorSuggestWidget.border': borderStrong,
    'input.background': surface,
    'input.border': borderStrong
  }
}

/* ----------------------------------------------------------------- xterm */

/**
 * xterm へ渡す色。
 *
 * xterm の `ITheme` そのものではなく**こちらの型**にしてあるのは、
 * `terminalScreenStore.ts` がこの値を持ち回すため ── あのファイルは
 * xterm を型としてしか使わない約束で（実体を import すると、ストアを読むだけで
 * xterm が読み込まれ、遅延読み込みの意味が無くなる）、
 * ここで xterm の型を名乗ると同じことが起きる。
 *
 * **ANSI の16色は含めない。** シェルとその中の CLI が使う色であって、
 * このアプリが決めるものではない（`git status` の緑や npm の警告の黄色が、
 * 他のターミナルで見たときと違う色になる）。Theme が変わっても地の色だけが
 * 変わる ── この判断は Session 3-7-1 から変えていない。
 */
export interface TerminalThemeColors {
  readonly background: string
  readonly foreground: string
  readonly cursor: string
  readonly cursorAccent: string
  readonly selectionBackground: string
}

export function toTerminalThemeColors(tokens: ThemeTokens): TerminalThemeColors {
  const sunken = pick(tokens, '--fx-color-surface-sunken')
  const text = pick(tokens, '--fx-color-text')

  return {
    background: sunken,
    foreground: text,
    cursor: text,
    // カーソルの下に来る文字の色。地と同じにすることで「反転して見える」形になる。
    cursorAccent: sunken,
    selectionBackground: pick(tokens, '--fx-color-surface-hover')
  }
}

/** 今の Theme のまま、xterm 用の色を読む（画面を作るときと、切り替えたとき）。 */
export function readTerminalThemeColors(): TerminalThemeColors {
  return toTerminalThemeColors(readThemeTokens())
}
