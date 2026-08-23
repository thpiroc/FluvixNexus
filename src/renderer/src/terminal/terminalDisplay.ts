/**
 * 端末の見え方として「アプリが決めていること」（Session 3-7-3）。
 *
 * React にも DOM にも xterm にも依存しない純粋な層で、terminalTabsModel.ts と
 * 同じ役どころにあたる。xtermSetup.ts はここが出した値を xterm へ渡すだけになる。
 *
 * ## なぜ shared ではなく Renderer に置くのか
 *
 * 大きさ（桁数・行数）は Main と Renderer の双方が同じ答えを見る必要があるため
 * shared/terminal/size.ts に置いてある。**フォントの大きさとスクロールバックは
 * IPC を1度も渡らない** ── 前者はピクセルの話で、Main が渡すのは
 * 桁数と行数だけ（shared/terminal/session.ts）。後者は Renderer 側の
 * メモリの話にほかならない。Main が知る必要の無いものを shared へ置くと、
 * 「shared にあるのだから Main も見てよい」が後から生えてくる。
 *
 * ## 値は1箇所。持ち主は後から変わる
 *
 * Session 3-7-3 の時点では、変えられるのはフォントの大きさだけ（打鍵で増減する。
 * TerminalSurface.tsx）で、しかも開き直せば既定へ戻っていた。Session 3-7-5 で
 * **フォントの大きさとさかのぼれる行数が設定になり、ディスクに残る**ようになったが、
 * ここが持つものは変わっていない ── 既定値と範囲と丸め方だけで、
 * 「どこから読むか」は terminalSettings.ts、「いつ書くか」は useTerminalSettings.ts。
 *
 * ```
 * terminalDisplay.ts     既定値・範囲・丸め方（ここ）
 * terminalSettings.ts    実行時の設定と、保存形式との行き来
 * useTerminalSettings.ts いつ読み、いつ書くか
 * shared/settings/terminalSettings.ts  ディスクに置く形
 * main/store/terminalSettings.ts       保存先
 * ```
 */

/**
 * 端末のフォント。
 *
 * Editor / Files と同じ等幅フォント（editor.css / files.css と揃える）。
 * 等幅でないフォントを選べるようにはしない ── 桁数で大きさを決める以上、
 * 文字ごとに幅が違うと画面と ConPTY の折り返しが食い違う。
 */
export const TERMINAL_FONT_FAMILY = "Consolas, 'Courier New', monospace"

/** 行の高さ（フォントの大きさに対する倍率）。 */
export const TERMINAL_LINE_HEIGHT = 1.2

/** フォントの大きさ（px）の既定値と範囲。 */
export const TERMINAL_FONT_SIZE_DEFAULT = 13
export const TERMINAL_FONT_SIZE_MIN = 8
export const TERMINAL_FONT_SIZE_MAX = 32

/** 1回の操作で動く幅（px）。 */
const TERMINAL_FONT_SIZE_STEP = 1

/**
 * さかのぼれる行数の既定値と範囲（Session 3-7-5 から設定できる）。
 *
 * 既定を xterm の既定（1000）より多くしてあるのは、ビルドの出力を上まで読み返すのが
 * 実際の使い方になるため。**無制限にはしない** ── 出力の量に比例して
 * Renderer のメモリが伸びる。タブごとに1本ぶん持つので、上限
 * （TERMINAL_MAX_SESSIONS = 8）を掛けた量が最悪値になる。
 *
 * 上限（50000 行）はその最悪値から決めてある。1行を 100 文字とすると
 * 8本 × 50000 行 で 40M 文字ぶん ── 端末1つに割く量としてはここが限度で、
 * これ以上を選べるようにすると「選べたのに重くなった」を作ることになる。
 * 下限（500 行）は、1画面ぶんしか遡れない設定を選べないようにするためのもの。
 */
export const TERMINAL_SCROLLBACK_DEFAULT = 5000
export const TERMINAL_SCROLLBACK_MIN = 500
export const TERMINAL_SCROLLBACK_MAX = 50_000

/** フォントの大きさに対する操作。 */
export type TerminalFontSizeCommand = 'increase' | 'decrease' | 'reset'

