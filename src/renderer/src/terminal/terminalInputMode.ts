/**
 * AI CLI モードの打鍵の読み替え（v1.1 S1 `feat/shortcuts-terminal-enter-paste`）。
 *
 * React にも DOM にも xterm にも依存しない ── 打鍵の**形**だけを受け取り、
 * 「シェルへ何を送るか」を返す（terminalDisplay.ts の `terminalFontSizeCommand` と
 * 同じ切り方）。
 *
 * ## なぜ読み替えが要るのか
 *
 * xterm は Enter を修飾キーに関係なく `\r` にする（Shift+Enter も Ctrl+Enter も同じ。
 * Alt+Enter だけが `ESC \r`。`@xterm/xterm` の `common/input/Keyboard.ts`）。
 * シェルの側からは区別が付かないので、Claude Code / Codex のような AI CLI で
 * 「改行」と「送信」を分けることは、CLI の設定だけではできない。
 *
 * そこで、**利用者がタブを AI CLI モードにしたときだけ**、端末の窓口で読み替える。
 *
 * | 打鍵         | 通常（従来どおり）     | AI CLI モード              |
 * | ------------ | ---------------------- | -------------------------- |
 * | Enter        | `\r`（実行）           | `\n`（改行）               |
 * | Shift+Enter  | `\r`                   | `\n`（改行）               |
 * | Ctrl+Enter   | `\r`                   | `\r`（送信）               |
 * | Ctrl+V       | `0x16`（シェルへ）     | クリップボードから貼り付け |
 *
 * 改行に `\n`（0x0A）を使うのは、**Claude Code で Ctrl+J（＝ 0x0A）が改行として
 * 動くことを実機で確かめてある**ため（Notion「v1.0.0 初期フィードバック｜
 * キーボードショートカット改善」）。
 *
 * ## 通常のタブには1つも効かない
 *
 * PowerShell / Command Prompt で Enter が改行になると、コマンドを実行できなくなる。
 * 既定は OFF で、ここを呼ぶのは AI CLI モードのタブだけ（TerminalSurface.tsx）。
 *
 * ## IME の変換中は触らない
 *
 * xterm は、アプリの打鍵ハンドラを**変換の処理より前**に呼ぶ
 * （`CoreBrowserTerminal._keyDown`）。変換を確定する Enter をここで取ると、
 * 日本語が確定されずに改行が送られる ── `isComposing` / `keyCode === 229` の
 * 打鍵は読み替えない。
 */

/** 読み替えた結果。 */
export type TerminalInputAction =
  /** この文字列をシェルへ送る（xterm には処理させない）。 */
  | { readonly kind: 'send'; readonly data: string }
  /**
   * クリップボードから貼り付ける。
   *
   * 文字列を自分で読まず、**ブラウザの paste に任せる**のが要点 ──
   * xterm が paste イベントを受け、bracketed paste（`ESC[200~ … ESC[201~`）で
   * 包んで送る（`browser/Clipboard.ts`）。自分で送ると、複数行の貼り付けが
   * 1行ずつ実行される形に変わる。
   */
  | { readonly kind: 'paste' }

/** 判断に要るぶんだけの `KeyboardEvent`（DOM 無しで試せるようにするため）。 */
export interface TerminalInputKeyStroke {
  readonly key: string
  readonly code: string
  readonly keyCode: number
  readonly isComposing: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
}

/** 改行（Ctrl+J と同じ 0x0A）。 */
export const AI_CLI_NEWLINE = '\n'
/** 送信（従来の Enter と同じ 0x0D）。 */
export const AI_CLI_SUBMIT = '\r'

/** IME が処理中の打鍵に Chromium が付ける keyCode。 */
const IME_PROCESS_KEY_CODE = 229

/**
 * AI CLI モードでの打鍵の読み替え。読み替えないものは null（xterm に任せる）。
 *
 * 当てるのは上の表の組み合わせだけで、Alt / Meta が付いたもの・Ctrl+Shift+Enter・
 * Ctrl+Shift+V は従来どおり xterm へ通す（Alt+Enter の `ESC \r` を使う CLI もある）。
 */
export function aiCliInputAction(stroke: TerminalInputKeyStroke): TerminalInputAction | null {
  if (stroke.isComposing || stroke.keyCode === IME_PROCESS_KEY_CODE) {
    return null
  }

  if (stroke.altKey || stroke.metaKey) {
    return null
  }

  if (stroke.key === 'Enter') {
    if (stroke.ctrlKey) {
      return stroke.shiftKey ? null : { kind: 'send', data: AI_CLI_SUBMIT }
    }

    // Enter と Shift+Enter はどちらも改行。
    return { kind: 'send', data: AI_CLI_NEWLINE }
  }

  /*
    Ctrl+V は物理キーの位置で見る（keybindings/chord.ts と同じ理由）。
    `code` が取れない打鍵だけ `key` へ落とす。
  */
  const isV = stroke.code === 'KeyV' || (stroke.code === '' && stroke.key.toLowerCase() === 'v')

  if (isV && stroke.ctrlKey && !stroke.shiftKey) {
    return { kind: 'paste' }
  }

  return null
}
