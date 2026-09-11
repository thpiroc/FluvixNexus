import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { EMPTY_DEBUG_CALL_STACK, type DebugCallStackSnapshot } from '@shared/debug'
import { fluvix } from '../api/fluvix'
import { useWorkspaceFolder } from '../workspaceFolder/context'
import { CallStackContext, type CallStackController } from './callStackContext'
import { resolveSelectedFrameId, type CallStackSelection } from './callStackSelection'

interface VersionedSnapshot {
  readonly snapshot: DebugCallStackSnapshot
  readonly version: number
}

/**
 * Call Stack snapshot を Renderer 全体へ配る器（Session 6-5）。
 *
 * 正本は Main にあり、ここは表示用の写しだけを持つ。Workspace を跨いだ通知は
 * `workspaceId` で捨て、相対位置の意味が混ざらないようにする。
 *
 * Session 6-6 で frame の選択（Variables が読む frame）を足した。選択は snapshot の
 * 版に結び付けてあり、差し替わると最上段へ戻る（debug/callStackSelection.ts）。
 */
export function CallStackProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const { workspace } = useWorkspaceFolder()
  const workspaceId = workspace?.id ?? null
  const [current, setCurrent] = useState<VersionedSnapshot>({
    snapshot: EMPTY_DEBUG_CALL_STACK,
    version: 0
  })
  const [selection, setSelection] = useState<CallStackSelection | null>(null)
  const workspaceIdRef = useRef<string | null>(workspaceId)

  workspaceIdRef.current = workspaceId

  const replace = useCallback((snapshot: DebugCallStackSnapshot) => {
    setCurrent((previous) => ({ snapshot, version: previous.version + 1 }))
  }, [])

  useEffect(() => {
    /*
      Workspace が変わったら、読み直しの答えを待たずに空へ戻す（Session 6-6）。
      前の Workspace の frame を選んだまま Variables が Scope を頼みに行かないため。
    */
    replace(EMPTY_DEBUG_CALL_STACK)

    if (workspaceId === null) {
      return
    }

    let disposed = false

    void fluvix.debug.listCallStack().then((result) => {
      if (disposed || !result.ok || workspaceIdRef.current !== workspaceId) {
        return
      }

      replace(result.data.callStack)
    })

    const unsubscribe = fluvix.debug.onCallStackChanged((event) => {
      if (event.workspaceId !== workspaceId) {
        return
      }

      replace(event.callStack)
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [workspaceId, replace])

  const selectedFrameId = resolveSelectedFrameId(current.snapshot, current.version, selection)
  const version = current.version

  const selectFrame = useCallback(
    (frameId: number) => {
      setSelection({ version, frameId })
    },
    [version]
  )

  const value = useMemo<CallStackController>(
    () => ({ snapshot: current.snapshot, version, selectedFrameId, selectFrame }),
    [current.snapshot, version, selectedFrameId, selectFrame]
  )

  return <CallStackContext.Provider value={value}>{children}</CallStackContext.Provider>
}
