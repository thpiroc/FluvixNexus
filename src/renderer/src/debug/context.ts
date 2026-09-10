import { createContext, useContext } from 'react'
import type { DebugBreakpoint } from '@shared/debug'

/**
 * 今の Workspace の breakpoint を Renderer 全体へ配る仕組み（Session 6-3）。
 *
 * Context の定義と Provider を別ファイルにしてあるのは、Vite の Fast Refresh が
 * コンポーネント以外の export を含むファイルを扱えないため
 * （Theme / Editor / Terminal / Lsp の context.ts と同じ形）。
 *
 * ## なぜ Editor の外に置くのか
 *
 * 印は**Editor パネルより長く生きる**。パネルを閉じても、別の場所へ運んでも、
 * ファイルを閉じても、印は Workspace のものとして残る ── 正本は Main に
 * あるので消えはしないが、器を Editor の中に置くと、パネルを開き直すたびに
 * IPC で読み直すことになる（Terminal の画面を Shell の外に置いたのと同じ判断。
 * ARCHITECTURE.md §7.1）。
 *
 * ## 正本は Main 側
 *
 * ここが持つのは表示のための写しで、変更は必ず IPC を通る。応答でも通知でも
 * **全件が届く**ので、この層は差分を当てない ── 届いた一覧で置き換えるだけになる。
 */

export interface BreakpointController {
  /** 今の Workspace の全件（相対位置 → 行の順）。 */
  readonly breakpoints: readonly DebugBreakpoint[]
  /**
   * その位置の breakpoint を入れ替える（無ければ付け、あれば外す）。
   *
   * **応答を待たずに画面が変わることは無い。** 先に画面だけ変えると、
   * Main が断った（Workspace の外・上限に達した）ときに印だけが残る。
   */
  readonly toggle: (relativePath: string, line: number) => void
}

export const BreakpointContext = createContext<BreakpointController | null>(null)

/**
 * breakpoint を読む / 入れ替える。
 *
 * 器の外で呼ばれたら落とす。黙って空を返すと、「まだ読み込み中」と
 * 「Provider を置き忘れた」が同じ値になり、印が出ない理由を追えなくなる。
 */
export function useBreakpoints(): BreakpointController {
  const controller = useContext(BreakpointContext)

  if (controller === null) {
    throw new Error('useBreakpoints must be used inside a <BreakpointProvider>.')
  }

  return controller
}