/**
 * 打鍵のうち、判断に要るものだけ。
 *
 * `KeyboardEvent` をそのまま受け取らないのは、この判断を DOM 無しで
 * 試せるようにするため（files/dragDrop.ts が座標だけを受け取るのと同じ形）。
 */
export interface TerminalKeyStroke {
  readonly key: string
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
}

/**
 * その打鍵がフォントの大きさの操作か（違えば null）。
 *
 * ```
 * Ctrl + +  /  Ctrl + =   大きく
 * Ctrl + -  /  Ctrl + _   小さく
 * Ctrl + 0                既定へ戻す
 * ```
 *
 * ## 端末の打鍵を横取りすることになる
 *
 * ここで true を返した打鍵は**シェルへ流さない**（TerminalSurface.tsx）。
 * 端末は打鍵をそのまま渡すのが約束（shared/ipc/contracts/terminal.ts）なので、
 * 横取りする組み合わせは少ないほどよい。それでも 3つだけ取っているのは、
 * Session 3-7-3 の時点で文字の大きさを変える入口が他に無かったため。
 * 設定 UI（TerminalSettingsMenu.tsx）ができた後もこの3つは残してある ──
 * 端末を触っている手を止めずに変えられることに意味があり、**どちらも同じ1つの値**
 * を変える（打鍵で変えた値は設定 UI にもそのまま出る）。
 *
 * `=` と `_` も見るのは、`+` と `-` が Shift の有無で別の文字として届くため
 * （日本語配列では `+` が Shift + `;`）。Shift を条件にしないのはこの理由で、
 * 逆に Alt / Meta が付いていれば別の組み合わせとして通す。
 */
export function terminalFontSizeCommand(stroke: TerminalKeyStroke): TerminalFontSizeCommand | null {
  if (!stroke.ctrlKey || stroke.altKey || stroke.metaKey) {
    return null
  }

  switch (stroke.key) {
    case '+':
    case '=':
      return 'increase'

    case '-':
    case '_':
      return 'decrease'

    case '0':
      return 'reset'

    default:
      return null
  }
}

/** 操作を適用した後の大きさ（範囲外へは出ない）。 */
export function nextTerminalFontSize(current: number, command: TerminalFontSizeCommand): number {
  switch (command) {
    case 'increase':
      return clampTerminalFontSize(current + TERMINAL_FONT_SIZE_STEP)

    case 'decrease':
      return clampTerminalFontSize(current - TERMINAL_FONT_SIZE_STEP)

    case 'reset':
      return TERMINAL_FONT_SIZE_DEFAULT
  }
}

/**
 * 受け取った大きさを範囲へ収める。
 *
 * 大きさ（桁数・行数）と同じく**弾かずに丸める**（shared/terminal/size.ts）。
 * 読めない値だけは既定へ戻す ── 保存された値（Session 3-7-5）や設定 UI に
 * 打ち込まれた値を読むとき、壊れたファイル1つ・打ち間違い1つで端末が
 * 開けなくなる形にしないため。
 */
export function clampTerminalFontSize(value: number): number {
  if (!Number.isFinite(value)) {
    return TERMINAL_FONT_SIZE_DEFAULT
  }

  const rounded = Math.round(value)

  if (rounded < TERMINAL_FONT_SIZE_MIN) {
    return TERMINAL_FONT_SIZE_MIN
  }

  return rounded > TERMINAL_FONT_SIZE_MAX ? TERMINAL_FONT_SIZE_MAX : rounded
}

/**
 * さかのぼれる行数を範囲へ収める（Session 3-7-5）。
 *
 * 丸め方は文字の大きさとまったく同じ。**両方が同じ関数を通る**ようにしてあるのは、
 * 通り道が2つあると「設定 UI からは止まるのに、保存ファイルを直接書けば通る」
 * という食い違いが生まれるため（files/filesSettings.ts の clampColumnWidth と同じ線）。
 */
export function clampTerminalScrollback(value: number): number {
  if (!Number.isFinite(value)) {
    return TERMINAL_SCROLLBACK_DEFAULT
  }

  const rounded = Math.round(value)

  if (rounded < TERMINAL_SCROLLBACK_MIN) {
    return TERMINAL_SCROLLBACK_MIN
  }

  return rounded > TERMINAL_SCROLLBACK_MAX ? TERMINAL_SCROLLBACK_MAX : rounded
}
