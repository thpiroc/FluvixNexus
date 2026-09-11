import type { DebugBreakpoint } from '../../debug/breakpoint'
import type { DebugCallStackSnapshot } from '../../debug/callStack'

/**
 * debug ドメインの Main → Renderer イベント（Session 6-3）。
 *
 * ```
 * debug:breakpoints-changed  今の Workspace の breakpoint はこれ
 * ```
 *
 * 要求と応答（contracts/debug.ts）と対になる、Main の側から一方的に流れる通知。
 *
 * ## なぜ通知が要るのか
 *
 * breakpoint が変わるきっかけは、Renderer の操作だけではない。
 *
 * ```
 * 利用者が glyph margin を押した   … 応答でも届く（要求の結果）
 * adapter が verified を返した     … **要求が無い**。Main の側で起きる
 * Workspace が切り替わった         … 同上。保存内容から読み直される
 * ```
 *
 * 下2つのために片道の経路が要る。verified は Debug Session の中で後から確定するもので、
 * 押した瞬間には決まらない（docs/ARCHITECTURE.md §20.12）。
 *
 * ## 全件を送る
 *
 * 変わった1件だけを送らない。受け手が持つのは「今の一覧」だけで足り、
 * **差分を当てる処理を Renderer に作らない**ため ── `lsp:status-changed` が
 * 3本ぶんをまとめて送るのと同じ考え方になる。
 *
 * ## 載らないもの
 *
 * 絶対パス・file URI・DAP の Source・adapter が返した文言は1つも載らない
 * （shared/debug/breakpoint.ts）。載るのは Main が Workspace の中だと確かめた
 * 相対位置と、行と、2つの真偽値だけになる。
 */
export interface DebugBreakpointsChangedEvent {
  /**
   * どの Workspace についての通知か。
   *
   * `files:changed` / `lsp:diagnostics` と同じ理由で載せてある。切り替えの前後で
   * 行き違うと、**前の Workspace の相対位置**を新しい Workspace の画面へ描くことになる。
   * Workspace を閉じている間は空文字が入り、`breakpoints` も空になる。
   */
  readonly workspaceId: string
  /** その Workspace の全件（相対位置 → 行の順）。 */
  readonly breakpoints: readonly DebugBreakpoint[]
}

export interface DebugCallStackChangedEvent {
  /**
   * どの Workspace についての通知か。
   *
   * frame の relativePath は Workspace が変わると別のファイルを指すため、Renderer は
   * これを突き合わせて古い snapshot を捨てる。
   */
  readonly workspaceId: string
  /** Main が正規化した Call Stack。 */
  readonly callStack: DebugCallStackSnapshot
}

export interface DebugIpcEventContract {
  'debug:breakpoints-changed': DebugBreakpointsChangedEvent
  'debug:call-stack-changed': DebugCallStackChangedEvent
}
