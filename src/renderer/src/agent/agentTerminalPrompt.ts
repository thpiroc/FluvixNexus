import type { AgentTerminalProposedEvent, ApprovalRequestedEvent } from '@shared/ipc'
import type { SafeTerminalCommandDisplay } from '@shared/security'

/**
 * 「今 出すべき Terminal の確認の画面」を決める（Security Core v1 の STEP8）。
 *
 * File Write（agentFileWritePrompt.ts）と同じく、Main からは**2つの知らせが別々に届く。**
 *
 * ```
 * agent-terminal:proposed   何を実行しようとしているか（Mask 済みの command / 引数 / 場所）
 * approval:requested        承認を求めている（approvalId・操作の種類・1行の要約）
 * ```
 *
 * 画面を出してよいのは**2つが揃い、かつ同じコマンド・同じ場所を指している**ときだけ。
 * Terminal の要約は切られない（STEP8。main/security/approval/approvalSummary.ts）ため、
 * 1行の要約と場所が**完全に一致する**ことで見る（File Write の Path のような
 * 「切られた跡があれば頭で比べる」は要らない）。
 *
 * ## 判断を Renderer に持たせない
 *
 * ここが決めるのは「何を見せるか」まで。承認するかは Main が決め、この module は
 * `approved` もコマンドも作らない（届いたものを並べるだけ）。
 */

/** 画面に出す1件。 */
export interface AgentTerminalPrompt {
  /** Main が発番した承認の識別子（`approval:respond` にそのまま返す）。 */
  readonly approvalId: string
  readonly proposalId: string
  readonly command: SafeTerminalCommandDisplay
}

export type AgentTerminalMatch =
  /** まだ片方しか届いていない。待つ。 */
  | { readonly kind: 'waiting' }
  /** 揃った。画面を出す。 */
  | { readonly kind: 'ready'; readonly prompt: AgentTerminalPrompt }
  /** 揃ったが、指しているコマンドが違う。**待たずに取り消す。** */
  | { readonly kind: 'mismatch'; readonly approvalId: string }

/**
 * 届いている2つから、画面に出すものを決める。
 *
 * `approval` が Terminal 以外（File Write）なら `waiting` ── この画面の対象ではない。
 */
export function matchAgentTerminal(
  proposal: AgentTerminalProposedEvent | null,
  approval: ApprovalRequestedEvent | null
): AgentTerminalMatch {
  if (approval === null || approval.actionKind !== 'terminal.run' || proposal === null) {
    return WAITING
  }

  const { command } = proposal

  if (
    approval.commandSummary !== command.commandSummary ||
    approval.workspacePath !== command.workspacePath
  ) {
    return Object.freeze({ kind: 'mismatch' as const, approvalId: approval.approvalId })
  }

  return Object.freeze({
    kind: 'ready' as const,
    prompt: Object.freeze({
      approvalId: approval.approvalId,
      proposalId: proposal.proposalId,
      command
    })
  })
}

const WAITING: AgentTerminalMatch = Object.freeze({ kind: 'waiting' })
