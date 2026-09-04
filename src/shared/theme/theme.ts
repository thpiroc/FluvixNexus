/**
 * Theme の名前（Session 4-4）。
 *
 * ## なぜ shared に置くか
 *
 * 保存されるのは `appearance.theme` という**ただの文字列**で、その意味を知って
 * いるのは Renderer だけ ── という分担は Session 3-5 から変えていない
 * （main/store/settingsSections.ts の表）。それでも名前と既定をここへ置くのは、
 * **最初の1枚を描くのが Renderer ではない**ためにほかならない。
 *
 * ウィンドウは Renderer が動き出すより前に画面へ出る。そのとき塗られるのは
 * `BrowserWindow` の `backgroundColor`（Electron の値）で、ここが Dark 固定だと
 * **Light を選んでいる人には、起動のたびに一瞬だけ黒い窓が出る。**
 * 消すには Main が「保存されている Theme は Light だ」と知っている必要がある。
 *
 * ## Main が解釈するのは、この1つだけ
 *
 * Main が読むのは**どちらの色で最初の1枚を塗るか**だけで、それ以外の Theme の
 * 意味（36色の中身・どこにどう効くか）は1つも知らない。Theme 状態の持ち主は
 * 今までどおり Renderer にある（renderer/src/theme/useAppearance.ts）。
 *
 * | 誰            | Theme について知っていること                                   |
 * | ------------- | -------------------------------------------------------------- |
 * | shared（ここ）| 名前が2つあること・既定・読めない値の落とし先・初期描画の1色   |
 * | Main          | それを読んで窓の初期色を決め、Preload へ渡すこと               |
 * | Preload       | 最初の描画より前に `<html>` へ当てること                       |
 * | Renderer      | **色そのもの**（styles/theme.css）と、値の持ち主・変える口     |
 *
 * ## 色の実体はここに無い
 *
 * `THEME_WINDOW_BACKGROUND` の2色を除いて、色は1つもここに無い。36色の実体は
 * `renderer/src/styles/theme.css` の1箇所だけが持ち、Monaco も xterm も
 * そこから読んで組み立てる（renderer/src/theme/themeTokens.ts）── 同じ値を
 * 複数箇所へ書き写す形は Session 4-4 で無くした。
 *
 * この2色だけが例外なのは、**CSS が1行も評価されていない時点で要る値**だから
 * にほかならない。写しである以上ずれうるので、`theme.css` の
 * `--fx-color-app-bg` と一致することはテストが見張る
 * （renderer/src/styles/themeCss.test.ts）。
 *
 * ## 将来 Theme を足すとき
 *
 * `THEME_IDS` に名前を足し、`THEME_WINDOW_BACKGROUND` に色を足し、
 * `theme.css` にその Theme の上書きを足す ── その3箇所で閉じる。
 * System（OS 追従）は Theme の名前ではなく**選び方**なので、この集合には
 * 入らない（Session 4-4 では入れていない。docs/ARCHITECTURE.md §16.8）。
 */

/** 選べる Theme。ここに無い名前は Theme ではない。 */
export const THEME_IDS = ['dark', 'light'] as const

export type ThemeId = (typeof THEME_IDS)[number]

/**
 * 保存が無い / 読めない / 知らない名前だったときの Theme。
 *
 * Dark にしてあるのは、このアプリの見た目がそこから始まっているため
 * （DESIGN.md §3 ── パネル識別色も、ファイル種別の色も、Dark を土台に決めた）。
 */
export const DEFAULT_THEME_ID: ThemeId = 'dark'

/** 素の値が既知の Theme 名か。 */
export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)
}

/**
 * 素の値を Theme として読む。**読めなければ既定へ落とす。**
 *
 * 通るのは3つの経路すべて ── 保存ファイルから読んだ値・Preload へ渡された引数・
 * Renderer が受け取った値。どれも境界の外から来た値で、扱いを分ける理由が無い
 * （アプリをダウングレードすれば、この版が知らない Theme 名が保存されている）。
 */
export function normalizeThemeId(value: unknown): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME_ID
}

/**
 * 最初の1枚を塗る色（`BrowserWindow` の `backgroundColor`）。
 *
 * `theme.css` の `--fx-color-app-bg` と同じ値。**片方を変えるときは両方を直す**
 * ── ずれるとその Theme の起動時だけ地の色が一瞬違って見える。
 * 一致することはテストが見張っている（renderer/src/styles/themeCss.test.ts）。
 */
export const THEME_WINDOW_BACKGROUND: Readonly<Record<ThemeId, string>> = {
  dark: '#1e1e1e',
  light: '#f5f5f5'
}

/**
 * `<html>` に付く属性の名前（`data-fx-theme`）。
 *
 * Preload（最初の描画の前）と Renderer（切り替えたとき）の両方が当てるので、
 * 名前は1箇所で持つ。`theme.css` の選択子もこれと同じ綴りになる。
 */
export const THEME_ATTRIBUTE = 'data-fx-theme'

/**
 * Main が Preload へ Theme を渡すときの引数（`webPreferences.additionalArguments`）。
 *
 * IPC ではない ── **IPC は Renderer が動き出してからしか使えず、それでは間に合わない**
 * （避けたいのは、まさにその「動き出すまで」に出る一瞬にほかならない）。
 * Session 4-3A の2本（`settings:load` / `settings:save-section`）はそのままで、
 * 増えたチャンネルは1本も無い。
 */
export const THEME_ARGUMENT_PREFIX = '--fx-initial-theme='

/** Main 側で組み立てる（`--fx-initial-theme=light` の形）。 */
export function toThemeArgument(theme: ThemeId): string {
  return `${THEME_ARGUMENT_PREFIX}${theme}`
}

/**
 * Preload 側で読み取る。見つからない / 読めない場合は既定（Dark）。
 *
 * 引数の並びは Electron と Chromium が作るもので、こちらが足した1つが
 * どこに入るかは決まっていない。**先頭から探して最初に見つかったものを使う。**
 */
export function fromThemeArguments(argv: readonly string[]): ThemeId {
  for (const argument of argv) {
    if (argument.startsWith(THEME_ARGUMENT_PREFIX)) {
      return normalizeThemeId(argument.slice(THEME_ARGUMENT_PREFIX.length))
    }
  }

  return DEFAULT_THEME_ID
}
