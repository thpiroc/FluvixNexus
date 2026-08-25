import type { GitCommitHistory } from '@shared/git'
import { GIT_COMMIT_HISTORY_LIMIT } from '@shared/git'
import { createLogger } from '../logger'
import { listCommitHistory } from './gitCommands'
import { summarizeGitStderr } from './gitFailure'
import { readCommitHistory } from './gitOutput'
import { runGitExclusively } from './gitQueue'
import { hasGitHeadCommit, readGitRepositoryOutcome } from './gitRepository'
import { runGit } from './runGit'

/**
 * commit の履歴を読む（Session 3-8-11）。
 *
 * 部品の分担はブランチの一覧（gitBranches.ts）とまったく同じで、ここが持つのは
 * 噛み合わせだけになる。
 *
 *   順番待ち   … gitQueue.ts（走るのは常に1本）
 *   引数       … gitCommands.ts（組み立てられる場所はそこだけ）
 *   出力の読み … gitOutput.ts（純粋・テスト対象）
 *   状態の読み … gitRepository.ts（他の操作と同じ関数）
 *
 * ## 新しい形が1つも要らなかった
 *
 * `GitOperationResult` を返さないのは、**何も書き換えない**ため
 * （`listGitBranches` と同じ）。応答に「操作後の状態」も載らない ──
 * この面から動かせる git は `log` の1本だけで、リポジトリは1バイトも変わらない。
 *
 * ## commit が無いリポジトリを、失敗にしない
 *
 * `git log` は HEAD の指す先が無いと**非0で終わる**（`fatal: your current
 * branch 'main' does not have any commits yet`）。それをそのまま `failed` に
 * すると、`git init` した直後のリポジトリで「履歴を取得できませんでした」と
 * 出ることになる。
 *
 * そこで、動かす前に `hasGitHeadCommit` で分けておく ── これは Unstage
 * （gitStage.ts）と Push（gitSync.ts）が既に使っている**同じ関数**で、
 * 「まだ commit が無い」という同じ問いに対して別の判定を新しく置かない。
 *
 * 分からなかった場合（null）は `failed` に倒す ── 空の履歴として出すと、
 * commit が積まれているリポジトリで「まだ commit がありません」と嘘をつく。
 */

const log = createLogger('git')

/** 履歴の問い合わせの答え（IPC の応答がそのまま持つ形）。 */
export interface GitCommitHistoryOutcome {
  readonly workspaceId: string | null
  readonly history: GitCommitHistory
}

/**
 * HEAD からさかのぼって commit を一覧する。
 *
 * ## 順番待ちを通す
 *
 * 読み取りだけだが、枠を取る（`listGitBranches` と同じ理由）── HEAD の有無を
 * 確かめてから `git log` を動かすまでの間に切り替えや Commit が挟まると、
 * **確かめた状態と読んだ履歴が別の瞬間のもの**になる。
 *
 * ## 先に「操作してよい状態か」を確かめる
 *
 * `log` は Workspace root がリポジトリ root でなくても答えるが、その手前で
 * 止める ── Git 操作を行わないと決めた状態（`nested` など。設計判断 10）で
 * リポジトリの中身を見せる形にはしない。確かめ方は他の操作と同じ
 * `readGitRepositoryOutcome` で、専用の軽い判定を別に置かない。
 */
export async function listGitCommits(): Promise<GitCommitHistoryOutcome> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return { workspaceId: before.workspaceId, history: { status: 'not-ready' } as const }
    }

    return { workspaceId: before.workspaceId, history: await readHistory() }
  })
}

/**
 * HEAD の有無を確かめてから、`git log` を1回動かして読む。
 *
 * **読めなかったことを失敗の分類に落とさない**（`failed` の1種類だけ）──
 * 履歴が出せないときに利用者が取れる手は「開き直す」しか無く、理由で
 * 次の一手が変わらないため（分類の粒度の基準は gitFailure.ts）。
 */
async function readHistory(): Promise<GitCommitHistory> {
  const hasCommit = await hasGitHeadCommit()

  if (hasCommit === null) {
    return { status: 'failed' }
  }

  /*
    `git init` の直後・生まれたてのブランチ（`switch --orphan` は持たないが、
    初回 commit の前は必ずここを通る）。**失敗ではなく、空が正しい答え**に
    あたる（ブランチの一覧が空で返るのと同じ形。main/git/gitBranches.ts）。
  */
  if (!hasCommit) {
    return { status: 'ready', commits: [], truncated: false }
  }

  const outcome = await runGit(listCommitHistory(GIT_COMMIT_HISTORY_LIMIT))

  switch (outcome.status) {
    case 'no-workspace':
    case 'git-unavailable':
      // 問い合わせている間に閉じられた／git が消えた。次に開いたときは案内が出る。
      return { status: 'not-ready' }

    case 'failed':
      return { status: 'failed' }

    case 'completed':
      break
  }

  if (outcome.exitCode !== 0) {
    log.info(`git log exited ${outcome.exitCode}: ${summarizeGitStderr(outcome.stderr)}`)
    return { status: 'failed' }
  }

  const reading = readCommitHistory(outcome.stdout, GIT_COMMIT_HISTORY_LIMIT)

  return { status: 'ready', commits: reading.commits, truncated: reading.truncated }
}
