import type {
  GitGuardedOperation,
  GitOperationFailureReason,
  GitOperationOutcome,
  GitRepositoryState
} from '@shared/git'
import { isGitOperationBlockedWhileInProgress } from '@shared/git'
import { createLogger } from '../logger'
import { summarizeGitStderr } from './gitFailure'
import { readGitRepositoryOutcome, type GitRepositoryOutcome } from './gitRepository'
import type { GitRunOutcome } from './runGit'

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
 *
 * ## Session 3-8-10 で、もう1つの共通部分が移ってきた
 *
 * `toGitOperationOutcome`（1回の実行 → 操作の結末）は 3-8-5 で gitSync.ts に
 * 置かれたものになる。GitHub への公開（main/github/publishRepository.ts）が
 * **git を動かす3つめの場所**になった時点で、あちらに置いたままだと
 * 「Push / Pull の中の私的な関数」を別のドメインから使うことになる ──
 * どちらの利用者にも属さない決めごとは、応答の形と同じくここへ寄せる。
 */

const log = createLogger('git')

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

/**
 * 途中の Git 操作があるあいだ通さない操作なら、その断りを組み立てる
 * （Session 3-8-22A）。通してよければ null。
 *
 * ## Renderer の判定は、許可の根拠にしない
 *
 * 同じ表（shared/git/inProgress.ts）を Renderer も読んでいて、押せないボタンは
 * そもそも出ない。それでもここで確かめ直すのは、Files のドラッグ&ドロップと
 * 同じ理由になる ── **Renderer 側の判定は「できない操作を見せない」ための
 * ものであって、許可の根拠ではない。**
 *
 * しかも画面は古いまま押されうる。マージが端末で始まった直後・
 * 中止された直後のどちらでも、押した瞬間の状態はここで読み直したものが正しい
 * （3-8-9 の破棄・3-8-18 の解決が「届いた対象を読み直した状態で確かめ直す」と
 * したのと同じ形）。
 *
 * ## git を1回も動かさない
 *
 * 断るのに必要なものは、既に読んである `before` の中に全部ある。
 * `notReadyGitOperation` と同じく状態を取り直さずにそのまま返す ──
 * 取り直しても同じで、一度多く git を起動する意味が無い。
 */
export function guardGitInProgress(
  before: GitRepositoryOutcome,
  operation: GitGuardedOperation
): GitOperationResult | null {
  if (before.repository.status !== 'ready') {
    return null
  }

  if (!isGitOperationBlockedWhileInProgress(before.repository.inProgress, operation)) {
    return null
  }

  log.info(`git ${operation} refused: ${before.repository.inProgress} is in progress.`)

  return {
    workspaceId: before.workspaceId,
    repository: before.repository,
    outcome: { status: 'failed', reason: 'operation-in-progress' }
  }
}

/**
 * 1回の実行の結末を、操作の結末へ翻訳する（Session 3-8-5 / 3-8-10）。
 *
 * 分類の表だけを差し替えられるようにしてあるのは、**同じ終わり方でも
 * 読み方が違う**ため（gitFailure.ts）── fetch に「断られた」は無く、
 * merge にネットワークの失敗は無い。
 *
 * `git-unavailable` / `no-workspace` を `not-ready` に寄せているのは
 * Stage / Commit と同じで、どちらも「もう操作できる状態ではない」にあたる。
 * 一緒に返る `repository` が新しい状態を持っているので、画面はそちらへ切り替わる。
 */
export function toGitOperationOutcome(
  outcome: GitRunOutcome,
  classify: (stderr: string) => GitOperationFailureReason
): GitOperationOutcome {
  switch (outcome.status) {
    case 'no-workspace':
    case 'git-unavailable':
      return { status: 'failed', reason: 'not-ready' }

    case 'failed':
      return { status: 'failed', reason: outcome.reason === 'timeout' ? 'timeout' : 'unknown' }

    case 'completed':
      break
  }

  if (outcome.exitCode === 0) {
    return { status: 'applied' }
  }

  /*
    push / fetch は進捗も要約も stderr へ書く（`--quiet` でも remote からの
    `remote:` 行は残る）。分類に使うのはその文字列だが、Renderer へ渡すのは
    分類だけという方針は 3-8-1 のまま ── 原因を追う手立てはログに残す。
  */
  const trailing = outcome.stdout.trim()

  if (trailing.length > 0) {
    log.info(`git exited ${outcome.exitCode} with stdout: ${summarizeGitStderr(trailing)}`)
  }

  return { status: 'failed', reason: classify(outcome.stderr) }
}
