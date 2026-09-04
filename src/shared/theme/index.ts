/**
 * Theme の公開窓口（Session 4-4）。
 *
 * shared 層のルールどおり、ここは型と定数と小さな純関数だけを持つ。
 * 色の実体は `renderer/src/styles/theme.css` にあり、
 * その値を Monaco / xterm へ渡す形にするのは `renderer/src/theme/themeTokens.ts`。
 */
export {
  DEFAULT_THEME_ID,
  fromThemeArguments,
  isThemeId,
  normalizeThemeId,
  THEME_ARGUMENT_PREFIX,
  THEME_ATTRIBUTE,
  THEME_IDS,
  THEME_WINDOW_BACKGROUND,
  toThemeArgument
} from './theme'

export type { ThemeId } from './theme'
