import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type { FileEntry } from '@shared/files'
import {
  canDragEntry,
  dragModeFor,
  resolveDropDestination,
  type FilesDragMode,
  type FilesDropZone
} from './dragDrop'
import { computeAutoScrollDelta } from './filesAutoScroll'

/**
 * Files ツリーの中のドラッグ&ドロップを受け持つ hook。
 *
 * 責務は「マウス操作を1つの行き先に畳むこと」だけで、ファイルは動かさない。
 * ドロップが確定したら `onDrop` を呼ぶところで手を離し、実際の移動 / コピーは
 * 既存の `files:move` / `files:copy`（Session 3-6-1 / 3-6-2）がそのまま行う。
 * Workspace Shell の usePanelDrag.ts と同じ分担で、判断は dragDrop.ts に置いてある。
 *
 *   pointerdown … 掴んだものを覚える（まだドラッグではない）
 *   pointermove … しきい値を超えたらドラッグ開始。以降は当たり判定して行き先を更新する
 *   pointerup   … 離した位置から行き先を求め直し、落とせるなら onDrop を呼ぶ
 *   Ctrl の押し下げ / 離し … 移動とコピーを切り替える（離した瞬間の状態が使われる）
 *   Escape / pointercancel / ウィンドウのフォーカス喪失 … 何もせず終了する
 *
 * ## ポインタイベントを使う（HTML5 の Drag and Drop API を使わない）
 *
 * Workspace Shell と同じ選択で、理由も重なる（ARCHITECTURE.md §7.5）。
 *
 *   - ドラッグ中の見た目を自前で描くため、既定のドラッグ画像が邪魔になる
 *   - Escape / 途中のキャンセルの扱いをブラウザ実装差に依存せず決められる
 *   - 運ぶのが FileEntry 1つで、DataTransfer に積む必要が無い（Files パネルの中だけの操作。
 *     エクスプローラとの受け渡しは Workspace の境界を通す別の話になる。clipboard.ts）
 *   - **ドライバから素直に再現できる**（`mouse.move` の座標がそのまま判定に入る。
 *     docs/DEVELOPMENT.md §4）。HTML5 の DnD は自動確認から動かせない
 *
 * ## DOM を読むのはここだけ
 *
 * カーソルの下にある行を探すのに `elementFromPoint` を使う。行を1つずつ
 * `getBoundingClientRect` で当たり判定しない理由は、行が数百〜数千になりうるうえ、
 * pointermove ごとに全行の矩形を測ると読み取りだけで描画が詰まるため。
 * 「今どこを指しているか」を知るためだけに使い、ツリーの正本（useFileTree.ts が持つ状態）を
 * DOM から作り直すことはしない。
 *
 * ## 縁に運ぶと中身が流れる（自動スクロール。Session 3-6-8）
 *
 * Session 3-6-3 の時点では、行き先が画面の外にあると**いったん離して掴み直す**しか
 * なかった。深いツリーでは1回の移動に何度も掴み直しが要り、「離すまでが1つ」という
 * ドラッグの形と食い違っていた。
 *
 * 動かすのは**カーソルの下にある、実際にスクロールできる器**で、軸ごとに別々に探す
 * ── カラム表示では横が器（`.fx-files__columns`）・縦がカラムの中
 * （`.fx-file-column__body`）になる。表示方式ごとの分岐を持たずに済むよう、
 * 器の名前ではなく**スクロールできるかどうか**で選ぶ。
 *
 * どれだけ動かすかは filesAutoScroll.ts（純粋関数）が決める。ここが持つのは
 * 「いつ・どの要素に当てるか」だけで、判断は持たない。
 */

/** ここを超えて動いたらドラッグとみなす。行のクリック（開く / 開閉）と取り違えないための遊び。 */
const DRAG_THRESHOLD_PX = 4

/** カーソルから小さな表示をずらす量（px）。CSS 側の transform と揃える。 */
const BADGE_GAP_PX = 12

/** ドラッグ中の状態。ドラッグしていない間は null。 */
export interface FileDragState {
  /** 掴んでいるもの。 */
  readonly source: FileEntry
  /** 今このまま離した場合に起きること（Ctrl で切り替わる）。 */
  readonly mode: FilesDragMode
  /**
   * 今指している場所。行き先になれない場所（ファイル行・ツリーの外）にいる間は null。
   *
   * ガイドをどこに出すか（フォルダ行 / ツリーの余白）はこれで決まる。
   */
  readonly zone: FilesDropZone | null
  /** 落とせるならその行き先。**null のときはドロップ可能な見た目を出さない。** */
  readonly destination: string | null
}

