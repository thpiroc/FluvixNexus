import type { TerminalSize } from '@shared/terminal'
// 型だけ。実体を import すると、このモジュールを読むだけで xterm が読み込まれる（下記）。
import type { Terminal } from '@xterm/xterm'
import type { TerminalThemeColors } from '../theme/themeTokens'
import { DEFAULT_TERMINAL_DISPLAY_SETTINGS, type TerminalDisplaySettings } from './terminalSettings'

/**
 * 開いているターミナルの画面（xterm のインスタンス）を持つ層。
 *
 * ## Editor の documentStore と同じ問題を解いている
 *
 * パネルは View メニューから閉じられ（ARCHITECTURE.md §7.7）、Dock で動かせば
 * React から見て作り直される。画面をパネルの中に持つと、
 * **別の場所へ運んだだけでスクロールバックが白紙に戻る。**
 *
 * ```
 * TerminalProvider          ← 画面の持ち主（ウィンドウが閉じるまで生きる）
 *   └── WorkspaceShell
 *         └── Terminal パネル
 *               └── TerminalSurface  ← 器。閉じても画面は残る
 * ```
 *
 * シェルのプロセス自体は Main が持っているので、パネルを動かしても死なない
 * （main/terminal/terminalSessions.ts）。**画面だけが Renderer 側に残る問題**で、
 * Editor の Model がまさに同じ形だったため、置き場所も同じにしてある。
 *
 * ## DOM ごと引っ越す（作り直さない）
 *
 * xterm は `open(parent)` で渡された要素の中に自分の DOM を組み立てる。
 * パネルを動かすたびに作り直すと、そのたびに画面が消える。
 * そこで**自前の要素を1つ持ち、それを器から器へ付け替える。**
 * 要素ごと動かせば、中の DOM も xterm の状態もそのまま移る
 * （React が消すのは器の側だけで、こちらの要素はストアが参照を持ち続ける）。
 *
 * ## 鍵は画面の側（terminalId）、出力の宛先はセッションの側（sessionId）
 *
 * 2つの id が出てくるのは、**寿命が違う**ため。
 *
 * | id           | 誰が発番        | いつまで生きるか                                |
 * | ------------ | --------------- | ----------------------------------------------- |
 * | `terminalId` | Renderer        | 画面が要る間（シェルが終わって立て直しても同じ）|
 * | `sessionId`  | Main            | そのシェルのプロセスが動いている間              |
 *
 * Editor でタブ id（発番したもの）と relativePath（中身の同一性）を
 * 分けているのと同じ形にあたる。`exit` と打って立て直したとき、
 * **画面はそのままでプロセスだけが変わる**のが自然なので、
 * 画面の鍵にセッションを使わない。
 *
 * ## 画面より先に届く出力を捨てない
 *
 * セッションを作る要求の応答が返るより先に、シェルは喋る
 * （PowerShell は起動した直後にプロンプトを出す）。その一瞬の間、
 * Renderer は「その sessionId がどの画面のものか」をまだ知らない。
 * **出力は1回きりで読み直せない**（shared/ipc/events/terminal.ts）ため、
 * 結び付くまでの分はここで預かり、`bind` で流し込む。
 *
 * これは Editor には無かった事情にあたる ── ファイルの中身は後から読み直せるが、
 * 出てしまった文字は取り戻せない。
 *
 * ## xterm を「型としてしか」使わない
 *
 * このファイルは `import type` だけで xterm を参照し、**画面の作り方は
 * 呼び出し側から関数として受け取る**（`TerminalScreenFactory`）。
 * ストアの持ち主（TerminalProvider）はアプリの起動と同時に作られるため、
 * 実体を import するとその時点で xterm が読み込まれ、
 * TerminalSurface.tsx を遅延させている意味が無くなる
 * （editor/monaco/documentStore.ts が Monaco に対して取っているのと同じ形）。
 */

