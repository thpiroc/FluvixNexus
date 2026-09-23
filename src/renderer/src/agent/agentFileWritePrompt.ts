import type { AgentFileWriteProposedEvent, ApprovalRequestedEvent } from '@shared/ipc'
import type { SafeFileWriteDiff } from '@shared/security'

/**
 * 「今 出すべき承認の画面」を決める（Security Core v1 の STEP7）。
 *
 * Main からは**2つの知らせが別々に届く。**
 *
 * ```
 * agent-file-write:proposed   何を書こうとしているか（Workspace 相対 Path・安全な Diff）
 * approval:requested          承認を求めている（approvalId・操作の種類）
 * ```
 *
 * 分かれているのは、承認の知らせが File Write と Terminal の両方を通る細い経路だから
 * （shared/ipc/events/agentFileWrite.ts）。画面を出してよいのは**2つが揃い、かつ
 * 同じ変更を指している**ときだけで、その判断をここに置く。
 *
 * ## 判断を Renderer に持たせない
 *
 * ここが決めるのは「**何を見せるか**」まで。承認そのものは Main が決めるため、
 * この module は `approved` を作らず、Diff も本文も作らない（届いたものを並べるだけ）。
 * 続行のときに Main へ返すのも、Main が発番した `approvalId` と意思表示だけになる。
 *
 * ## 揃わないときは出さない
 *
 * 片方しか無い・種類が File Write でない・指している Path が違う、はすべて
 * 画面を出さない。**取り違えた Diff を見せて承認させることが、いちばん避けたい形**
 * にあたる ── 見たものと書かれるものが違えば、承認の意味が無くなる。
 */

/** 画面に出す1件。 */
export interface AgentFileWritePrompt {
  /** Main が発番した承認の識別子（`approval:respond` にそのまま返す）。 */
  readonly approvalId: string
  readonly proposalId: string
  /** Workspace 相対の書き込み先。 */
  readonly workspacePath: string
  readonly newFile: boolean
  readonly diff: SafeFileWriteDiff
}

/** 揃わなかったときにどうするか。 */
export type AgentFileWriteMatch =
  /** まだ片方しか届いていない。待つ。 */
  | { readonly kind: 'waiting' }
  /** 揃った。画面を出す。 */
  | { readonly kind: 'ready'; readonly prompt: AgentFileWritePrompt }
  /**
   * 揃ったが、指している変更が違う。
   *
   * **待たずに取り消す。** 見せられない承認を期限（5 分）まで放っておくと、
   * 利用者には「何も起きない」ようにしか見えない。
   */
  | { readonly kind: 'mismatch'; readonly approvalId: string }

/**
 * 届いている2つから、画面に出すものを決める。
 *
 * `approval` が File Write 以外（Terminal）なら `waiting` ── この画面の対象ではなく、
 * 放っておけば STEP8 の画面が受け持つ。
 */
export function matchAgentFileWrite(
  proposal: AgentFileWriteProposedEvent | null,
  approval: ApprovalRequestedEvent | null
): AgentFileWriteMatch {
  if (approval === null || approval.actionKind !== 'file.write') {
    return WAITING
  }

  if (proposal === null) {
    return WAITING
  }

  if (!isSameWorkspacePath(approval.workspacePath, proposal.workspacePath)) {
    return Object.freeze({ kind: 'mismatch' as const, approvalId: approval.approvalId })
  }

  return Object.freeze({
    kind: 'ready' as const,
    prompt: Object.freeze({
      approvalId: approval.approvalId,
      proposalId: proposal.proposalId,
      workspacePath: proposal.workspacePath,
      newFile: proposal.newFile,
      diff: proposal.diff
    })
  })
}

/**
 * 2つの知らせが同じ位置を指しているか。
 *
 * 承認の知らせに載る Path は、Main が**表示のために切った後**の文字列にあたる
 * （main/security/approval/approvalSummary.ts。長ければ末尾が `…` になる）。
 * そのため「完全に同じ」だけでは、長い Path のときに必ず食い違う。
 * 切られた跡がある場合は、**切られる前の頭から一致しているか**で見る。
 *
 * 逆に、切られてもいないのに違う文字列なら、それは別の変更を指している。
 */
export function isSameWorkspacePath(approvalPath: string | null, proposalPath: string): boolean {
  if (typeof approvalPath !== 'string' || typeof proposalPath !== 'string') {
    return false
  }

  if (approvalPath === proposalPath) {
    return true
  }

  if (!approvalPath.endsWith(TRUNCATION_MARK)) {
    return false
  }

  const head = approvalPath.slice(0, -TRUNCATION_MARK.length)

  return head.length > 0 && proposalPath.startsWith(head)
}

/** Main が切った跡に使う印（main/security/approval/approvalSummary.ts と同じ）。 */
const TRUNCATION_MARK = '…'

const WAITING: AgentFileWriteMatch = Object.freeze({ kind: 'waiting' })

/**
 * 差分の行に付ける印。
 *
 * 画面では色でも見分けられるが、**印を文字としても出す** ── 色だけに頼ると、
 * 色の区別が付きにくい環境で「足した行」と「消した行」が読み分けられない。
 */
export function diffLineMark(kind: SafeFileWriteDiff['lines'][number]['kind']): string {
  switch (kind) {
    case 'added':
      return '+'

    case 'removed':
      return '-'

    case 'context':
      return ' '
  }
}