export interface FileDragController {
  readonly state: FileDragState | null
  /** 行の pointerdown から呼ぶ。掴めないもの（Workspace root）では何も起きない。 */
  readonly beginDrag: (entry: FileEntry, event: ReactPointerEvent) => void
  /**
   * 行が並ぶ器が自分の DOM 要素を預ける。当たり判定の範囲になる。
   *
   * ツリーならツリー、カラム表示ならカラムを横に並べた器（Session 3-6-7）。
   * **同時に預かるのは1つだけ**で、表示方式は片方しか描かれない
   * （FilesExplorer.tsx が出し分ける）。
   */
  readonly registerSurface: (element: HTMLElement | null) => void
  /** ドラッグ中の小さな表示が自分の DOM 要素を預ける。位置はここが直接書き込む。 */
  readonly registerBadge: (element: HTMLElement | null) => void
  /**
   * 直前の操作がドラッグだったか（行のクリックを無視するために見る）。
   *
   * ポインタを離すと、ドラッグの後にも `click` が続く。見なければ
   * **ドロップと同時にファイルが開く / フォルダが開閉する**ことになる。
   * 次に何かを掴んだ時点で false へ戻るため、呼ぶ側で戻す必要はない。
   */
  readonly justDragged: () => boolean
}

export interface FileDragOptions {
  /**
   * 落とせる場所で離したときに呼ばれる。
   *
   * 行き先は**離した瞬間の位置と Ctrl の状態**から求め直したもので、
   * 表示のために持っていた値ではない（usePanelDrag.ts と同じ）。
   */
  readonly onDrop: (source: FileEntry, destinationRelativePath: string, mode: FilesDragMode) => void
}

/** しきい値を超えるまでの、ドラッグになるかもしれない操作。 */
interface PendingGesture {
  readonly entry: FileEntry
  readonly pointerId: number
  readonly originX: number
  readonly originY: number
}

