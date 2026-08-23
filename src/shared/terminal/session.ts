import type { TerminalShellId } from './shell'

/**
 * Terminal セッションの型と上限（Session 3-7-1 / 3-7-2）。
 *
 * Main / Renderer の双方が同じ値を見る必要があるものだけを置く。
 *
 * ## Renderer へ渡すものに、OS のものを混ぜない
 *
 * セッションが Renderer へ持って帰るのは **id・シェルの行と表示名・どの Workspace か**
 * だけで、実行ファイルのパスも作業ディレクトリも pid も入っていない。
 * Files が絶対パスを渡さない（ARCHITECTURE.md §9.2）のと同じ線をここにも引く
 * ── Renderer が OS の場所を1つでも持つと、それを指して何かを頼む API を
 * 後から足したくなる。
 *
 * どこで起動するか（cwd）は Main が持つ現在の Workspace が決め、
 * 何を起動するか（シェル）は Main が持つ表が決める（main/terminal/shellCommand.ts）。
 * **Renderer が指せるのは表の行までで（Session 3-7-2 の shellId）、
 * 行の中身も cwd も指定できない。** Terminal は定義上 Workspace の外へ
 * 出られる（`cd ..` を止める意味は無い）ため、境界は「プロセスの中身」ではなく
 * **起動の入口**に置く必要がある。
 */

/**
 * 同時に開けるセッションの上限。
 *
 * 1つ1つが OS のプロセスなので、際限なく作られると PC 側が重くなる。
 * Session 3-7-2 でタブを開く入口が付いたため、ここが実際に効く歯止めになる
 * ── UI 側も同じ値を見て `+` を止める（renderer/src/terminal/terminalTabsModel.ts）が、
 * **UI は迂回されうる**ので断るのは Main の側。
 */
export const TERMINAL_MAX_SESSIONS = 8

/**
 * 桁数・行数の範囲。
 *
 * 上限があるのは、値が **Renderer の測定結果**として境界の外から届くため。
 * 下限が 0 でないのは、パネルが畳まれている / まだ描かれていない間に
 * 0 が測られることがあり、そのまま渡すと ConPTY が受け付けないため。
 * 弾かずに丸めるのは、0 が悪意ではなく**測るには早すぎただけ**だから
 * （size.ts の normalizeTerminalSize）。
 */
export const TERMINAL_MIN_COLUMNS = 2
export const TERMINAL_MAX_COLUMNS = 1000
export const TERMINAL_MIN_ROWS = 1
export const TERMINAL_MAX_ROWS = 500

/**
 * 1回の入力で受け付ける最大文字数。
 *
 * 打鍵はもちろん、ターミナルへの貼り付けもこの経路を通る。上限があるのは
 * 「Renderer から届いた文字列をそのまま OS のプロセスへ流す」唯一の経路だからで、
 * 大きすぎる要求はここで断る（貼り付けの分割は Renderer 側の仕事になる）。
 */
export const TERMINAL_INPUT_MAX_LENGTH = 8192

/** ターミナルの大きさ（文字数）。ピクセルではないことに注意。 */
export interface TerminalSize {
  readonly columns: number
  readonly rows: number
}

/** 起動したセッション（Renderer へ返す形）。 */
export interface TerminalSession {
  /**
   * セッションの識別子。
   *
   * **発番するのは Main**（`window:close-requested` の requestId と同じ形）。
   * Renderer が決めた id を受け取る形にすると、Renderer 側の取り違えが
   * そのまま「別のセッションへ入力を流す」ことになる。
   */
  readonly id: string
  /**
   * 起動したシェルの表示名（`PowerShell` など）。
   *
   * 実行ファイルのパスではない。画面に何が動いているかを出すためのものであって、
   * それを指して何かを頼むためのものではない。
   */
  readonly shellName: string
  /**
   * どの行のシェルとして起動したか（shell.ts の表）。
   *
   * 要求で指した行をそのまま返している。タブが「何として開かれたか」を
   * 立て直しの後も保つために要る ── `exit` と打って立て直したときに
   * Node のタブが既定のシェルに化けては困る。
   */
  readonly shellId: TerminalShellId
  /**
   * どの Workspace で起動したか。
   *
   * 応答やイベントに workspaceId を載せている他のドメインと同じ理由
   * （shared/ipc/events/files.ts）。切り替えの前後で行き違うため、
   * 受け手は自分が今見ている Workspace と突き合わせる。
   */
  readonly workspaceId: string
}
