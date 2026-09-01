import type { GitOperationOutcome, GitRepositoryState } from '@shared/git'
import { createLogger } from '../logger'
import { commitStagedChanges, verifyCommitIdentity } from './gitCommands'
import { classifyGitCommitFailure, summarizeGitStderr } from './gitFailure'
import {
  finishGitOperation,
  guardGitInProgress,
  notReadyGitOperation,
  type GitOperationResult
} from './gitOperationResult'
import { runGitExclusively } from './gitQueue'
import { readGitRepositoryOutcome } from './gitRepository'
import { GIT_COMMIT_TIMEOUT_MS, runGit } from './runGit'

/**
 * Commit（Session 3-8-4）。
 *
 * DESIGN.md §3 の「①変更確認 → ②コミットメッセージ → ③Commit & Push」の
 * ②と③の前半にあたる。部品の分担は Stage / Unstage（gitStage.ts）と同じで、
 * ここが持つのは噛み合わせだけになる。
 *
 *   順番待ち   … gitQueue.ts（走るのは常に1本）
 *   引数       … gitCommands.ts（組み立てられる場所はそこだけ）
 *   値の検証   … shared/git/commitMessage.ts（純粋・Renderer と共有）
 *   失敗の分類 … gitFailure.ts（純粋・テスト対象）
 *   状態の読み … gitRepository.ts（操作の前後で同じ関数を使う）
 *
 * ## 1つの仕事は「読む → 確かめる → 動かす → 読み直す」
 *
 * ```
 * 1. 今の状態を読む   → Commit できる状態か / ステージ済みは何件か
 * 2. 名乗りを確かめる → user.name / user.email（動かす前に分かる）
 * 3. git commit       → メッセージは標準入力から
 * 4. もう一度読む     → 応答に載せる（成功でも失敗でも）
 * ```
 *
 * Stage / Unstage の「読む → 動かす → 読み直す」に **2 が挟まっている**のが
 * このセッションで足した形になる。理由は gitCommands.ts の
 * `verifyCommitIdentity` に書いたとおりで、名乗りの不足を commit の失敗から
 * 当てにいくと **hook の出力と混ざる**ため。
 *
 * ## 何を Commit するかを、要求から決めない
 *
 * `git commit` に pathspec も `-a` も渡さないので、対象は **index の中身そのもの**に
 * なる。Renderer から「このファイルを Commit」と言える欄は作っていない
 * （shared/ipc/contracts/git.ts）── 作ると、画面に「ステージ済み」として
 * 出ているものと、実際に Commit されるものが別々に決まりうる。
 *
 * この形の効き目がそのまま
 *
 *   staged A / unstaged B / untracked C → **A だけが Commit される**
 *
 * の保証になる。B と C は index に載っていないので、対象になりようが無い
 * （実際の git に対して gitCommitRepository.test.ts で固定してある）。
 *
 * ## 押す前に分かることは、押した後に git へ聞かない
 *
 * ステージ済みが1件も無い・競合が残っている、はどちらも 1 で読んだ状態から
 * 分かる。分かるものを git に聞かないのは、聞くと **hook が先に走る**ため ──
 * 通らないと分かっている Commit のために、リポジトリの lint やテストを
 * 動かすことになる。
 */

const log = createLogger('git')

/**
 * ステージ済みの変更を Commit する。
 *
 * `message` は検証済み（ハンドラが `normalizeGitCommitMessage` を通している）。
 * ここへ来るのは**そのまま標準入力へ流せる形**の文字列だけになる。
 */
export async function applyGitCommit(message: string): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    /*
      マージの途中では**止めない**（Session 3-8-22A）── Commit こそが
      マージの出口になる（3-8-18 の解決 → ここ）。止まるのは rebase /
      cherry-pick / revert の途中で、そちらはアプリに出口が無い
      （shared/git/inProgress.ts）。
    */
    const guarded = guardGitInProgress(before, 'commit')

    if (guarded !== null) {
      return guarded
    }

    return await finishGitOperation(
      before.workspaceId,
      await runGitCommitStep(before.repository, message)
    )
  })
}

