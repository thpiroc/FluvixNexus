import { createContext, useContext } from 'react'
import type { TerminalTabsController } from './useTerminalTabs'

/**
 * 開いているターミナル（複数タブ）を Renderer 全体へ配る仕組み。
 *
 * Editor の context.ts と同じ形（Context の定義と Provider を別ファイルにしてあるのは、
 * Vite の Fast Refresh がコンポーネント以外の export を含むファイルを扱えないため）。
 *
 * Provider を Workspace Shell の外側に置く理由は terminalScreenStore.ts の冒頭
 * ── パネルは自由に動かせるため、セッションと画面がパネルより長く生きる必要がある。
 */
export const TerminalContext = createContext<TerminalTabsController | null>(null)

export function useTerminal(): TerminalTabsController {
  const controller = useContext(TerminalContext)

  if (controller === null) {
    throw new Error('useTerminal must be used inside a TerminalProvider.')
  }

  return controller
}
