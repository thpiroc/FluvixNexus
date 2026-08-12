import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type { DockTarget } from '../layout/operations'
import type { DockNodeId, WorkspaceLayout } from '../layout/types'
import type { PanelId } from '../panels/types'
import { resolveDockZone } from './dockGuide'
import { collectDroppableGroupIds, resolveDropCandidate } from './dropTarget'
import type { DropCandidate, PanelDragState } from './types'

/**
 * パネルのドラッグを受け持つ hook。
 *
 * 責務は「マウス操作を1つのドロップ候補に畳むこと」だけで、レイアウトは書き換えない。
 * ドロップが確定したら movePanel を呼ぶところで手を離し、木をどう変えるかは layout/ が決める。
 *
 *   pointerdown … 掴んだパネルを覚える（まだドラッグではない）
 *   pointermove … しきい値を超えたらドラッグ開始。以降は当たり判定して候補を更新する
 *   pointerup   … その位置の候補をもう一度求め、落とせるなら movePanel を呼ぶ
 *   Escape / pointercancel / ウィンドウのフォーカス喪失 … 何もせず終了する
 *
 * ポインタイベントを使い、HTML5 の Drag and Drop API を使っていない理由:
 *   - ドラッグ中の見た目（ガイド・プレビュー）を自前で描くため、既定のドラッグ画像が邪魔になる
 *   - Escape / 途中のキャンセルの扱いを、ブラウザ実装差に依存せず自分で決められる
 *   - DataTransfer に文字列を積む必要が無い（運ぶのは PanelId 1つで、状態として持てば足りる）
 *
 * 領域の当たり判定には DOM の矩形（getBoundingClientRect）を使うが、
 * これは「今どこを指しているか」を知るためだけであり、レイアウトの正本はあくまで
 * WorkspaceLayout の側にある。DOM から読んだ位置をレイアウトに書き戻すことはしない。
 */

/** ここを超えて動いたらドラッグとみなす。タブのクリックと取り違えないための遊び。 */
const DRAG_THRESHOLD_PX = 4

export interface PanelDragController {
  /** ドラッグ中の状態。ドラッグしていなければ null。 */
  readonly state: PanelDragState | null
  /** タブなどのドラッグ開始点から呼ぶ。 */
  readonly beginDrag: (panelId: PanelId, event: ReactPointerEvent) => void
  /** Dock 領域が自分の DOM 要素を預ける。当たり判定の対象になる。 */
  readonly registerDockArea: (groupId: DockNodeId, element: HTMLElement | null) => void
}

export interface PanelDragOptions {
  readonly layout: WorkspaceLayout
  readonly movePanel: (panelId: PanelId, target: DockTarget) => void
}

/** しきい値を超えるまでの、ドラッグになるかもしれない操作。 */
interface PendingGesture {
  readonly panelId: PanelId
  readonly pointerId: number
  readonly originX: number
  readonly originY: number
}

export function usePanelDrag({ layout, movePanel }: PanelDragOptions): PanelDragController {
  const [state, setState] = useState<PanelDragState | null>(null)
  // window のリスナーを張るかどうかだけを state で持つ（張り直しを最小限にするため）。
  const [gestureActive, setGestureActive] = useState(false)

  const areas = useRef(new Map<DockNodeId, HTMLElement>())
  const gesture = useRef<PendingGesture | null>(null)
  const dragging = useRef(false)
  const droppable = useRef<ReadonlySet<DockNodeId>>(new Set())

  // window のリスナーは張り直さないため、最新のレイアウトと操作を ref 越しに見る。
  const latest = useRef({ layout, movePanel })

  useEffect(() => {
    latest.current = { layout, movePanel }
  }, [layout, movePanel])

  const registerDockArea = useCallback((groupId: DockNodeId, element: HTMLElement | null): void => {
    if (element === null) {
      areas.current.delete(groupId)

      return
    }

    areas.current.set(groupId, element)
  }, [])

  /**
   * カーソルの下にある領域を探し、そこへ落とした場合の候補を返す。
   *
   * 領域どうしは重ならない（木の葉は画面上で排他）ため、最初に見つかったものが答え。
   */
  const findCandidate = useCallback(
    (panelId: PanelId, x: number, y: number): DropCandidate | null => {
      for (const [groupId, element] of areas.current) {
        const zone = resolveDockZone(element.getBoundingClientRect(), { x, y })

        if (zone === null) {
          continue
        }

        return resolveDropCandidate(latest.current.layout, panelId, groupId, zone)
      }

      return null
    },
    []
  )

  const endGesture = useCallback((): void => {
    gesture.current = null
    dragging.current = false
    setGestureActive(false)
    setState(null)
  }, [])

  const beginDrag = useCallback((panelId: PanelId, event: ReactPointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary || gesture.current !== null) {
      return
    }

    gesture.current = {
      panelId,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY
    }
    dragging.current = false

    // ウィンドウの外へカーソルが出ても pointerup を取りこぼさないようにする
    // （取りこぼすとドラッグ状態のまま戻れなくなる）。
    event.currentTarget.setPointerCapture(event.pointerId)
    setGestureActive(true)
  }, [])

  useEffect(() => {
    if (!gestureActive) {
      return
    }

    const handleMove = (event: PointerEvent): void => {
      const current = gesture.current

      if (current === null || event.pointerId !== current.pointerId) {
        return
      }

      if (!dragging.current) {
        const moved = Math.hypot(event.clientX - current.originX, event.clientY - current.originY)

        if (moved < DRAG_THRESHOLD_PX) {
          return
        }

        dragging.current = true
        // ドラッグ中にレイアウトは変わらないため、受け入れ先はここで一度だけ求める。
        droppable.current = collectDroppableGroupIds(latest.current.layout, current.panelId)
      }

      const over = findCandidate(current.panelId, event.clientX, event.clientY)

      setState((previous) => {
        if (previous !== null && isSameCandidate(previous.over, over)) {
          return previous
        }

        return { panelId: current.panelId, droppableGroupIds: droppable.current, over }
      })
    }

    const handleUp = (event: PointerEvent): void => {
      const current = gesture.current

      if (current === null || event.pointerId !== current.pointerId) {
        return
      }

      const wasDragging = dragging.current

      endGesture()

      if (!wasDragging) {
        return
      }

      // 表示用に持っていた候補ではなく、離した位置から求め直す。
      const over = findCandidate(current.panelId, event.clientX, event.clientY)

      if (over === null || over.target === null) {
        return
      }

      latest.current.movePanel(current.panelId, over.target)
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        endGesture()
      }
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', endGesture)
    window.addEventListener('blur', endGesture)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', endGesture)
      window.removeEventListener('blur', endGesture)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [gestureActive, endGesture, findCandidate])

  return { state, beginDrag, registerDockArea }
}

/**
 * 表示が変わらない移動では state を据え置く。
 *
 * 候補は（レイアウト, パネル, 領域, 方向）から決まり、ドラッグ中に変わるのは後ろ2つだけ。
 * そのためこの2つが同じなら target も同じで、再描画する意味が無い。
 */
function isSameCandidate(a: DropCandidate | null, b: DropCandidate | null): boolean {
  if (a === null || b === null) {
    return a === b
  }

  return a.groupId === b.groupId && a.zone === b.zone
}
