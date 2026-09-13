import { useEffect, useRef } from 'react'
import { useEditorContext } from '../editor/context'
import { useCallStack } from './callStackContext'
import { openCallStackFrame } from './callStackNavigation'
import { resolveExecutionFollowTarget } from './executionLocation'

/**
 * 止まったら、その位置を Editor で開く（Session 6-13）。何も描かない。
 *
 * ## パネルに置かない
 *
 * Debug パネルを閉じていても（Toolbar の command や、6-14 以降の keybinding から
 * 続行 / Step した場合でも）止まった位置へ移れる必要がある。そこで App の
 * CallStackProvider の内側に常に1つだけ置く。
 *
 * ## 開く口は Call Stack の frame を押したときと同じ
 *
 * `openCallStackFrame` → `EditorContext.openFileAt`（Session 6-5）。Workspace の外・位置の無い
 * frame は開かない。Monaco へ直接触る新しい口は作らない。
 *
 * ## 停止ごとに1回だけ
 *
 * 見るのは `snapshot.stop.sequence`（Main が停止ごとに発行する番号）で、snapshot の版ではない。
 * 同じ停止の中の読み直しで引き戻さず、利用者が Call Stack の下の段を選んでも
 * そちらへ動いた Editor を最上段へ戻さない。
 */
export function ExecutionLocationFollower(): null {
  const { snapshot } = useCallStack()
  const editor = useEditorContext()
  const lastFollowedRef = useRef<number | null>(null)
  const editorRef = useRef(editor)

  editorRef.current = editor

  useEffect(() => {
    const target = resolveExecutionFollowTarget(snapshot, lastFollowedRef.current)

    if (target === null) {
      return
    }

    lastFollowedRef.current = target.sequence

    if (target.frame !== null) {
      openCallStackFrame(target.frame, editorRef.current)
    }
  }, [snapshot])

  return null
}
