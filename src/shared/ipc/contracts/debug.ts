import type { DebugBreakpoint } from '../../debug/breakpoint'
import type { DebugCallStackSnapshot } from '../../debug/callStack'
import type { DebugControlOutcome } from '../../debug/session'
import type {
  DebugScopesResult,
  DebugVariableHandle,
  DebugVariablesResult
} from '../../debug/variables'

/**
 * debug ドメインの IPC 契約（Session 6-3 ── Breakpoint / Session 6-4 ── 実行制御）。
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
 * ## 実行制御は、操作ごとに口を分ける（Session 6-4）
 *
 * ```
 * debug:continue   debug:pause   debug:step-over   debug:step-into   debug:step-out
 * debug:stop
 * ```
 *
 * **要求はどれも `void`。** `{ command: 'next' }` のような1つの口にすると、
 * 欄の中身が DAP の request 名と1対1に見え、「method 名を渡す口」との距離が縮む
 * ── 口の名前で操作が決まる形にしてある（§20.9）。`threadId` も受け取らない。
 * どのスレッドを動かすかは Main が adapter の答えから決める（スレッドを選ぶのは
 * Call Stack の Session 6-5）。
 *
 * 応答は結末（`DebugControlOutcome`）で、**断ったことも値で返す**。「stopped でないので
 * Step できない」は利用者の操作への普通の答えで、IPC の失敗ではない。
 *
 * ## 実行を始める口はまだ無い
 *
 * `debug:start` は Debug Profile（Session 6-9）が入るまで現れない。起動を頼めない以上、
 * Session 6-4 の口が相手にするのは Main が立てたセッションだけになる。
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

export interface DebugCallStackResponse {
  /** 今の Workspace の Call Stack。絶対パス・file URI・sourceReference は含まない。 */
  readonly callStack: DebugCallStackSnapshot
}

/**
 * その frame の Scope を読む（Session 6-6）。
 *
 * `frameId` は Call Stack snapshot に載っていた値で、Main は**今の snapshot に
 * 実在し、今の停止・今の Workspace に属する frame だけ**を通す（Session 6-5 の
 * `getDebugCallStackFrameHandle`）。任意の数を入れても adapter へは届かない。
 */
export interface ListDebugScopesRequest {
  readonly frameId: number
}

/**
 * その Scope / Variable の子を読む（Session 6-6）。
 *
 * 渡せるのは **Main が発行した handle だけ**。DAP の `variablesReference` を
 * 指す欄は無く、数値を入れても handle として扱われない。
 */
export interface ListDebugVariablesRequest {
  readonly handle: DebugVariableHandle
}

export interface DebugScopesResponse {
  readonly result: DebugScopesResult
}

export interface DebugVariablesResponse {
  readonly result: DebugVariablesResult
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
  /**
   * 今の Workspace の Call Stack snapshot を読む。
   *
   * 要求に `threadId` / `frameId` / DAP method 名は無い。停止イベントを受けて
   * Main が `threads` → `stackTrace` を取り、safe domain model に落とした写しだけを返す。
   */
  'debug:list-call-stack': {
    request: void
    response: DebugCallStackResponse
  }
  /**
   * Call Stack の frame の Scope を読む（Session 6-6）。
   *
   * 止まっていない・古い frame は IPC の失敗ではなく `unavailable` として値で返る
   * （押した直後に再開した、は利用者の操作への普通の答え）。形の壊れた要求だけが
   * INVALID_REQUEST になる。
   */
  'debug:list-scopes': {
    request: ListDebugScopesRequest
    response: DebugScopesResponse
  }
  /**
   * Scope / Variable の子を読む（Session 6-6。lazy expansion の1段ぶん）。
   *
   * 子に中身があれば、その子の handle も Main が新しく発行して載せる。
   */
  'debug:list-variables': {
    request: ListDebugVariablesRequest
    response: DebugVariablesResponse
  }
  /** 止まっているプログラムを再開する（stopped のときだけ）。 */
  'debug:continue': {
    request: void
    response: DebugControlOutcome
  }
  /** 走っているプログラムを止める（running のときだけ）。止まったことは後から届く。 */
  'debug:pause': {
    request: void
    response: DebugControlOutcome
  }
  /** 次の文へ進む（stopped のときだけ）。 */
  'debug:step-over': {
    request: void
    response: DebugControlOutcome
  }
  /** 呼び出しの中へ入る（stopped のときだけ）。 */
  'debug:step-into': {
    request: void
    response: DebugControlOutcome
  }
  /** 今の関数から出る（stopped のときだけ）。 */
  'debug:step-out': {
    request: void
    response: DebugControlOutcome
  }
  /**
   * Debug Session を終わらせる（starting / running / stopped / terminating）。
   *
   * **答えるのはセッションが idle へ戻り終えてから**で、何度頼んでも同じ終わりを待つ。
   * 2回目は「穏やかに」から「無条件に」へ切り替わる（main/debug/executionControl.ts）。
   */
  'debug:stop': {
    request: void
    response: DebugControlOutcome
  }
}
