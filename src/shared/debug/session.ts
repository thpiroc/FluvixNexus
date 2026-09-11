/**
 * Debug Session の状態と、実行制御の結末（Session 6-4）。
 *
 * Renderer が知ってよいのは**この形だけ**になる（docs/ARCHITECTURE.md §20.8）。
 * DAP の request 名（`next` / `stepIn` …）も、`threadId` も、adapter の文言も
 * ここには現れない ── それらは Main の持ち物で、main/debug/ に閉じている。
 *
 * ```
 * 状態 … idle / starting / running / stopped / terminating の5つ
 * 結末 … accepted / rejected / failed の3つと、その理由（閉じた集合）
 * ```
 */

/**
 * Debug Session の状態（Session 6-2 で Main に置いたものを、6-4 で shared へ出した）。
 *
 * 状態機械そのもの（どこからどこへ動けるか）は main/debug/debugSessionState.ts に残す。
 * Renderer が持つのは「今どれか」だけで、遷移を起こす力は無い。
 */
export type DebugSessionState = 'idle' | 'starting' | 'running' | 'stopped' | 'terminating'

/**
 * Renderer から頼める実行制御（Stop を除く5つ）。
 *
 * **app-domain の名前であって、DAP の request 名ではない。** `stepOver` が
 * DAP では `next` になる、といった翻訳は Main の中（main/debug/executionControl.ts）で閉じる
 * ── この名前を DAP へそのまま流す経路は無い。
 */
export type DebugExecutionControl = 'continue' | 'pause' | 'stepOver' | 'stepInto' | 'stepOut'

/** 5つの実行制御（閉じた集合。Main の翻訳表がこれを網羅していることをテストで固定する）。 */
export const DEBUG_EXECUTION_CONTROLS: readonly DebugExecutionControl[] = [
  'continue',
  'pause',
  'stepOver',
  'stepInto',
  'stepOut'
]

/**
 * 断った理由（adapter へは何も送っていない）。
 *
 * ```
 * no-session    … Debug Session が無い（idle）
 * invalid-state … 今の状態では意味が無い（running 中の Step、stopped 中の Pause、starting / terminating）
 * busy          … 前に頼んだ実行制御の答えがまだ返っていない
 * ```
 */
export type DebugControlRejection = 'no-session' | 'invalid-state' | 'busy'

/**
 * 送ったが、頼んだとおりにならなかった理由。
 *
 * ```
 * adapter-rejected … adapter が失敗を返した（文言は Renderer へ返さない。下記）
 * session-ended    … 答えが返る前にセッションが終わった / 入れ替わった
 * no-thread        … 止める / 進める相手のスレッドが見つからなかった
 * timeout          … 待てる時間のうちに答えが返らなかった
 * ```
 *
 * **adapter の `message` はここに載せない。** adapter が組み立てた文字列は
 * 絶対パスを含みうる（Session 6-3 の breakpoint と同じ判断。§20.12）。
 */
export type DebugControlFailure = 'adapter-rejected' | 'session-ended' | 'no-thread' | 'timeout'

/**
 * 実行制御 / Stop の結末。
 *
 * **失敗を IPC の失敗にしない。** 「stopped でないので Step できない」は利用者の操作に
 * 対する普通の答えで、例外ではない ── Git の操作が結末を値で返すのと同じ形（§14.7）。
 * `state` は答えた時点の状態で、画面が次に何を押せるかを決めるのに使える。
 */
export type DebugControlOutcome =
  | { readonly status: 'accepted'; readonly state: DebugSessionState }
  | {
      readonly status: 'rejected'
      readonly reason: DebugControlRejection
      readonly state: DebugSessionState
    }
  | {
      readonly status: 'failed'
      readonly reason: DebugControlFailure
      readonly state: DebugSessionState
    }