export function useFileDrag({ onDrop }: FileDragOptions): FileDragController {
  const [state, setState] = useState<FileDragState | null>(null)
  // window のリスナーを張るかどうかだけを state で持つ（張り直しを最小限にするため）。
  const [gestureActive, setGestureActive] = useState(false)

  const surfaceElement = useRef<HTMLElement | null>(null)
  const badgeElement = useRef<HTMLElement | null>(null)
  const gesture = useRef<PendingGesture | null>(null)
  const dragging = useRef(false)
  /** 直前の操作がドラッグだったか（justDragged が読む）。 */
  const dragged = useRef(false)
  /** 最後に見たカーソルの位置。Ctrl の切り替えでも同じ位置で求め直すために持つ。 */
  const point = useRef({ x: 0, y: 0 })
  /**
   * 最後に見た Ctrl の状態（自動スクロールの後に行き先を求め直すために持つ）。
   *
   * カーソルが止まったまま中身だけが流れるため、そのときの mode をイベントから
   * 取り直すことができない。
   */
  const mode = useRef<FilesDragMode>('move')
  /** 自動スクロールのループ。動いていない間は 0。 */
  const autoScrollFrame = useRef(0)

  // window のリスナーは張り直さないため、最新の呼び出し先を ref 越しに見る。
  const latest = useRef({ onDrop })

  useEffect(() => {
    latest.current = { onDrop }
  }, [onDrop])

  const registerSurface = useCallback((element: HTMLElement | null): void => {
    surfaceElement.current = element
  }, [])

  /**
   * 小さな表示をカーソルの位置へ置く。
   *
   * **位置だけは React の state に入れない。** ドラッグ中の座標は pointermove ごとに
   * 変わるため、state にすると数百行のツリーごと毎回再描画することになる。
   * 行き先が変わったときだけ再描画し（下の update）、座標はここで直接書き込む。
   */
  const placeBadge = useCallback((): void => {
    const element = badgeElement.current

    if (element === null) {
      return
    }

    element.style.left = `${point.current.x}px`
    element.style.top = `${point.current.y}px`
    // 右端では左側へ回す（画面の外に出ると、何を運んでいるかが読めなくなる）。
    element.dataset.flip =
      point.current.x + element.offsetWidth + BADGE_GAP_PX > window.innerWidth ? 'true' : 'false'
  }, [])

  const registerBadge = useCallback(
    (element: HTMLElement | null): void => {
      badgeElement.current = element

      // 出てきた時点で置く（state に座標を持たないため、初回はここで決まる）。
      if (element !== null) {
        placeBadge()
      }
    },
    [placeBadge]
  )

  /**
   * カーソルの下にある「行き先になれる場所」を探す。
   *
   * 器の外・ファイル行・名前を打っている行・状況を伝える行では null を返す
   * （＝落とせない）。**ファイル行をその親フォルダへ読み替えない**理由は dragDrop.ts に。
   *
   * 行が無いところ（余白）は、その余白を持つ面が受け持つフォルダになる
   * ── `data-drop-surface` を持つ一番内側の要素が答える。ツリーでは器そのものが
   * Workspace root を受け持ち、カラム表示ではカラムごとに自分のフォルダを持つ
   * （Session 3-6-7）。表示方式ごとの分岐をここに書かずに済む。
   */
  const findZone = useCallback((x: number, y: number): FilesDropZone | null => {
    const surface = surfaceElement.current

    if (surface === null) {
      return null
    }

    const rect = surface.getBoundingClientRect()

    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      return null
    }

    /*
      ドラッグ中の小さな表示は pointer-events: none にしてあるため、
      ここには出てこない（files.css）。ガイドが自分の当たり判定を奪わないことは、
      表示の都合ではなくこの探索が成立するための条件にあたる。
    */
    const element = document.elementFromPoint(x, y)

    if (element === null || !surface.contains(element)) {
      return null
    }

    const row = element.closest('.fx-file-row')

    if (row !== null) {
      // 名前を打っている行（作成 / リネーム）は行き先にしない。
      if (row.getAttribute('data-draft') !== null) {
        return null
      }

      if (row.getAttribute('data-type') !== 'directory') {
        return null
      }

      const relativePath = row.getAttribute('data-relative-path')

      return relativePath === null ? null : { kind: 'directory', relativePath }
    }

    // 状況を伝える行（読み込み中 / 空 / 打ち切り / 失敗）はフォルダ行ではない。
    if (element.closest('.fx-file-note') !== null) {
      return null
    }

    const area = element.closest('[data-drop-surface]')
    const relativePath = area?.getAttribute('data-drop-surface')

    return relativePath === null || relativePath === undefined
      ? null
      : { kind: 'surface', relativePath }
  }, [])

  /** 今の位置と Ctrl の状態から、ドラッグ中の状態を作り直す（変わっていなければ据え置く）。 */
  const update = useCallback(
    (source: FileEntry, mode: FilesDragMode): void => {
      const zone = findZone(point.current.x, point.current.y)
      const destination = resolveDropDestination(source, zone, mode)

      setState((previous) => {
        if (
          previous !== null &&
          previous.source === source &&
          previous.mode === mode &&
          previous.destination === destination &&
          isSameZone(previous.zone, zone)
        ) {
          return previous
        }

        return { source, mode, zone, destination }
      })
    },
    [findZone]
  )

  /**
   * カーソルの下にある器を、必要なら1フレーム分だけ動かす。動かしたら true。
   *
   * 探し方は当たり判定と同じで、**カーソルの下から器まで遡る**。軸ごとに
   * 最初に見つかった「その向きへスクロールできる要素」に当てるため、
   * カラム表示では縦がカラムの中・横が器、ツリーでは縦が器そのものになる
   * ── 表示方式ごとの分岐をここに書かずに済む。
   */
  const autoScroll = useCallback((): boolean => {
    const surface = surfaceElement.current

    if (surface === null) {
      return false
    }

    const element = document.elementFromPoint(point.current.x, point.current.y)

    if (element === null || !surface.contains(element)) {
      return false
    }

    let moved = false
    let scrolledX = false
    let scrolledY = false
    let node: Element | null = element

    while (node !== null) {
      const delta = computeAutoScrollDelta(node.getBoundingClientRect(), point.current)

      if (!scrolledY && delta.y !== 0 && node.scrollHeight > node.clientHeight) {
        const before = node.scrollTop

        node.scrollTop = before + delta.y
        scrolledY = true
        // 端まで来ていれば値は変わらない（＝求め直す必要も無い）。
        moved = moved || node.scrollTop !== before
      }

      if (!scrolledX && delta.x !== 0 && node.scrollWidth > node.clientWidth) {
        const before = node.scrollLeft

        node.scrollLeft = before + delta.x
        scrolledX = true
        moved = moved || node.scrollLeft !== before
      }

      if (node === surface) {
        break
      }

      node = node.parentElement
    }

    return moved
  }, [])

  const stopAutoScroll = useCallback((): void => {
    if (autoScrollFrame.current !== 0) {
      window.cancelAnimationFrame(autoScrollFrame.current)
      autoScrollFrame.current = 0
    }
  }, [])

  /**
   * 自動スクロールを回し始める（ドラッグが成立した時点。掴んだだけでは回さない）。
   *
   * **pointermove ではなくフレームで回す。** カーソルを縁で止めたまま流れ続ける
   * 必要があるため、動きの通知に紐づけると止めた瞬間に流れが止まる。
   *
   * 中身が流れるとカーソルの下にあるものが変わるので、動かした後は行き先を求め直す
   * ── これをしないと、案内（ハイライト）が流れる前の行を指したまま残る。
   */
  const startAutoScroll = useCallback((): void => {
    if (autoScrollFrame.current !== 0) {
      return
    }

    const step = (): void => {
      autoScrollFrame.current = window.requestAnimationFrame(step)

      const current = gesture.current

      if (current === null || !dragging.current) {
        return
      }

      if (autoScroll()) {
        update(current.entry, mode.current)
      }
    }

    autoScrollFrame.current = window.requestAnimationFrame(step)
  }, [autoScroll, update])

  const endGesture = useCallback((): void => {
    stopAutoScroll()
    gesture.current = null
    dragging.current = false
    badgeElement.current = null
    setGestureActive(false)
    setState(null)
  }, [stopAutoScroll])

  const beginDrag = useCallback((entry: FileEntry, event: ReactPointerEvent): void => {
    /*
      新しい操作が始まった時点で、前の操作がドラッグだったことは忘れる。
      これで justDragged が古い操作の答えを返すことがなくなる（キャンセルで
      終わったドラッグの後に、次のクリックが飲み込まれない）。
    */
    dragged.current = false

    if (event.button !== 0 || !event.isPrimary || gesture.current !== null) {
      return
    }

    // Workspace root は掴めない（dragDrop.ts）。
    if (!canDragEntry(entry)) {
      return
    }

    gesture.current = {
      entry,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY
    }
    dragging.current = false
    point.current = { x: event.clientX, y: event.clientY }
    mode.current = dragModeFor(event)

    /*
      ウィンドウの外へカーソルが出ても pointerup を取りこぼさないようにする
      （取りこぼすとドラッグ状態のまま戻れなくなる）。掴んだ行がドロップの結果で
      消えても、リスナーは window 側にあるため取りこぼしにはならない。
    */
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
        dragged.current = true
        // 掴んだだけでは回さない（クリックのつもりの操作で中身が流れない）。
        startAutoScroll()
      }

      point.current = { x: event.clientX, y: event.clientY }
      mode.current = dragModeFor(event)
      placeBadge()
      update(current.entry, mode.current)
    }

    /*
      Ctrl の押し下げ / 離しでも作り直す。マウスを動かさずに Ctrl を押しただけで
      コピーへ切り替わることを、案内（ハイライトと小さな表示）にも反映させるため
      ── 実際に使われるのは離した瞬間の状態なので、切り替えが見えないと
      「移動のつもりでコピーした」が起きる。
    */
    const handleModifier = (event: KeyboardEvent): void => {
      const current = gesture.current

      if (current === null || !dragging.current) {
        return
      }

      mode.current = dragModeFor(event)
      update(current.entry, mode.current)
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

      // 表示用に持っていた値ではなく、離した位置と Ctrl の状態から求め直す。
      const destination = resolveDropDestination(
        current.entry,
        findZone(event.clientX, event.clientY),
        dragModeFor(event)
      )

      if (destination === null) {
        return
      }

      latest.current.onDrop(current.entry, destination, dragModeFor(event))
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        endGesture()

        return
      }

      handleModifier(event)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', endGesture)
    window.addEventListener('blur', endGesture)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleModifier)

    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', endGesture)
      window.removeEventListener('blur', endGesture)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleModifier)
      // 途中で捨てられても（パネルを閉じる / 組み替える）ループを残さない。
      stopAutoScroll()
    }
  }, [gestureActive, endGesture, findZone, placeBadge, update, startAutoScroll, stopAutoScroll])

  const justDragged = useCallback((): boolean => dragged.current, [])

  return { state, beginDrag, registerSurface, registerBadge, justDragged }
}

/** 指している場所が同じか（同じなら再描画しない）。 */
function isSameZone(a: FilesDropZone | null, b: FilesDropZone | null): boolean {
  if (a === null || b === null) {
    return a === b
  }

  if (a.kind !== b.kind) {
    return false
  }

  return a.kind !== 'directory' || b.kind !== 'directory' || a.relativePath === b.relativePath
}