/**
 * Commit の中身だけを行う（Session 3-8-5 で切り出し）。
 *
 * **順番待ちの枠も取らず、状態の読み直しもしない。** どちらも呼び出し側の
 * 仕事にしてあるのは、Commit & Push（main/git/gitSync.ts）が
 * **Commit と Push を1つの枠の中で続けて**動かすため ── ここで枠を取ると
 * 自分の番が終わるのを待ち続けることになり（gitQueue.ts）、ここで読み直すと
 * Push の前に1回、後にもう1回と、意味の無い読み取りが増える。
 *
 * `repository` は呼び出し側が `ready` を確かめたもの。**それをそのまま渡させる**
 * のは、Commit & Push が同じ読み取りから Push の可否も決めるため ──
 * ここでもう一度読むと、その2つが別の瞬間の写しになる。
 */
export async function runGitCommitStep(
  repository: Extract<GitRepositoryState, { status: 'ready' }>,
  message: string
): Promise<GitOperationOutcome> {
  const blocked = findBlockingState(repository)

  if (blocked !== null) {
    return { status: 'failed', reason: blocked }
  }

  const identity = await hasCommitIdentity()

  if (identity !== true) {
    /*
      名乗りを確かめられなかった場合（git を動かせなかった）も進めない。
      分からないまま commit を走らせると hook だけが走って失敗する。
    */
    return { status: 'failed', reason: identity === false ? 'identity-missing' : 'unknown' }
  }

  return await runCommit(message)
}

/**
 * 1 で読んだ状態だけで分かる「Commit できない理由」。無ければ null。
 *
 * **順番に意味がある。** 競合を先に見るのは、競合が残っている状態では
 * ステージ済みが何件あろうと git が commit を作らないため ── 件数の方を
 * 先に返すと「ステージ済みはあるのに Commit できない」の理由が出ない。
 */
function findBlockingState(
  repository: Extract<GitRepositoryState, { status: 'ready' }>
): 'unresolved-conflicts' | 'nothing-to-do' | null {
  if (repository.changes.conflicted.length > 0) {
    return 'unresolved-conflicts'
  }

  /*
    空の Commit を作る経路（`--allow-empty`）は持たない。押すまでの間に
    他の経路（端末での `git commit`）で index が空になっていた場合にここへ来る。
  */
  if (repository.changes.staged.length === 0) {
    return 'nothing-to-do'
  }

  return null
}

/**
 * Commit に使う名乗りが決まっているか。git を動かせなければ null。
 *
 * `git var GIT_AUTHOR_IDENT` は決まっていれば 0、決まっていなければ 128 で終わる
 * （gitCommands.ts）。**分からないまま「決まっている」側へ倒さない** ── 倒すと
 * hook を走らせた末に、分類できない失敗として返ることになる。
 */
async function hasCommitIdentity(): Promise<boolean | null> {
  const outcome = await runGit(verifyCommitIdentity())

  if (outcome.status !== 'completed') {
    return null
  }

  if (outcome.exitCode === 0) {
    return true
  }

  return outcome.exitCode === 128 ? false : null
}

/**
 * `git commit` を1回動かす。
 *
 * メッセージは**引数ではなく標準入力**へ流す（gitCommands.ts の
 * `commitStagedChanges`）。待ち時間の上限が他より長いのは、ここでだけ
 * 利用者の hook が走るため（runGit.ts の `GIT_COMMIT_TIMEOUT_MS`）。
 */
async function runCommit(message: string): Promise<GitOperationOutcome> {
  const outcome = await runGit(commitStagedChanges(), {
    input: `${message}\n`,
    timeoutMs: GIT_COMMIT_TIMEOUT_MS
  })

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
    hook の出力は stdout 側に出ることも多い（stderr は空のまま落ちる hook もある）。
    分類には使わないが、原因を追えるようにログには残す ── Renderer へは
    分類だけが渡る方針は 3-8-1 のまま（shared/git/operation.ts）。
  */
  const trailing = outcome.stdout.trim()

  if (trailing.length > 0) {
    log.info(`git commit exited ${outcome.exitCode} with stdout: ${summarizeGitStderr(trailing)}`)
  }

  return { status: 'failed', reason: classifyGitCommitFailure(outcome.exitCode, outcome.stderr) }
}