/** 器に付けられる画面1つ分。作り方を知っているのは xtermSetup.ts。 */
export interface TerminalScreen {
  /** xterm が中に DOM を組み立てる要素。器の間を付け替える対象。 */
  readonly element: HTMLElement
  readonly terminal: Terminal
  /** 今いる器の大きさに合わせて測り直す。まだ測れなければ null。 */
  readonly fit: () => TerminalSize | null
  /**
   * 見え方（文字の大きさ・さかのぼれる行数）を当てる（Session 3-7-3 / 3-7-5）。
   *
   * 桁数と行数はここでは変わらない ── 測り直して ConPTY へ伝えるのは
   * 器を持っている側（TerminalSurface.tsx）。
   */
  readonly applyDisplaySettings: (settings: TerminalDisplaySettings) => void
  /**
   * 地・文字・カーソル・選択の色を当てる（Session 4-4）。
   *
   * 桁数と行数は変わらない（色だけの差し替え）ので、`applyDisplaySettings` と
   * 違って測り直しは要らない。ANSI の16色は含まない ── シェルの持ち物で、
   * Theme を変えても変わらない（xtermSetup.ts）。
   */
  readonly applyTheme: (colors: TerminalThemeColors) => void
  readonly focus: () => void
  readonly dispose: () => void
}

/**
 * 画面が外へ渡す打鍵の宛先。
 *
 * `onInput` … 端末としてシェルへ流すもの（加工しない）
 * `onAppKey` … アプリが横取りするもの。true を返すとシェルへ流さない
 *
 * 画面はセッションより長く生きるため、どちらも**値ではなく関数**で受け取る
 * （立て直した後も同じ画面が新しいセッションへ流す必要がある）。
 */
export interface TerminalScreenHandlers {
  readonly onInput: (data: string) => void
  readonly onAppKey: (event: KeyboardEvent) => boolean
}

/**
 * 画面の作り方。
 *
 * xterm の作法（設定・テーマ・addon・CSS）を知っているのは器の側だけ、という分担。
 */
export type TerminalScreenFactory = (handlers: TerminalScreenHandlers) => TerminalScreen

/**
 * 結び付くまでに預かる出力の上限（文字数）。
 *
 * 預かるのは `terminal:create` の応答が返るまでの一瞬だけなので、本来は
 * 数キロバイトで足りる。それでも上限を置くのは、応答が返らなかった場合
 * （Main 側の失敗）に**誰も引き取らない預かりものが伸び続ける**ため。
 * 溢れたら古い方から捨てる ── 端末が見せるのは常に新しい側で、
 * 新しい方を捨てると器が付いた瞬間に「途中で止まった画面」が出てしまう。
 */
const PENDING_MAX_LENGTH = 64 * 1024

interface ScreenEntry {
  readonly screen: TerminalScreen
  /** この画面が今映しているセッション。まだ立っていなければ null。 */
  sessionId: string | null
}

interface PendingOutput {
  chunks: string[]
  length: number
}

export interface TerminalScreenStore {
  /**
   * 画面を得る（無ければ作る）。
   *
   * 同じ terminalId に対しては常に同じ画面を返す ── 作り直すと、
   * そこまでのスクロールバックが消える。
   */
  readonly acquire: (
    terminalId: string,
    factory: TerminalScreenFactory,
    handlers: TerminalScreenHandlers
  ) => TerminalScreen
  /** 既にある画面を覗く（作らない）。 */
  readonly peek: (terminalId: string) => TerminalScreen | null
  /**
   * 見え方を全部の画面へ揃える（Session 3-7-3 / 3-7-5）。
   *
   * タブごとに別の見え方にはしない ── 端末は同じパネルの中で切り替わるもので、
   * 切り替えるたびに文字の大きさが変わるのは道具として落ち着かない。
   * **この後に作られる画面にも同じ値が渡る**ので、手前に出ていないタブや
   * これから開くタブだけが既定のままになることもない。
   */
  readonly applyDisplaySettings: (settings: TerminalDisplaySettings) => void
  /**
   * Theme の色を全部の画面へ揃える（Session 4-4）。
   *
   * 見え方（上）と違い、**この後に作られる画面のために覚えておく必要は無い。**
   * 画面を作る側が `<html>` から今の Theme を読むため（xtermSetup.ts）で、
   * 覚えると「ストアが持つ Theme」と「`<html>` の Theme」の2つができ、
   * ずれる余地が生まれる。
   *
   * 手前に出ていないタブの画面にも当たる ── Theme を切り替えてから別のタブへ
   * 移ったときに、そのタブだけ前の色のまま、とはならない。
   */
  readonly applyTheme: (colors: TerminalThemeColors) => void
  /** セッションが立った。預かっていた出力があればここで流し込む。 */
  readonly bind: (terminalId: string, sessionId: string) => void
  /** セッションが終わった（画面は残す）。 */
  readonly unbind: (sessionId: string) => void
  /** 出力を流す。まだ結び付いていなければ預かる。 */
  readonly write: (sessionId: string, data: string) => void
  /** その画面を捨てる。 */
  readonly release: (terminalId: string) => void
  /**
   * すべて捨てる（Provider が消えるとき＝ウィンドウが閉じるとき）。
   *
   * Workspace の切り替えでは呼ばない ── 動いているターミナルは切り替えでも
   * 残る（Session 3-7-3。useTerminalTabs.ts）。
   */
  readonly releaseAll: () => void
}

