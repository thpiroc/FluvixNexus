/**
 * FN Agent の作業（Agent Task）の状態（Security Core v1 の STEP9）。
 *
 * Main（main/agent/）が持ち、Renderer の Agent パネルへ**表示のためだけに**配る。
 * Renderer はこの値から判断しない ── 次の Action へ進むか・止めるかを決めるのは
 * いつも Main の Agent Loop で、Renderer が送れるのは「始めて」「止めて」
 * 「上限に達したが続けて / やめて」の3つの意思表示だけ（contracts/agentTask.ts）。
 *
 * ## 載せないもの
 *
 * Tool の詳細ログ・ファイルの中身・コマンドの出力・Provider への要求と応答・絶対パスは
 * **型にも無い。** 画面に出すのは「今なにをしているか」の1行と最終回答だけ
 * （2026-09-23 確定: Tool 詳細ログを大量に垂れ流さない）。File Write / Terminal の中身は、
 * STEP7 / STEP8 の承認画面がそれぞれの経路で見せる。
 *
 * ## 残らない
 *
 * 状態は Main のメモリだけにある。FN の終了・クラッシュ・再起動の後に途中の作業を
 * 復元しない（2026-09-23 確定）。
 */

/** 作業全体の状態。 */
export type AgentTaskStatus =
  /** 何もしていない（まだ始めていない）。 */
  | 'idle'
  /** 動いている。 */
  | 'running'
  /** Loop の上限に達し、続けるかを利用者に尋ねている。 */
  | 'awaiting-continue'
  /** 停止を受け付け、実行中の Tool（Terminal など）が終わるのを待っている。 */
  | 'stopping'
  /** AI が complete を返し、FN 側でも未処理が無いと確かめて終わった。 */
  | 'completed'
  /** 利用者の停止・上限での中止・Agent の OFF・Workspace の切り替えで止まった。 */
  | 'stopped'
  /** 続けられない理由で止まった（AI へ送れない・壊れた応答が続いた など）。 */
  | 'failed'

/** 今している作業の種類（パネルの1行に出す）。 */
export type AgentTaskPhase =
  /** AI（STEP9 では Scripted Provider）が次の Action を決めている。 */
  | 'thinking'
  /** Workspace の構造・状態を見ている（workspace_list / workspace_status）。 */
  | 'investigating'
  /** ファイルを読んでいる（file_read）。 */
  | 'reading'
  /** Workspace の中を探している（file_search）。 */
  | 'searching'
  /** 変更を提案し、承認を待っている（file_write）。 */
  | 'proposing-change'
  /** コマンドを提案し、承認を待っている・実行している（terminal_run）。 */
  | 'running-command'

/** 終わった理由（閉じた集合）。 */
export type AgentTaskEndReason =
  | 'completed'
  | 'user-stopped'
  | 'loop-limit-declined'
  | 'agent-disabled'
  | 'workspace-changed'
  | 'provider-failed'
  /** AI Provider から時間内（120 秒）に応答が無かった（STEP10-3）。 */
  | 'provider-timeout'
  /** AI Provider の応答が上限を超えた（STEP10-3）。 */
  | 'provider-response-too-large'
  /** AI Provider の認証に失敗した（HTTP 401 相当。STEP10-4）。 */
  | 'provider-authentication-failed'
  /** AI Provider の利用権限が無かった（HTTP 403 相当。STEP10-4）。 */
  | 'provider-authorization-failed'
  | 'context-denied'
  | 'context-budget-exceeded'
  | 'too-many-invalid-actions'
  | 'internal-error'

/** Renderer へ配る状態。 */
export interface AgentTaskState {
  readonly status: AgentTaskStatus
  /** 動いている間だけ。 */
  readonly phase: AgentTaskPhase | null
  /**
   * 今の作業の対象（Workspace 相対の位置・コマンドの名前）。**Main が伏せて短くした後の値。**
   * 無ければ `null`。
   */
  readonly subject: string | null
  /**
   * これまでに使った Turn の数（AI から通った応答を受け取った回数）。Provider への呼び直しは
   * 数えない（STEP10-4）。
   */
  readonly loopsUsed: number
  /** 今の上限（初期 20、続行するたびに +10）。 */
  readonly loopLimit: number
  /** 最終回答（completed のときだけ）。**Main が伏せて長さで切った後の文字列。** */
  readonly finalAnswer: string | null
  readonly endReason: AgentTaskEndReason | null
  /** Agent 全体の ON / OFF（設定。OFF なら始められない）。 */
  readonly agentEnabled: boolean
  /** AI の Provider を使えるか（STEP9 は開発ビルドの Scripted Provider だけ）。 */
  readonly providerAvailable: boolean
}

/** 始められなかった理由。 */
export type AgentTaskStartRejection =
  'busy' | 'agent-disabled' | 'no-workspace' | 'provider-unavailable' | 'invalid-prompt'

export type AgentTaskStartResult =
  { readonly started: true } | { readonly started: false; readonly reason: AgentTaskStartRejection }

/** Loop の上限に達したときの利用者の返事。 */
export type AgentTaskContinueDecision = 'continue' | 'stop'

/** 指示の文字数の上限。 */
export const AGENT_TASK_PROMPT_MAX_LENGTH = 20_000

/** 最初の Loop の上限（Turn の数 = AI から通った応答を受け取る回数）。 */
export const AGENT_INITIAL_LOOP_LIMIT = 20

/** 上限に達して「続ける」を選んだときに足す回数。 */
export const AGENT_LOOP_EXTENSION = 10

/** 動いている（停止ボタンを出す）状態か。 */
export function isAgentTaskActive(status: AgentTaskStatus): boolean {
  return status === 'running' || status === 'awaiting-continue' || status === 'stopping'
}
