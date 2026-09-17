import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import type { TerminalSize } from '@shared/terminal'
import { readTerminalThemeColors, type TerminalThemeColors } from '../theme/themeTokens'
import {
  clampTerminalFontSize,
  clampTerminalScrollback,
  TERMINAL_FONT_FAMILY,
  TERMINAL_LINE_HEIGHT
} from './terminalDisplay'
import type { TerminalScreen, TerminalScreenHandlers } from './terminalScreenStore'
import { DEFAULT_TERMINAL_DISPLAY_SETTINGS, type TerminalDisplaySettings } from './terminalSettings'
import '@xterm/xterm/css/xterm.css'

/**
 * xterm.js をこのアプリの前提に合わせる、唯一の場所。
 *
 * **xterm を import してよいのはこのファイルと terminalScreenStore.ts
 * （型だけ）と TerminalSurface.tsx だけ。** Monaco に対する monacoSetup.ts と
 * 同じ分担で、「xterm だから決まること」と「このアプリが決めること」を混ぜない。
 *
 * ## CSP を1文字も緩めていない
 *
 * xterm は既定の描画（DOM ベース）で Worker も blob も使わないため、
 * Monaco のときのような迂回（`MonacoEnvironment.getWorker`）は要らない。
 * WebGL の addon は入れていない ── 入れれば速くはなるが、
 * このアプリが出す量では違いが出ないうえ、描画まわりの不具合の切り分けが増える。
 *
 * CSS は `@xterm/xterm/css/xterm.css` を import してアプリにバンドルする
 * （外部から取りに行かない）。xterm が実行時に style を注入する分は
 * `style-src 'unsafe-inline'` で既に許してあり、これは renderer/index.html の
 * CSP コメントが最初から見込んでいたもの。
 *
 * ## 画面が要素を持ち、要素が引っ越す
 *
 * ここが返す `TerminalScreen` は**自前の要素を1つ持つ**。xterm はその中に
 * DOM を組み立て、パネルを動かすときはその要素ごと別の器へ付け替える。
 * `terminal.open()` を呼び直さないのは、呼び直すと画面が作り直され、
 * スクロールバックが消えるため（terminalScreenStore.ts の冒頭）。
 */

/**
 * xterm へ渡すテーマ（Session 4-4 で Theme に追従するようになった）。
 *
 * xterm は CSS 変数を読まず、色を JavaScript の値として要求する。
 * Session 4-3B までは**そのために `theme.css` と同じ 16進数をここへ書き写して**
 * いて、monacoSetup.ts とまったく同じ注意書き（「片方を変えるときは両方を直すこと」）
 * が付いていた。今は `theme/themeTokens.ts` が `theme.css` の変数を読んで
 * 組み立てる ── **このファイルに色は1つも無い。**
 *
 * ANSI の16色は今までどおり既定のまま。シェルとその中の CLI が使う色であって、
 * このアプリが決めるものではない（ここで塗り替えると、`git status` の緑や
 * npm の警告の黄色が、他のターミナルで見たときと違う色になる）。
 * **Theme を変えても、変わるのは地・文字・カーソル・選択の4つだけ。**
 */
function currentTerminalTheme(): ITheme {
  return { ...readTerminalThemeColors() }
}

/**
 * 表示設定。
 *
 * 並べるのは「アプリとして決めたこと」だけで、それ以外は xterm の既定に任せる。
 * **値そのものは terminalDisplay.ts が持つ**（Session 3-7-3）── 文字の大きさと
 * さかのぼれる行数は後から変わり、変えたときの丸め方まで含めて xterm を知らない層に
 * 置いておきたいため。
 *
 * ここに書いてある2つ（大きさ・行数）は**画面が作られた直後の一瞬だけの値**にあたる。
 * ストアが今の設定を当て直す（terminalScreenStore.ts の acquire）ので、
 * 保存された設定で始まった場合も、後から開いたタブだけが既定のまま、とはならない。
 */
const TERMINAL_OPTIONS = {
  fontFamily: TERMINAL_FONT_FAMILY,
  fontSize: DEFAULT_TERMINAL_DISPLAY_SETTINGS.fontSize,
  lineHeight: TERMINAL_LINE_HEIGHT,
  scrollback: DEFAULT_TERMINAL_DISPLAY_SETTINGS.scrollback,
  /*
    見た目のためだけの点滅を入れない。パネルが常時視界に入る道具なので、
    動き続けるものは1つ減らす。
  */
  cursorBlink: false,
  /*
    xterm 自身に画面外の描画を任せない。器の大きさは Dock / Split で常に変わり、
    測り直しは FitAddon 経由で明示的に行う（TerminalSurface.tsx）。
  */
  allowProposedApi: false
} as const

/**
 * 画面を1つ作る。
 *
 * 呼ぶのは TerminalSurface.tsx（遅延読み込みされる側）だけで、
 * ストアはこの関数を `TerminalScreenFactory` として受け取る。
 */
