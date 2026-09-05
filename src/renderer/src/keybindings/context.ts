import { createContext, useContext } from 'react'
import type { ResolvedKeybinding } from './resolve'
import type { WhenKey } from './when'

/**
 * 打鍵の受け口（Session 4-7A）。
 *
 * 配るのは2つだけ。
 *
 *   - 効いている割り当ての表（将来 Settings の一覧が読む。今は誰も読まない）
 *   - 条件を申告する口（`useWhenFlag`）
 *
 * **command を実行する口はここに無い。** 実行は `useCommands().execute` の
 * 一本で、打鍵はその呼び出し元の1つにすぎない。
 */
export interface KeybindingController {
  readonly entries: readonly ResolvedKeybinding[]
  /**
   * 条件を申告する。返り値を呼ぶと取り下げる。
   *
   * DOM から見て取れない条件（React が持っている真偽値）だけがここを通る。
   * Session 4-7A では `settingsOpen`（WorkspaceShell が持つ）1つ。
   */
  readonly setFlag: (key: WhenKey, value: boolean) => () => void
}

export const KeybindingContext = createContext<KeybindingController | null>(null)

export function useKeybindings(): KeybindingController {
  const controller = useContext(KeybindingContext)

  if (controller === null) {
    throw new Error('useKeybindings must be used inside <KeybindingProvider>.')
  }

  return controller
}
