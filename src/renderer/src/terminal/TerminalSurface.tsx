import { useEffect, useRef, type JSX } from 'react'
import { useTerminal } from './context'
import { terminalFontSizeCommand } from './terminalDisplay'
import { createTerminalScreen } from './xtermSetup'

/**
 * 画面を置く器（**遅延して読み込まれる**側）。
 *
 * xterm の実体を値として import しているのはこのファイルと xtermSetup.ts だけで、
 * 呼ぶ側（TerminalView.tsx）が `React.lazy` で包む。理由は Monaco と同じ2つ
 * （editor/EditorDocumentView.tsx）。
 *
 *   - 起動を xterm の大きさに引きずられない。Terminal パネルを開くまで要らない
 *   - **Panel Registry を辿るだけで xterm が読み込まれない。** レイアウトの
 *     純粋なロジックを試すテスト（node 環境）は Registry 経由でここまで辿り着く
 *
 * ## ここがするのは「場所を1つ用意する」ことだけ
 *
 * 画面（xterm のインスタンスとその DOM）を持っているのはストアで、
 * この器は**それを自分の中へ引き取る**。パネルを閉じたり動かしたりすると
 * この器は React に捨てられるが、画面は捨てられない
 * （terminalScreenStore.ts の冒頭）。
 *
 * ```
 * 器が現れる  → ストアから画面を受け取る → 自分の中へ入れる → 測る → 立てる / 伝える
 * 器が消える  → 画面を器から外すだけ（画面はストアに残る）
 * ```
 *
 * ## 器は1つ。中身をタブごとに付け替える（Session 3-7-2）
 *
 * 複数タブになっても器は増やさない。**手前のタブの画面だけを付け替える。**
 * タブごとに器を並べて隠す形にすると、隠れている器は大きさが 0 になり、
 * 出す / 隠すたびに測り直しが要る。ストアは元々
 * 「自前の要素を器から器へ付け替える」形で書かれている
 * （terminalScreenStore.ts）ので、切り替えはその経路をそのまま使う。
 *
 * 外すのが `terminalId` が変わったときの後片付けにあたる。前は器ごと
 * React に捨てられていたので外す必要が無かったが、今は器が残るため、
 * **外さないと前のタブの画面が下に残る。**
 *
 * ## 測るのは器、決めるのは xterm
 *
 * 大きさの単位は文字数であってピクセルではない。器の px から桁数を出せるのは
 * 実際の文字の幅を知っている xterm だけなので、測るのは `screen.fit()` に任せ、
 * ここは**いつ測り直すか**だけを決める。きっかけは4つある。
 *
 * ```
 * 器が現れたとき        パネルを開いた / 別の場所へ動かした
 * 器の大きさが変わったとき  Dock / Split / 境界のドラッグ / ウィンドウのリサイズ
 * タブを切り替えたとき    離れている間に器の大きさが変わっていることがある
 * 文字の大きさが変わったとき 器は変わらないのに、入る桁数だけが変わる（Session 3-7-3）
 * ```
 *
 * 最後の1つだけは ResizeObserver では拾えない ── 器のピクセルは1つも
 * 変わっていないため。effect を分けてあるのはこの理由による。
 *
 * ## 測り直しは次のフレームまで待つ（Session 3-7-3）
 *
 * ResizeObserver のコールバックの中で `fit()` を呼ぶと、その中で xterm が
 * 自分の DOM を組み替える ── **観測している最中に、観測対象を変えることになる。**
 * ブラウザはこれを検出して次のフレームへ持ち越し、境界をドラッグしている間
 * `ResizeObserver loop completed with undelivered notifications` を出し続ける。
 *
 * そこで測り直しを `requestAnimationFrame` 1つに束ねる。ドラッグ中に何度
 * 鳴っても、1フレームにつき測り直しは1回で足りる（描画はそれ以上細かくならない）。
 */

interface TerminalSurfaceProps {
  /** 手前のタブ（＝この器に画面を付ける対象）。 */
  readonly terminalId: string
}

