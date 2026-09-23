import type { SafeFileWriteDiff } from '../../security/fileWriteDiff'

/**
 * FN Agent の File Write の提案を Renderer へ知らせるイベント（Security Core v1 の STEP7）。
 *
 * 承認そのものは STEP6 の `approval:requested` / `approval:respond` を使う。
 * **中身（Diff）だけを別のチャンネルに分けてある** ── `approval:requested` は
 * File Write と Terminal の両方が通る細い知らせで、そこへ本文由来の値を載せると、
 * Terminal の承認にも「中身」の欄が付いて回るため（STEP6 の時点で
 * 「本文は Renderer が別の経路で読む形にする」と決めてある。DESIGN.md §6.4）。
 *
 * ```
 * agent-file-write:proposed   Main → Renderer   何を書こうとしているか（安全な Diff）
 * approval:requested          Main → Renderer   承認を求めている（STEP6。approvalId）
 * approval:respond            Renderer → Main   continue / cancel（STEP6）
 * agent-file-write:settled    Main → Renderer   その提案は終わった（画面を閉じてよい）
 * ```
 *
 * ## 載るのは Mask 済みの表示用の値だけ
 *
 * `diff` は Main が作り、1行ずつ STEP3 の Mask を通し、制御文字を潰し、長さと行数で
 * 切った後のもの（`SafeFileWriteDiff`）。**exact な提案本文・fingerprint・絶対パス・
 * 承認の状態は載らない**（型にも無い）。Renderer はこの Diff を**表示するだけ**で、
 * 書き戻す経路は無い。
 *
 * ## 提案の識別子は宛先であって Token ではない
 *
 * `proposalId` は「今出ている提案はどれか」を Renderer が取り違えないための値で、
 * これを送り返して承認になる経路は無い（返すのは STEP6 の `approvalId` と意思表示だけ）。
 */

export interface AgentFileWriteProposedEvent {
  /** その提案の識別子（Main が発番する）。 */
  readonly proposalId: string
  /** Workspace 相対の書き込み先（ディスク上の実体の綴り）。 */
  readonly workspacePath: string
  /** 新しく作るファイルか。 */
  readonly newFile: boolean
  /** 表示用の安全な Diff。 */
  readonly diff: SafeFileWriteDiff
}

export interface AgentFileWriteSettledEvent {
  /** 終わった提案の識別子。 */
  readonly proposalId: string
}

export interface AgentFileWriteIpcEventContract {
  'agent-file-write:proposed': AgentFileWriteProposedEvent
  'agent-file-write:settled': AgentFileWriteSettledEvent
}
