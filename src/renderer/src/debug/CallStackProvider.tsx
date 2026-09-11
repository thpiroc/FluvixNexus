import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { EMPTY_DEBUG_CALL_STACK, type DebugCallStackSnapshot } from '@shared/debug'
import { fluvix } from '../api/fluvix'
import { useWorkspaceFolder } from '../workspaceFolder/context'
import { CallStackContext, type CallStackController } from './callStackContext'

/**
 * Call Stack snapshot を Renderer 全体へ配る器（Session 6-5）。
 *
 * 正本は Main にあり、ここは表示用の写しだけを持つ。Workspace を跨いだ通知は
 * `workspaceId` で捨て、相対位置の意味が混ざらないようにする。
 */
export function CallStackProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const { workspace } = useWorkspaceFolder()
  const workspaceId = workspace?.id ?? null
  const [snapshot, setSnapshot] = useState<DebugCallStackSnapshot>(EMPTY_DEBUG_CALL_STACK)
  const workspaceIdRef = useRef<string | null>(workspaceId)

  workspaceIdRef.current = workspaceId

  useEffect(() => {
    if (workspaceId === null) {
      setSnapshot(EMPTY_DEBUG_CALL_STACK)
      return
    }

    let disposed = false

    void fluvix.debug.listCallStack().then((result) => {
      if (disposed || !result.ok || workspaceIdRef.current !== workspaceId) {
        return
      }

      setSnapshot(result.data.callStack)
    })

    const unsubscribe = fluvix.debug.onCallStackChanged((event) => {
      if (event.workspaceId !== workspaceId) {
        return
      }

      setSnapshot(event.callStack)
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [workspaceId])

  const value = useMemo<CallStackController>(() => ({ snapshot }), [snapshot])

  return <CallStackContext.Provider value={value}>{children}</CallStackContext.Provider>
}