export function TerminalSurface({ terminalId }: TerminalSurfaceProps): JSX.Element {
  const { screens, ensureStarted, resize, sendInput, display, changeFontSize } = useTerminal()
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current

    if (container === null) {
      return
    }

    /*
      画面を受け取る（無ければ作られる）。打鍵の宛先を関数として渡すのは、
      画面がセッションより長く生きるため ── 立て直した後も同じ画面が
      新しいセッションへ流す必要がある（値で渡すと古い方を掴んだままになる）。
    */
    const screen = screens.acquire(terminalId, createTerminalScreen, {
      onInput: (data) => sendInput(terminalId, data),

      /*
        アプリが横取りする打鍵（今はフォントの大きさだけ）。true を返すと
        シェルへ流れない。どれを取るかを決めているのは terminalDisplay.ts で、
        ここは**その答えを適用するだけ**にしてある。

        `preventDefault` を呼ぶのは Chromium 側の既定（ズーム）と重なるため。
        端末の文字だけを変えるつもりの打鍵で、アプリ全体が拡大しては困る。
      */
      onAppKey: (event) => {
        const command = terminalFontSizeCommand(event)

        if (command === null) {
          return false
        }

        event.preventDefault()
        changeFontSize(command)

        return true
      }
    })

    container.appendChild(screen.element)

    /*
      最初の測定。ここで初めて xterm が要素の中に DOM を組み立てる
      （`open()` は要素が DOM に入ってからでないと文字の大きさを測れない。
      xtermSetup.ts）。切り替えで戻ってきた場合は、離れている間に器の大きさが
      変わっていることがあるため、ここで測り直したものが伝わる。
    */
    const initialSize = screen.fit()

    if (initialSize !== null) {
      // まだ立っていなければここで立つ。立っていれば大きさだけが伝わる。
      ensureStarted(terminalId, initialSize)
      resize(terminalId, initialSize)
    }

    /*
      器の大きさに追従する。Dock / Split / 境界のドラッグ / パネルを閉じる /
      ウィンドウのリサイズ、のどれでも変わるため、Shell 側から伝える経路は作らない
      （Monaco の automaticLayout・Files の useFilesLayout と同じ考え方で、
      観測するのは器1か所だけにする）。
    */
    let pendingFrame: number | null = null

    const observer = new ResizeObserver(() => {
      // 既に次のフレームを予約してあれば、そこで1回だけ測る（このファイルの冒頭）。
      if (pendingFrame !== null) {
        return
      }

      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null

        const size = screen.fit()

        if (size !== null) {
          ensureStarted(terminalId, size)
          resize(terminalId, size)
        }
      })
    })

    observer.observe(container)

    return () => {
      observer.disconnect()

      if (pendingFrame !== null) {
        cancelAnimationFrame(pendingFrame)
      }

      /*
        画面は捨てない。**要素だけを器から外す。** 中の DOM も xterm の状態も
        要素にぶら下がったままストアに残り、次に付けられたときにそのまま戻る
        （スクロールバックも含めて）。

        外す相手を `container` ではなく要素の側から辿るのは、器が既に
        DOM から外れている場合（パネルを閉じた）にも同じ1行で済むため。
      */
      screen.element.remove()
    }
  }, [terminalId, screens, ensureStarted, resize, sendInput, changeFontSize])

  /*
    文字の大きさが変わったとき（Session 3-7-3。設定 UI からも変わる ── Session 3-7-5）。

    画面へ値を配るのは持ち主の側（useTerminalTabs.ts）で、ここがするのは
    **手前のタブを測り直して ConPTY へ伝える**ことだけ。器のピクセルは
    変わっていないので ResizeObserver は鳴らず、ここで測り直さないと
    「画面の折り返しと、シェルが思っている桁数」が食い違ったままになる。

    見る値を `display` ではなく `display.fontSize` にしてあるのは、
    さかのぼれる行数が変わっても桁数は変わらないため（測り直す理由が無い）。

    上の effect の後に置いてあるのは、初回に画面が器へ付いてから測るため
    （effect は書いた順に走る）。
  */
  useEffect(() => {
    const size = screens.peek(terminalId)?.fit() ?? null

    if (size !== null) {
      resize(terminalId, size)
    }
  }, [terminalId, screens, resize, display.fontSize])

  return (
    <div
      className="fx-terminal__surface"
      data-testid="terminal-surface"
      data-terminal-id={terminalId}
      /*
        器をクリックしたら打てる状態にする。xterm 自身の当たり判定は
        中の DOM にあるため、周りの余白を押したときにも拾えるようにしておく
        （余白を押して「反応しない」と、どこを押せばよいか分からない）。
      */
      onMouseDown={() => screens.peek(terminalId)?.focus()}
      ref={containerRef}
    />
  )
}
