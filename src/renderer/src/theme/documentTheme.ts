import { normalizeThemeId, THEME_ATTRIBUTE, type ThemeId } from '@shared/theme'

/**
 * `<html>` に今の Theme を当てる（Session 4-4）。
 *
 * 当てる場所が `<html>`（`documentElement`）なのは、`theme.css` の変数が
 * `:root` にあるためにほかならない ── `<body>` に当てると、`:root` の規則が
 * 一致しなくなる。
 *
 * ## 同じなら触らない
 *
 * 属性への代入は、値が同じでもブラウザから見れば「変わった」ことになりうる
 * （スタイルの再計算が走る）。**この関数は描画のたびに呼ばれる**ので
 * （ThemeProvider.tsx の「effect にしない理由」）、同じ値なら何もしない。
 *
 * ## 知らない値もここで落とす
 *
 * 型の上では `ThemeId` しか渡らないが、実際に当てる直前でもう一度落とす。
 * **`<html>` に知らない名前が付いた状態を作らない**ため ── そうなっても
 * `theme.css` の側は Dark に見える（一致する上書きが無い）が、
 * 画面の見た目と属性の値が食い違い、確認するときに何が起きているか分からなくなる。
 */
export function applyDocumentTheme(theme: ThemeId, root: Element = document.documentElement): void {
  const next = normalizeThemeId(theme)

  if (root.getAttribute(THEME_ATTRIBUTE) !== next) {
    root.setAttribute(THEME_ATTRIBUTE, next)
  }
}

/** 今 `<html>` に当たっている Theme（読めなければ既定）。確認と試験のためのもの。 */
export function readDocumentTheme(root: Element = document.documentElement): ThemeId {
  return normalizeThemeId(root.getAttribute(THEME_ATTRIBUTE))
}
