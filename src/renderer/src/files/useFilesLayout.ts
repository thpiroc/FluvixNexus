import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFilesViewPreference } from './FilesViewProvider'
import {
  AUTO_LAYOUT_PREFERENCE,
  chooseLayoutMode,
  DEFAULT_LAYOUT_MODE,
  resolveLayoutMode,
  suggestLayoutMode,
  type FilesLayoutMode,
  type FilesLayoutPreference
} from './filesLayoutMode'

/**
 * Files パネルの形を観測して、表示方式（ツリー / カラム）を決める（Session 3-6-7）。
 *
 * 判断そのものは filesLayoutMode.ts の純粋関数が持ち、ここが決めるのは
 * **いつ測るか**だけ（useFileTree.ts が「いつ読むか」だけを持つのと同じ分担）。
 *
 * ## 観測はパネルの器1か所だけ
 *
 * ResizeObserver を張るのは FilesPanel の器1つ。行にも、カラムにも、ツリーにも
 * 張らない ── 中身に張ると、開いた行の数だけ観測対象が増える。
 *
 * ## リサイズで state を書き換えない（提案が変わったときだけ書き換える）
 *
 * 観測した px をそのまま state に入れると、パネルの境界を掴んで動かしている間、
 * 1フレームごとに Files パネル全体が再描画される（ツリーの行は数千になりうる）。
 * ここが state として持つのは `'tree' | 'columns'` の**提案1つ**だけで、
 * 幅・高さは ref に置く。しきい値には遊びがあるため（filesLayoutMode.ts）、
 * この値が変わるのはドラッグ1回につき多くて数回になる。
 *
 * **ファイルツリーのデータはこれに一切触られない。** 表示方式が変わっても
 * `directories` も `expanded` も作り直されない（useFileTree.ts が持ったまま）。
 * ここが返すのは「どちらを、どの幅で描くか」だけにしてある。
 *
 * ## カラムの幅は素通しする（Session 3-6-8）
 *
 * 幅の正本は FilesViewProvider（ディスクにも残る）。ここはそれを**そのまま渡すだけ**で、
 * 保持も判断もしない ── 表示方式と幅は「Files の見え方」という同じ1つのものなので、
 * 使う側（FilesExplorer / FileColumns）が2箇所から受け取る形にしない。
 */
export interface FilesLayoutController {
  /** 今出す表示方式。 */
  readonly mode: FilesLayoutMode
  /** 今のパネルの形が勧める方（ツールバーの案内に使う）。 */
  readonly suggestion: FilesLayoutMode
  /** 利用者が選んだかどうか。 */
  readonly preference: FilesLayoutPreference
  /** 観測する器（Files パネルの一番外側）が自分の DOM 要素を預ける。 */
  readonly registerContainer: (element: HTMLElement | null) => void
  /** 表示方式を選ぶ（以降、リサイズでは変わらなくなる）。 */
  readonly chooseMode: (mode: FilesLayoutMode) => void
  /** パネルの形に任せる状態へ戻す。 */
  readonly followPanelShape: () => void
  /** カラム1枚の幅（px。Session 3-6-8）。 */
  readonly columnWidth: number
  /** カラムの幅を変える（上下限は filesSettings.ts が掛ける）。 */
  readonly setColumnWidth: (width: number) => void
}

export function useFilesLayout(): FilesLayoutController {
  const [suggestion, setSuggestion] = useState<FilesLayoutMode>(DEFAULT_LAYOUT_MODE)

  /*
    **選んだことだけはパネルの外に置く**（FilesViewProvider.tsx）。

    パネルは Dock / Split で動かすと作り直される。選択をここ（パネルと同じ寿命）に
    持つと、置き場所を変えただけで選んだことが消える。反対に、今の形の観測（下）は
    パネルと同じ寿命でよい ── 場所が変われば測り直すのが正しい。
  */
  const { preference, setPreference, columnWidth, setColumnWidth } = useFilesViewPreference()

  /**
   * 今の提案の控え。
   *
   * 観測の中から読む値であり、observer を張り直さずに済ませるために ref で持つ
   * （state だけだと、張った時点の値を見続ける observer になる）。
   */
  const suggestionRef = useRef<FilesLayoutMode>(DEFAULT_LAYOUT_MODE)
  const observerRef = useRef<ResizeObserver | null>(null)

  const measure = useCallback((width: number, height: number): void => {
    const next = suggestLayoutMode(suggestionRef.current, { width, height })

    // 変わらないなら何もしない ── リサイズ中の再描画をここで止める。
    if (next === suggestionRef.current) {
      return
    }

    suggestionRef.current = next
    setSuggestion(next)
  }, [])

  const registerContainer = useCallback(
    (element: HTMLElement | null): void => {
      observerRef.current?.disconnect()

      if (element === null) {
        observerRef.current = null
        return
      }

      /*
        `contentRect` ではなく getBoundingClientRect を初回に使うのは、
        observer の最初の通知が届く前に一度決めておくため（1フレームだけ
        違う表示方式が見えるのを防ぐ）。
      */
      const rect = element.getBoundingClientRect()
      measure(rect.width, rect.height)

      const observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1]

        if (entry !== undefined) {
          measure(entry.contentRect.width, entry.contentRect.height)
        }
      })

      observer.observe(element)
      observerRef.current = observer
    },
    [measure]
  )

  // 破棄されたときに観測を残さない（パネルを閉じる / レイアウトを組み替える）。
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect()
      observerRef.current = null
    }
  }, [])

  const chooseMode = useCallback(
    (mode: FilesLayoutMode): void => {
      setPreference(chooseLayoutMode(mode))
    },
    [setPreference]
  )

  const followPanelShape = useCallback((): void => {
    setPreference(AUTO_LAYOUT_PREFERENCE)
  }, [setPreference])

  const mode = resolveLayoutMode(preference, suggestion)

  return useMemo(
    () => ({
      mode,
      suggestion,
      preference,
      registerContainer,
      chooseMode,
      followPanelShape,
      columnWidth,
      setColumnWidth
    }),
    [
      mode,
      suggestion,
      preference,
      registerContainer,
      chooseMode,
      followPanelShape,
      columnWidth,
      setColumnWidth
    ]
  )
}