export function createTerminalScreen(handlers: TerminalScreenHandlers): TerminalScreen {
  /*
    Theme はここで**その場の `<html>` から読む**（Session 4-4）。

    ストアが覚えている値を渡す形にしなかったのは、画面が作られるのは
    器（TerminalSurface）が現れたときで、それは Provider 側の effect より
    **先に起きうる**ため（React の effect は子から先に走る）。
    `data-fx-theme` は描画の中で当たっているので（theme/ThemeProvider.tsx）、
    いつ作られても今の Theme が読める ── 覚えておく必要が無い。

    切り替えたときの当て直しは `applyTheme` で、こちらはストアが全部の画面へ配る。
  */
  const terminal = new Terminal({ ...TERMINAL_OPTIONS, theme: currentTerminalTheme() })
  const fitAddon = new FitAddon()

  terminal.loadAddon(fitAddon)

  /*
    xterm に渡す要素はこちらで作る。器（React が描く div）を直接渡すと、
    パネルを動かしたときに React がその div を捨てるため、xterm の DOM ごと消える。
  */
  const element = document.createElement('div')
  element.className = 'fx-terminal__screen'

  /*
    打鍵・貼り付け・制御文字は、解釈せずそのまま外へ渡す。
    Ctrl+C も Enter も xterm が組み立てたバイト列のままシェルへ届く
    （shared/ipc/contracts/terminal.ts）。
  */
  terminal.onData(handlers.onInput)

  /*
    その前に1つだけ、アプリが横取りする打鍵がある（Session 3-7-3）。

    `attachCustomKeyEventHandler` が **false を返すと xterm はその打鍵を
    処理しない**（＝シェルへ流れない）。器の側で `onKeyDown` を拾う形にしないのは、
    xterm が textarea 上で打鍵を組み立てており、**どこまで外へ漏れるかが
    xterm の実装都合になる**ため ── 横取りするかどうかは xterm の窓口で決める。

    見るのは keydown だけ。同じ組み合わせは keypress でも渡ってくるので、
    両方で数えると1回の打鍵で2段階動く。
  */
  /*
    直前の keydown をアプリが取ったか（v1.1 S1）。

    keydown で false を返すと xterm はその打鍵を処理しないが、**続く keypress は
    別に届く。** Enter の keypress は文字コード 13 を持つので、放っておくと
    xterm がそこで `\r` を送る ── AI CLI モードで改行（`\n`）を送った直後に
    送信が続く形になる。取った打鍵の keypress は、ここで一緒に止める。
  */
  let appHandledKeyDown = false

  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type === 'keypress') {
      return !appHandledKeyDown
    }

    if (event.type !== 'keydown') {
      return true
    }

    appHandledKeyDown = handlers.onAppKey(event)

    return !appHandledKeyDown
  })

  let opened = false

  return {
    element,
    terminal,

    fit: (): TerminalSize | null => {
      /*
        `open()` は要素が DOM に入ってからでないと文字の大きさを測れない
        （測れないまま開くと 1 桁 × 1 行のような値になる）。
        器へ付けた後に最初の fit が来るので、そこで初めて開く。
      */
      if (!opened) {
        if (element.isConnected === false) {
          return null
        }

        terminal.open(element)
        opened = true
      }

      const proposed = fitAddon.proposeDimensions()

      if (proposed === undefined || !Number.isFinite(proposed.cols) || proposed.cols <= 0) {
        // 器がまだ大きさを持っていない（畳まれている・描画前）。
        return null
      }

      terminal.resize(proposed.cols, proposed.rows)

      return { columns: proposed.cols, rows: proposed.rows }
    },

    applyDisplaySettings: (settings: TerminalDisplaySettings): void => {
      const fontSize = clampTerminalFontSize(settings.fontSize)
      const scrollback = clampTerminalScrollback(settings.scrollback)

      /*
        大きさ（桁数・行数）はここでは決めない。文字が大きくなれば同じ器に
        入る桁数は減るが、**器を測り直して ConPTY へ伝えるのは呼び出し側**
        （TerminalSurface.tsx）── 器がまだ DOM に無い画面（手前に出ていない
        タブ）は測れず、測れないまま伝えると 1桁 × 1行が渡る。

        同じ値なら当てないのは、xterm が代入のたびに描き直し・バッファの詰め直しを
        するため。設定は起動時と、利用者が触ったときにしか変わらない。
      */
      if (terminal.options.fontSize !== fontSize) {
        terminal.options.fontSize = fontSize
      }

      /*
        減らす向きの変更では、溢れたぶんの行がその場で捨てられる（xterm の側の挙動）。
        遡れる量を自分で減らしたのだから、それが起きること自体は筋が通っている
        ── 減らした瞬間に消えることだけは、設定 UI 側で断ってある
        （TerminalSettingsMenu.tsx）。
      */
      if (terminal.options.scrollback !== scrollback) {
        terminal.options.scrollback = scrollback
      }
    },

    applyTheme: (colors: TerminalThemeColors): void => {
      /*
        地・文字・カーソル・選択の4つだけを差し替える（Session 4-4）。
        `theme` への代入は xterm が全画面を描き直すが、Theme が変わるのは
        利用者が切り替えたときだけなので、間引く仕組みは要らない
        （文字の大きさのように、押しっぱなしで連続して届くものではない）。

        ANSI の16色を渡していないので、既定のまま残る（このファイルの冒頭）。
      */
      terminal.options.theme = { ...colors }
    },

    focus: (): void => {
      if (opened) {
        terminal.focus()
      }
    },

    dispose: (): void => {
      terminal.dispose()
      element.remove()
    }
  }
}
