/**
 * 起動できるシェルの「選択肢」（Session 3-7-2）。
 *
 * ## Renderer が渡せるようになったのは、名前ではなく **行番号**
 *
 * Session 3-7-1 の `terminal:create` に入っていたのは大きさだけで、
 * 起動するものを Renderer から言う手段はどこにも無かった
 * （shared/ipc/contracts/terminal.ts）。複数タブでシェルを選べるようにするには
 * 「どれを起動するか」を Renderer から伝える必要が出てくるが、
 * **境界の性質は変えない。**
 *
 * ```
 * 渡せる   … この閉じた集合の値1つ（'default' | 'node' | 'claude-code'）
 * 渡せない … 実行ファイルのパス・引数・作業ディレクトリ
 * ```
 *
 * つまり Renderer が指すのは Main が持つ表の**行**であって、起動されるものではない。
 * 表の中身（何という実行ファイルを、どこから解決して、どんな引数で起動するか）は
 * 今までどおり Main だけが持つ（main/terminal/shellCommand.ts）。
 * 知らない値が届けば Main が断るため、**「Renderer からの要求で任意の実行ファイルが
 * 動く」という形は依然として作られない。**
 *
 * これは `workspace-folder:open` が「ダイアログを出して」としか言えないのと
 * 同じ線の引き方にあたる ── 選ばせる入口を作ることと、対象を渡せるようにすることは
 * 別の話で、前者だけを足している。
 *
 * ## id に OS の話を持ち込まない
 *
 * 既定のシェルの id は `'powershell'` ではなく `'default'` にしてある。
 * 「その OS で既定のシェル」という意味の行が1つあるだけで、それが Windows で
 * PowerShell に、Unix 系で `$SHELL` に解決されるのは Main の表の都合になる
 * （DESIGN.md §8 の「OS 固有の分岐は Main に閉じる」）。
 * 表示名も Main が返す（`TerminalShellChoice.name`）ため、shared にも Renderer にも
 * 「Windows なら PowerShell」という知識が出てこない。
 */

/**
 * 起動できるシェルの種類。
 *
 * 増やすときはここと main/terminal/shellCommand.ts の表の両方を足す
 * （型がどちらの漏れも拾う）。
 */
export type TerminalShellId = 'default' | 'node' | 'claude-code'

/**
 * 並べる順。UI のメニューはこの順で出る（main/terminal/shellCommand.ts）。
 *
 * 先頭が既定 ── `+` を押しただけで開くのはこれになる。
 */
export const TERMINAL_SHELL_IDS = ['default', 'node', 'claude-code'] as const

/** `+` を押しただけで開くシェル。 */
export const TERMINAL_DEFAULT_SHELL_ID: TerminalShellId = 'default'

/**
 * 境界の外から届いた値が、表の行を指しているか。
 *
 * shared に実装を置かない方針の例外にあたる（size.ts と同じ理由）。
 * **Main は届いた値を確かめる必要があり、Renderer は選択肢を並べる必要がある。**
 * どちらも同じ集合を見ていなければ「UI に出したのに Main が断る」が起きるため、
 * 集合そのものをここに1つだけ置く。
 */
export function isTerminalShellId(value: unknown): value is TerminalShellId {
  return typeof value === 'string' && (TERMINAL_SHELL_IDS as readonly string[]).includes(value)
}

/**
 * 選択肢1つ分（Renderer へ返す形）。
 *
 * ここにも実行ファイルのパスは入らない。Renderer が持つのは
 * **画面に出す名前と、選べるかどうか**だけで、それを指して何かを頼むための
 * 情報は持たない（shared/terminal/session.ts と同じ線）。
 */
export interface TerminalShellChoice {
  readonly id: TerminalShellId
  /** 画面に出す名前（`PowerShell` / `Node` / `Claude Code`）。 */
  readonly name: string
  /**
   * この環境で起動できるか。
   *
   * Node も Claude Code も入っていない PC はふつうにあるため、
   * 「表にある」と「起動できる」は別になる。**起動できないものは UI に出さない**
   * （files/FileContextMenu.tsx と同じで、押せない項目を並べて無効にしない）。
   * それでも `false` を返して黙って消さないのは、Main 側のログと、
   * 「見つからない」を後から利用者へ説明する余地を残すため。
   */
  readonly available: boolean
}
