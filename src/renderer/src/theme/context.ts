import { createContext, useContext } from 'react'
import type { AppearanceController } from './useAppearance'

/**
 * Theme を Renderer 全体へ配る仕組み。
 *
 * Context の定義と Provider を別ファイルにしてあるのは、Vite の Fast Refresh が
 * コンポーネント以外の export を含むファイルを扱えないため（Editor / Terminal の
 * context.ts と同じ形）。
 */
export const ThemeContext = createContext<AppearanceController | null>(null)

/**
 * 今の Theme と、それを変える口。
 *
 * 器が無い場所（Provider の外）で呼ばれたら落とす。黙って既定値を返すと、
 * 「切り替えたのに一部だけ戻る」という形で表に出ることになり、原因が追いにくい。
 */
export function useTheme(): AppearanceController {
  const controller = useContext(ThemeContext)

  if (controller === null) {
    throw new Error('useTheme must be used inside a ThemeProvider.')
  }

  return controller
}
