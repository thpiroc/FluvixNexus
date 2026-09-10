import { useEffect, useMemo, useRef } from 'react'
import { useBreakpoints } from '../../debug/context'
import { useI18n } from '../../i18n/context'
import { toBreakpointGlyphDecorations } from './breakpointDecorations'
import {
  createBreakpointGlyphController,
  type BreakpointGlyphController,
  type BreakpointGlyphEditor
} from './breakpointGlyphs'

/**
 * Monaco の glyph margin に breakpoint の印を出す（Session 6-3）。
 *
 * ```
 * debug/BreakpointProvider.tsx   今の Workspace の全件（Main の写し）
 *    ↓
 * ここ                            今出ているファイルのぶんだけを取り出して当てる
 *    ↓
 * editor/debug/breakpointGlyphs.ts   Monaco の decoration と mouse の購読
 * ```
 *
 * ## MonacoEditor.tsx への追加は3行で済む
 *
 * Session 6-0 の調査で、`MonacoEditor.tsx` は今後いくつもの Session が触る
 * 横断ファイルになることが分かっている（DESIGN.md §13）。そこで判断は
 * すべてこちら側へ寄せ、あちらに残るのは
 *
 *   - このフックを呼ぶ1行
 *   - 器の参照を state に載せる（印は器が生まれてから当てる）
 *   - `MouseTargetType` の値を渡す（Monaco の enum を持てるのはあちらだけ）
 *
 * だけになる。**LSP の provider 登録にも decoration にも触れない。**
 *
 * ## 印は器より短く生きる
 *
 * decoration も mouse の購読もエディタに紐づくため、器が作り直されれば
 * 一緒に捨てて張り直す。**印そのものは Main が持っている**ので、
 * パネルを閉じても開き直しても消えない（debug/context.ts）。
 *
 * ## ファイルを切り替えたら、必ず当て直す
 *
 * Model を差し替えると decoration は付いてこない。切り替えを見て `reset` してから
 * 当て直すことで、**前のファイルの行に印が残る**ことも、切り替え先で
 * 印が出ないままになることも起きない。
 */
export function useBreakpointGlyphs(
  editor: BreakpointGlyphEditor | null,
  glyphMarginTargetType: number,
  relativePath: string
): void {
  const { breakpoints, toggle } = useBreakpoints()
  const { t } = useI18n()

  const controllerRef = useRef<BreakpointGlyphController | null>(null)
  const renderedPathRef = useRef<string | null>(null)

  /*
    描画のたびに最新を控える。押されたのも編集も React の描画とは別の時間軸で
    走るため、そこから読むのは state ではなく ref にする（useEditorSession.ts と
    同じ形）── 控えないと、ファイルを切り替えるたびに購読を張り直すことになる。
  */
  const relativePathRef = useRef(relativePath)
  const toggleRef = useRef(toggle)
  const translateRef = useRef(t)

  relativePathRef.current = relativePath
  toggleRef.current = toggle
  translateRef.current = t

  useEffect(() => {
    if (editor === null) {
      return
    }

    const controller = createBreakpointGlyphController(editor, {
      glyphMarginTargetType,
      onToggle: (line) => {
        toggleRef.current(relativePathRef.current, line)
      },
      describe: (decoration) => translateRef.current(decoration.messageKey)
    })

    controllerRef.current = controller
    renderedPathRef.current = null

    return () => {
      controllerRef.current = null
      renderedPathRef.current = null
      controller.dispose()
    }
  }, [editor, glyphMarginTargetType])

  const decorations = useMemo(
    () => toBreakpointGlyphDecorations(breakpoints, relativePath),
    [breakpoints, relativePath]
  )

  /*
    **器を作る effect より後に置いてある**のが要点。React は宣言した順に effect を
    走らせるため、器が生まれた直後の描画でも「張る → 当てる」の順が保たれる
    （位置を見せる effect を Model の後に置いてあるのと同じ理由。MonacoEditor.tsx）。
  */
  useEffect(() => {
    const controller = controllerRef.current

    if (controller === null) {
      return
    }

    if (renderedPathRef.current !== relativePath) {
      controller.reset()
      renderedPathRef.current = relativePath
    }

    controller.render(decorations)
  }, [editor, relativePath, decorations, t])
}
