import { useEffect, useMemo, useRef } from 'react'
import { useCallStack } from '../../debug/callStackContext'
import { useI18n } from '../../i18n/context'
import { toExecutionLineDecorations } from './executionLineDecorations'
import {
  createExecutionLineController,
  type ExecutionLineController,
  type ExecutionLineEditor
} from './executionLineGlyphs'

/**
 * Monaco に現在の実行位置を出す（Session 6-13）。
 *
 * ```
 * debug/CallStackProvider.tsx          Main の Call Stack snapshot の写し + 選んでいる frame
 *    ↓
 * ここ                                  今出しているファイルのぶんだけを取り出して当てる
 *    ↓
 * editor/debug/executionLineGlyphs.ts  Monaco の decoration
 * ```
 *
 * useBreakpointGlyphs.ts と同じ形で、MonacoEditor.tsx への追加は呼ぶ1行だけ。
 *
 * ## 消すための経路を別に持たない
 *
 * Continue / Step / Stop / terminated / exited / adapter の異常 / Workspace の切り替えでは、
 * Main が Call Stack snapshot を空にして配り直す（main/debug/callStack.ts）。印はその snapshot から
 * 導くだけなので、**snapshot が空になれば同じ effect が印を外す**。
 */
export function useExecutionLineDecorations(
  editor: ExecutionLineEditor | null,
  relativePath: string
): void {
  const { snapshot, selectedFrameId } = useCallStack()
  const { t } = useI18n()

  const controllerRef = useRef<ExecutionLineController | null>(null)
  const renderedPathRef = useRef<string | null>(null)
  const translateRef = useRef(t)

  translateRef.current = t

  useEffect(() => {
    if (editor === null) {
      return
    }

    const controller = createExecutionLineController(editor, (decoration) =>
      translateRef.current(decoration.messageKey)
    )

    controllerRef.current = controller
    renderedPathRef.current = null

    return () => {
      controllerRef.current = null
      renderedPathRef.current = null
      controller.dispose()
    }
  }, [editor])

  const decorations = useMemo(
    () => toExecutionLineDecorations(snapshot, selectedFrameId, relativePath),
    [snapshot, selectedFrameId, relativePath]
  )

  /*
    器を作る effect より後に置く（useBreakpointGlyphs.ts と同じ理由）。
    言語が変わったら hover の文言を当て直すため、`t` が変わったときも reset してから当てる。
  */
  const translatedWithRef = useRef(t)

  useEffect(() => {
    const controller = controllerRef.current

    if (controller === null) {
      return
    }

    if (renderedPathRef.current !== relativePath || translatedWithRef.current !== t) {
      controller.reset()
      renderedPathRef.current = relativePath
      translatedWithRef.current = t
    }

    controller.render(decorations)
  }, [editor, relativePath, decorations, t])
}
