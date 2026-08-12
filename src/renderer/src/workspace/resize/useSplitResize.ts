import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type { DockNodeId, SplitDirection, WorkspaceLayout } from '../layout/types'
import type { SplitBoundary, SplitResizeState } from './types'

/**
 * 境界のドラッグを受け持つ hook。
 *
 * 責務は「ポインタの移動量を1つのサイズ操作に畳むこと」だけで、レイアウトは書き換えない。
 * 木をどう変えるかは layout/resize.ts の resizeSplitBoundary が決める。
 *
 *   pointerdown … 掴んだ境界と、その両側の実サイズ・開始座標を覚える
 *   pointermove … 開始位置からの累計移動量を渡してレイアウトを更新する
 *   pointerup   … そのまま確定する（移動のたびに反映済み）
 *   Escape / pointercancel / ウィンドウのフォーカス喪失 … 開始前のレイアウトへ戻す
 *
 * **この層が DOM を読むのは pointerdown の一度だけ。** 両側の実サイズが要るのは、
 * 可変領域（size: null）が今どれだけの大きさで表示されているかがレイアウトデータからは
 * 分からないため。読んだ値は操作の入力として渡すだけで、状態としては持たない
 * （＝ React の width / height がレイアウトの正本になることはない）。
 *
 * 移動のたびに前回の結果へ足し込まず、常に「開始時の値 + 累計移動量」で計算するのも同じ理由。
 * 途中の描画結果を読み直さないため、丸めと下限での頭打ちが積み重ならず、
 * 下限に当たった後にカーソルを戻せばそのまま追従する。
 *
 * ドラッグ&ドロップ（dnd/）とは独立していて、互いの状態を参照しない。
 * 掴む対象が別（タブ / 掴み手）で、同時に始まることが無いため。
 */

export interface SplitResizeController {
  /** リサイズ中の状態。していなければ null。 */
  readonly state: SplitResizeState | null
  /** 掴み手から呼ぶ。event.currentTarget は split の子の間に置かれた掴み手であること。 */
  readonly beginResize: (boundary: SplitBoundary, event: ReactPointerEvent) => void
}

export interface SplitResizeOptions {
  readonly layout: WorkspaceLayout
  readonly resizeSplit: (
    splitId: DockNodeId,
    index: number,
    startSizes: readonly [number, number],
    delta: number
  ) => void
  /** キャンセル時に開始前のレイアウトへ戻すために使う。 */
  readonly replaceLayout: (layout: WorkspaceLayout) => void
}

/** ドラッグ中ずっと変わらない値。掴んだ瞬間に確定する。 */
interface ResizeGesture {
  readonly boundary: SplitBoundary
  readonly pointerId: number
  /** 並び方向の開始座標。row なら clientX、column なら clientY。 */
  readonly origin: number
  readonly startSizes: readonly [number, number]
  /** キャンセルで戻す先。 */
  readonly snapshot: WorkspaceLayout
}

export function useSplitResize({
  layout,
  resizeSplit,
  replaceLayout
}: SplitResizeOptions): SplitResizeController {
  const [state, setState] = useState<SplitResizeState | null>(null)
  const gesture = useRef<ResizeGesture | null>(null)

  // window のリスナーは張り直さないため、最新のレイアウトと操作を ref 越しに見る。
  const latest = useRef({ layout, resizeSplit, replaceLayout })

  useEffect(() => {
    latest.current = { layout, resizeSplit, replaceLayout }
  }, [layout, resizeSplit, replaceLayout])

  const endGesture = useCallback((): void => {
    gesture.current = null
    setState(null)
  }, [])

  const beginResize = useCallback((boundary: SplitBoundary, event: ReactPointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary || gesture.current !== null) {
      return
    }

    const startSizes = measureNeighbours(event.currentTarget, boundary.direction)

    if (startSizes === null) {
      return
    }

    gesture.current = {
      boundary,
      pointerId: event.pointerId,
      origin: pointerPosition(event, boundary.direction),
      startSizes,
      snapshot: latest.current.layout
    }

    // 領域の外・ウィンドウの外へカーソルが出てもリサイズを続けられるようにする。
    // 掴み手は数 px しかないため、これが無いと少し速く動かしただけで外れる。
    event.currentTarget.setPointerCapture(event.pointerId)
    // 掴み手の上でのドラッグが文字選択やフォーカス移動にならないようにする。
    event.preventDefault()

    setState({ boundary })
  }, [])

  useEffect(() => {
    if (state === null) {
      return
    }

    const handleMove = (event: PointerEvent): void => {
      const current = gesture.current

      if (current === null || event.pointerId !== current.pointerId) {
        return
      }

      const delta = pointerPosition(event, current.boundary.direction) - current.origin

      latest.current.resizeSplit(
        current.boundary.splitId,
        current.boundary.index,
        current.startSizes,
        delta
      )
    }

    const handleUp = (event: PointerEvent): void => {
      if (gesture.current === null || event.pointerId !== gesture.current.pointerId) {
        return
      }

      // 移動のたびにレイアウトへ反映済みなので、確定は「やめるだけ」でよい。
      endGesture()
    }

    const cancel = (): void => {
      const current = gesture.current

      if (current === null) {
        return
      }

      endGesture()
      latest.current.replaceLayout(current.snapshot)
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        cancel()
      }
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [state, endGesture])

  return { state, beginResize }
}

function pointerPosition(
  event: { readonly clientX: number; readonly clientY: number },
  direction: SplitDirection
): number {
  return direction === 'row' ? event.clientX : event.clientY
}

/**
 * 掴み手の両隣の領域が、今どれだけの大きさで表示されているかを測る。
 *
 * 掴み手は split の子と子の間に置かれた要素なので、両隣がそのまま対象の2領域になる
 * （どちらかが欠けている＝掴み手が想定外の場所にあるので、その場合は何もしない）。
 */
function measureNeighbours(
  handle: Element,
  direction: SplitDirection
): readonly [number, number] | null {
  const leading = handle.previousElementSibling
  const trailing = handle.nextElementSibling

  if (leading === null || trailing === null) {
    return null
  }

  const sizeOf = (element: Element): number => {
    const rect = element.getBoundingClientRect()

    return direction === 'row' ? rect.width : rect.height
  }

  return [sizeOf(leading), sizeOf(trailing)]
}
