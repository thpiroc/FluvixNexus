import type { DebugBreakpoint } from '../../debug/breakpoint'

/**
 * debug ドメインの IPC 契約（Session 6-3 ── Breakpoint）。
 *
 * ## この契約に無いもの
 *
 * ```
 * 任意の DAP method / command   … 無い（口は機能ごとに固定。§20.9）
 * adapter の実行ファイル / 引数 / cwd … 無い（表は main/debug/adapterCatalog.ts）
 * 絶対パス・file URI            … 無い（組み立てるのは main/debug/breakpointSource.ts）
 * DAP の Source / breakpoint id … 無い（Renderer は DAP を1語も知らない）
 * どの Workspace の分か         … 無い（返るのは常に**今開いている Workspace** の分だけ）
 * 一覧をまとめて書き込む口      … 無い（下記）
 * ```
 *
 * ## 一覧を渡す口を作らない
 *
 * Renderer から渡せるのは「この相対位置の、この行を入れ替えてくれ」の1件だけで、
 * breakpoint の配列を丸ごと渡す口は作らない。作れば **Renderer が保存領域の
 * 中身を任意に書き込む口**になり、1件ずつの検証では防げるはずの
 * 「500件の Workspace 外パス」が1回の要求で通ってしまう。
 *
 * その代わり、Main は入れ替えた結果の**一覧をそのまま応答に載せる**
 * ── 呼んだ側が改めて読み直す往復が要らず、応答と通知（`debug:breakpoints-changed`）で
 * 同じ形が届くので、受け手の処理も1つで済む。
 *
 * ## Debug Session が無くても働く
 *
 * `debug:toggle-breakpoint` は adapter に一切依存しない。セッションが動いていれば
 * Main が `setBreakpoints` へ翻訳して送るが、動いていなければ保存と通知だけで完結する
 * ── **走らせる前に印を付けられること**が breakpoint の最初の役目にほかならない。
 *
 * ## 実行を始める口はここに無い
 *
 * `debug:start` / `debug:stop` は Session 6-4 以降で、この契約にはまだ現れない。
 * Session 6-3 が足したのは breakpoint の3つ（要求2・購読1）だけになる。
 */

/**
 * その位置の breakpoint を入れ替える（無ければ付け、あれば外す）。
 *
 * 基点は Main が持つ現在の Workspace で、要求に Workspace を指す欄は無い
 * （Files / LSP ドメインと同じ線）。`..`・絶対パス・ドライブ相対は Main が断る。
 */
export interface ToggleDebugBreakpointRequest {
  /** Workspace root からの相対位置。 */
  readonly relativePath: string
  /** 1起点の行番号。 */
  readonly line: number
}

/**
 * breakpoint の一覧。
 *
 * 要求の応答も購読の payload も同じ形にしてある ── **受け手が差分を当てない**
 * ようにするため（`lsp:diagnostics` が毎回その文書の全件を送るのと同じ考え方）。
 */
export interface DebugBreakpointsResponse {
  /** 今の Workspace の全件（相対位置 → 行の順）。 */
  readonly breakpoints: readonly DebugBreakpoint[]
}

export interface DebugIpcContract {
  /**
   * 今の Workspace の breakpoint を読む。
   *
   * **要求に欄が1つも無い。** どの Workspace の分かも Renderer は言わず、
   * 返るのは常に今開いている Workspace の分になる（§20.5 と同じ形）。
   * 画面が開いた時点の状態を1度読むためのもので、以降は
   * `debug:breakpoints-changed` が届く（`lsp:get-status` と同じ理由）。
   */
  'debug:list-breakpoints': {
    request: void
    response: DebugBreakpointsResponse
  }
  /**
   * その位置の breakpoint を入れ替える。
   *
   * 応答は入れ替えた**後**の全件。上限に達した追加や Workspace 外の位置は
   * 失敗として返る（INVALID_REQUEST / PERMISSION_DENIED）。
   */
  'debug:toggle-breakpoint': {
    request: ToggleDebugBreakpointRequest
    response: DebugBreakpointsResponse
  }
}
