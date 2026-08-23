import type { GitOperationOutcome, GitRepositoryState } from '@shared/git'
import { readGitRepositoryOutcome, type GitRepositoryOutcome } from './gitRepository'

/**
 * 書き込み操作の応答を組み立てる共通部分（Session 3-8-3 / 3-8-4）。
 *
 * Stage / Unstage（gitStage.ts）と Commit（gitCommit.ts）は動かすものが違うが、
 * **結末の返し方は1つの決めごと**になっている ── どちらも操作の後に必ず
 * 状態を読み直し、成功でも失敗でもその新しい状態を応答に載せる
 * （shared/ipc/contracts/git.ts）。
 *
 * その決めごとを2箇所に書くと、片方だけ直された時点で「Commit のときだけ
 * 失敗すると古い一覧が残る」といった差が生まれる。Session 3-8-4 で
 * 2つめの利用者ができた時点で、ここへ寄せてある。
 */

/** 応答がそのまま持つ形（IPC のハンドラは受け取ったものを詰め替えるだけ）。 */
export interface GitOperationResult {
  readonly workspaceId: string | null
  readonly repository: GitRepositoryState
  readonly outcome: GitOperationOutcome
}

/**
 * 操作の後に状態を読み直して、応答の形にまとめる。
 *
 * **読み直しそのものが失敗しても、操作の結末は書き換えない。** 操作は通ったのに
 * 直後の読み取りだけが失敗した、という場合に「操作に失敗した」と出すと、
 * 利用者はもう一度押すことになる（Stage なら二度手間で済むが、Commit では
 * **同じ commit がもう1つ積まれる**）。読めなかったことは `repository` の側が
 * `failed` として持つ。
 *
 * 呼ぶのは順番待ちの枠の中から（`readGitRepositoryOutcome` は待たない版）。
 */
export async function finishGitOperation(
  workspaceId: string | null,
  outcome: GitOperationOutcome
): Promise<GitOperationResult> {
  const after = await readGitRepositoryOutcome()

  return { workspaceId: after.workspaceId ?? workspaceId, repository: after.repository, outcome }
}

/**
 * もう操作できる状態ではない（Workspace が閉じられた・リポジトリでなくなった）。
 *
 * git は動かさない。読んだばかりの状態をそのまま返す ── 取り直しても同じで、
 * 一度多く git を起動する意味が無い。
 */
export function notReadyGitOperation(before: GitRepositoryOutcome): GitOperationResult {
  return {
    workspaceId: before.workspaceId,
    repository: before.repository,
    outcome: { status: 'failed', reason: 'not-ready' }
  }
}
