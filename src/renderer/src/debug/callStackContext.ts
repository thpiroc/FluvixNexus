import { createContext, useContext } from 'react'
import type { DebugCallStackSnapshot } from '@shared/debug'

export interface CallStackController {
  readonly snapshot: DebugCallStackSnapshot
}

export const CallStackContext = createContext<CallStackController | null>(null)

export function useCallStack(): CallStackController {
  const controller = useContext(CallStackContext)

  if (controller === null) {
    throw new Error('useCallStack must be used inside a <CallStackProvider>.')
  }

  return controller
}