export function createTerminalScreenStore(): TerminalScreenStore {
  const entries = new Map<string, ScreenEntry>()
  /** sessionId → terminalId。出力の宛先を引く。 */
  const boundTerminals = new Map<string, string>()
  /** まだ結び付いていないセッションの出力。 */
  const pending = new Map<string, PendingOutput>()
  /** 今の見え方。これから作る画面にも同じ値を渡すため、ここが覚えておく。 */
  let display = DEFAULT_TERMINAL_DISPLAY_SETTINGS

  function screenForSession(sessionId: string): TerminalScreen | null {
    const terminalId = boundTerminals.get(sessionId)

    if (terminalId === undefined) {
      return null
    }

    return entries.get(terminalId)?.screen ?? null
  }

  return {
    acquire: (terminalId, factory, handlers): TerminalScreen => {
      const existing = entries.get(terminalId)

      if (existing !== undefined) {
        return existing.screen
      }

      const screen = factory(handlers)
      // 後から開いたタブだけが既定の見え方で現れる、を作らない。
      screen.applyDisplaySettings(display)
      entries.set(terminalId, { screen, sessionId: null })

      return screen
    },

    peek: (terminalId): TerminalScreen | null => entries.get(terminalId)?.screen ?? null,

    applyDisplaySettings: (next): void => {
      display = next

      for (const entry of entries.values()) {
        entry.screen.applyDisplaySettings(next)
      }
    },

    applyTheme: (colors): void => {
      for (const entry of entries.values()) {
        entry.screen.applyTheme(colors)
      }
    },

    bind: (terminalId, sessionId): void => {
      const entry = entries.get(terminalId)

      if (entry === undefined) {
        return
      }

      entry.sessionId = sessionId
      boundTerminals.set(sessionId, terminalId)

      const held = pending.get(sessionId)

      if (held !== undefined) {
        pending.delete(sessionId)
        // 届いた順のまま流し込む。
        entry.screen.terminal.write(held.chunks.join(''))
      }
    },

    unbind: (sessionId): void => {
      const terminalId = boundTerminals.get(sessionId)

      boundTerminals.delete(sessionId)
      pending.delete(sessionId)

      if (terminalId === undefined) {
        return
      }

      const entry = entries.get(terminalId)

      /*
        画面は残す。終了メッセージと、それまでの出力を読み返せる状態のまま
        「終了しました」を出すため（TerminalView.tsx）。
      */
      if (entry !== undefined && entry.sessionId === sessionId) {
        entry.sessionId = null
      }
    },

    write: (sessionId, data): void => {
      const screen = screenForSession(sessionId)

      if (screen !== null) {
        screen.terminal.write(data)
        return
      }

      const held = pending.get(sessionId) ?? { chunks: [], length: 0 }

      held.chunks.push(data)
      held.length += data.length

      // 溢れたら古い方から捨てる（このファイルの冒頭）。
      while (held.length > PENDING_MAX_LENGTH && held.chunks.length > 1) {
        const dropped = held.chunks.shift()
        held.length -= dropped?.length ?? 0
      }

      pending.set(sessionId, held)
    },

    release: (terminalId): void => {
      const entry = entries.get(terminalId)

      if (entry === undefined) {
        return
      }

      if (entry.sessionId !== null) {
        boundTerminals.delete(entry.sessionId)
        pending.delete(entry.sessionId)
      }

      entry.screen.dispose()
      entries.delete(terminalId)
    },

    releaseAll: (): void => {
      for (const entry of entries.values()) {
        entry.screen.dispose()
      }

      entries.clear()
      boundTerminals.clear()
      pending.clear()
    }
  }
}
