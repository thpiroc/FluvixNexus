import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import type { DebugBreakpoint } from '@shared/debug'
import { fluvix } from '../api/fluvix'
import { useWorkspaceFolder } from '../workspaceFolder/context'
import { BreakpointContext, type BreakpointController } from './context'

/**
 * 今の Workspace の breakpoint を持つ器（Session 6-3）。
 *
 * ```
 * main/debug/breakpoints.ts
 *    ↓  debug:breakpoints-changed（workspaceId + 全件）
 * window.fluvix.debug        Preload の薄いラッパ
 *    ↓
 * ここ                        写しを持ち、入れ替えの操作を通す
 *    ↓
 * editor/monaco/breakpointGlyphs.ts   glyph margin の印にする
 * ```
 *
 * Renderer 側で debug ドメインの IPC を呼ぶ唯一の場所になる
 * （WorkspaceFolderProvider が workspace-folder ドメインに対して果たしている役と同じ）。
 *
 * ## 読むのは Workspace が変わったときだけ
 *
 * 通知は**変わったときにしか流れない**ので、開いた時点の状態は要求で1度読む
 * （`lsp:get-status` / `workspace-folder:get-current` と同じ形）。
 * 以降は通知が届くたびに置き換える ── 差分は当てない。
 *
 * ## 切り替えと行き違った通知を捨てる
 *
 * `workspaceId` を突き合わせる。相対位置は Workspace が変われば**別のファイル**を
 * 指すため、前の Workspace の一覧を新しい画面へ描くと、まったく関係の無い行に
 * 印が出る（`lsp:diagnostics` と同じ理由）。
 *
 * ## 失敗しても画面は生きたまま
 *
 * 入れ替えが断られた場合（Workspace の外・上限に達した）は、写しを変えない。
 * 画面を先に変えてから戻す形にすると、押した瞬間だけ印が出て消えることになる。
 */
export function BreakpointProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const { workspace } = useWorkspaceFolder()
  const workspaceId = workspace?.id ?? null
  const [breakpoints, setBreakpoints] = useState<readonly DebugBreakpoint[]>([])

  /*
    購読と応答は React の描画とは別の時間軸で走る。今どの Workspace を見ているかを
    ref で控え、行き違った応答を捨てる（useEditorSession.ts と同じ形）。
  */
  const workspaceIdRef = useRef<string | null>(workspaceId)

  workspaceIdRef.current = workspaceId

  useEffect(() => {
    if (workspaceId === null) {
      setBreakpoints([])
      return
    }

    let disposed = false

    void fluvix.debug.listBreakpoints().then((result) => {
      // 読んでいる間に切り替わった。前の Workspace の一覧を写さない。
      if (disposed || !result.ok || workspaceIdRef.current !== workspaceId) {
        return
      }

      setBreakpoints(result.data.breakpoints)
    })

    const unsubscribe = fluvix.debug.onBreakpointsChanged((event) => {
      if (event.workspaceId !== workspaceId) {
        return
      }

      setBreakpoints(event.breakpoints)
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [workspaceId])

  const toggle = useCallback((relativePath: string, line: number): void => {
    const requestedWorkspaceId = workspaceIdRef.current

    void fluvix.debug.toggleBreakpoint({ relativePath, line }).then((result) => {
      /*
        断られたら写しを変えない（このファイルの冒頭）。通知も届くが、
        応答の方が先に来ることがあるので、こちらでも置き換えておく。
      */
      if (result.ok && workspaceIdRef.current === requestedWorkspaceId) {
        setBreakpoints(result.data.breakpoints)
      }
    })
  }, [])

  const value = useMemo<BreakpointController>(
    () => ({ breakpoints, toggle }),
    [breakpoints, toggle]
  )

  return <BreakpointContext.Provider value={value}>{children}</BreakpointContext.Provider>
}
