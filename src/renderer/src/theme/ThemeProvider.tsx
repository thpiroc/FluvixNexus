import type { JSX, ReactNode } from 'react'
import { ThemeContext } from './context'
import { applyDocumentTheme } from './documentTheme'
import { useAppearance } from './useAppearance'

/**
 * Theme を `<html>` へ当て、Renderer 全体へ配る（Session 4-4）。
 *
 * ## 置き場所は一番外側
 *
 * App.tsx の Provider の中で最も外に置く。Theme はどのパネルのものでもなく、
 * **未保存の確認ダイアログにも Workspace を開く前の画面にも効く**必要がある
 * ── Shell の中に置くと、レイアウトの都合でパネルが作り直されるたびに
 * Theme の読み込みからやり直すことになる。
 *
 * ## 当てるのが effect ではない理由
 *
 * `data-fx-theme` の代入を `useEffect` に置くと**間に合わない。**
 * React の effect は**子から先に**走るため、
 *
 * ```
 * ThemeProvider の effect  … data-fx-theme を light にする   ← 後
 *   MonacoEditor の effect … CSS 変数を読んでテーマを作る    ← 先（まだ dark を読む）
 *   useTerminalTabs の effect … 同上                          ← 先
 * ```
 *
 * となり、Monaco と xterm が**1つ前の Theme の色**を読む。`useLayoutEffect` に
 * しても順序は変わらない（子が先）。
 *
 * そこで**描画の中で当てる。** 代入は冪等で（同じなら何もしない。
 * documentTheme.ts）、当たった時点で `getComputedStyle` は新しい値を返すため、
 * この後に走る子の effect はどれも正しい色を読む。
 *
 * 描画中に DOM を触るのは普通は避けるべきことだが、`<html>` の属性は
 * **React が管理していない場所**にあたる ── React が作った要素を書き換えている
 * わけではないので、React の再描画と競合しない。
 *
 * ## ここが配るのは値だけ
 *
 * Monaco も xterm も「Theme が変わった」ことをここから知らされるのではなく、
 * `useTheme()` の値が変わったことを自分の effect で見て当て直す
 * （editor/monaco/MonacoEditor.tsx ・terminal/useTerminalTabs.ts）。
 * この向きにしてあるのは、**Theme の側が道具の一覧を持たない**ようにするため
 * ── 持たせると、道具が増えるたびにここを直すことになる。
 */
export function ThemeProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const controller = useAppearance()

  /*
    描画のたびに当て直す（同じなら何もしない）。effect にしない理由は上記。

    起動直後にも1度通るが、そのときには Preload が既に同じ値を当てている
    （preload/theme.ts）── ここが最初の1回になることは無く、
    **Light を選んでいる人に Dark が一瞬見えることも無い。**
  */
  applyDocumentTheme(controller.settings.theme)

  return <ThemeContext.Provider value={controller}>{children}</ThemeContext.Provider>
}
