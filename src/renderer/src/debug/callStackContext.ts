import { createContext, useContext } from 'react'
import type { DebugCallStackSnapshot } from '@shared/debug'

export interface CallStackController {
  readonly snapshot: DebugCallStackSnapshot
  /**
   * snapshot が差し替わるたびに進む版（Session 6-6）。
   *
   * Variables はこれを key にして、差し替えのたびに tree を作り直す ──
   * 前の停止の handle や読みかけの応答を持ち越さないため。
   */
  readonly version: number
  /** Variables が読む frame（Session 6-6）。止まっていなければ null。 */
  readonly selectedFrameId: number | null
  readonly selectFrame: (frameId: number) => void
}

export const CallStackContext = createContext<CallStackController | null>(null)

export function useCallStack(): CallStackController {
  const controller = useContext(CallStackContext)

  if (controller === null) {
    throw new Error('useCallStack must be used inside a <CallStackProvider>.')
  }

  return controller
}
