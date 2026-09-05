import { useEffect } from 'react'
import { useKeybindings } from './context'
import type { WhenKey } from './when'

/**
 * DOM から見て取れない条件を申告する（Session 4-7A）。
 *
 * ```tsx
 * useWhenFlag('settingsOpen', settingsOpen)
 * ```
 *
 * `useCommand` と同じ形（所有者が名乗り、unmount で取り下げる）にしてある。
 * 申告できるのは `WHEN_KEYS` に載っている名前だけで、条件を勝手に増やせない。
 *
 * ## 状態を持ち上げないための仕組み
 *
 * `settingsOpen` は WorkspaceShell が持っている（面はレイアウトの木の外にあり、
 * 開く入口も出す先もあそこにしか無い ── `workspace/WorkspaceShell.tsx`）。
 * 条件のためにこれを外側の Provider へ持ち上げると、**その理由が壊れる。**
 *
 * 申告制にすれば、持ち主はそのままで「今こうなっている」だけが打鍵の層へ届く。
 */
export function useWhenFlag(key: WhenKey, value: boolean): void {
  const { setFlag } = useKeybindings()

  useEffect(() => setFlag(key, value), [setFlag, key, value])
}
