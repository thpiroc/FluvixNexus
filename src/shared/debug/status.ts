import type { DebugSessionState } from './session'

/**
 * 画面に出す Debug の状態（Session 6-9）。
 *
 * ## Renderer へ渡すのは、この1語だけ
 *
 * ```
 * 渡すもの     … 下の6つのどれか1つ
 * 渡さないもの … sessionId・generation・adapter の名前 / 実行ファイル / 引数 / cwd・
 *                絶対パス・起動に失敗した理由の文言
 * ```
 *
 * `lsp:status-changed`（shared/lsp/serverStatus.ts）と同じ線にある。画面に出したいのは
 * 「今デバッグがどうなっているか」であって、どの adapter がどこで動いているか、ではない。
 *
 * ## 状態は、既にある事実から**導く**
 *
 * 新しい状態の持ち主は作っていない。5つは Main の Debug Session の状態
 * （main/debug/debugSessionState.ts の遷移表）そのもので、`unavailable` だけが
 * adapter catalog（main/debug/adapterCatalog.ts）から乗る ── LSP の `disabled` が
 * 設定から乗るのと同じ2段にしてある。
 *
 * **状態機械に `unavailable` や `failed` を足していない。** 6-2 の遷移表は
 * 6-3 〜 6-8 のすべてが依存しているため、表示のための語をそこへ混ぜない。
 *
 * ## `failed`（起動失敗）が無い理由
 *
 * 起動に失敗したセッションは `idle` へ戻る ── それが Main の事実で、ステータスバーは
 * その事実だけを出す。「さっき失敗した」を出し続けるには、Main に**いつ消えるのか**を
 * 決めた2つめの状態を持たせることになり、状態の正本が2つになる。
 * 失敗の理由は起動を頼んだ操作への答えとして返す（起動の口を入れる Session の仕事）。
 */

/**
 * 画面に出す状態。
 *
 * ```
 * unavailable … セッションが無く、この版 / この PC で起動できる adapter が1つも無い
 * idle        … セッションが無い（起動はできる）
 * starting    … adapter を立て、configurationDone までの間
 * running     … プログラムが走っている
 * stopped     … 止まっている（breakpoint / step / pause）── 画面では「一時停止」と読む
 * terminating … 終わらせている途中
 * ```
 */
export type DebugSessionStatus = DebugSessionState | 'unavailable'

/**
 * 閉じた集合（並べる順）。
 *
 * 意味の重さの順ではない。**Renderer はこの外の語を受け取らない**
 * （`isDebugSessionStatus`）── 知らない語を翻訳キーへそのまま差し込む経路を作らない。
 */
export const DEBUG_SESSION_STATUSES = [
  'unavailable',
  'idle',
  'starting',
  'running',
  'stopped',
  'terminating'
] as const satisfies readonly DebugSessionStatus[]

/**
 * セッションの状態と adapter の有無から、画面に出す状態を決める。
 *
 * **動いているセッションがあれば、adapter の有無は見ない。** セッションが立っている
 * 以上 adapter はそこに在り、`unavailable` と出すと嘘になる。
 * `unavailable` が乗るのは `idle` の上だけで、そのため `unavailable` を受け取った側は
 * 「セッションは無い」と読める（`idle` の情報は失われない）。
 */
export function resolveDebugSessionStatus(
  state: DebugSessionState,
  adapterAvailable: boolean
): DebugSessionStatus {
  if (state !== 'idle') {
    return state
  }

  return adapterAvailable ? 'idle' : 'unavailable'
}

/** 素の値が、画面に出す状態の1語か。 */
export function isDebugSessionStatus(value: unknown): value is DebugSessionStatus {
  return typeof value === 'string' && (DEBUG_SESSION_STATUSES as readonly string[]).includes(value)
}
