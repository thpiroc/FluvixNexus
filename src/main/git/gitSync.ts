import type {
  GitOperationFailureReason,
  GitOperationOutcome,
  GitRepositoryState
} from '@shared/git'
import { createLogger } from '../logger'
import {
  fetchFromRemote,
  listRemotes,
  mergeUpstreamFastForwardOnly,
  pushSettingUpstream,
  pushToUpstream
} from './gitCommands'
import { runGitCommitStep } from './gitCommit'
import {
  classifyGitFetchFailure,
  classifyGitMergeFailure,
  classifyGitPushFailure,
  summarizeGitStderr
} from './gitFailure'
import {
  finishGitOperation,
  notReadyGitOperation,
  type GitOperationResult
} from './gitOperationResult'
import { runGitExclusively } from './gitQueue'
import { hasGitHeadCommit, readGitRepositoryOutcome } from './gitRepository'
import { GIT_COMMIT_TIMEOUT_MS, GIT_NETWORK_TIMEOUT_MS, runGit, type GitRunOutcome } from './runGit'

/**
 * Push / Pull / Commit & Push（Session 3-8-5）。
 *
 * DESIGN.md §3 の「①変更確認 → ②コミットメッセージ → ③Commit & Push」の
 * ③の後半にあたる。部品の分担は Stage / Unstage（gitStage.ts）や
 * Commit（gitCommit.ts）とまったく同じで、ここが持つのは噛み合わせだけになる。
 *
 *   順番待ち   … gitQueue.ts（走るのは常に1本）
 *   引数       … gitCommands.ts（組み立てられる場所はそこだけ）
 *   失敗の分類 … gitFailure.ts（純粋・テスト対象）
 *   状態の読み … gitRepository.ts（操作の前後で同じ関数を使う）
 *   応答の形   … gitOperationResult.ts（Stage / Commit と共有）
 *
 * ## Renderer からは、相手の名前が1文字も来ない
 *
 * `git:push` / `git:pull` の要求は **`void`** にしてある（shared/ipc/contracts/git.ts）。
 * remote 名・ブランチ名・refspec のどれも渡す欄が無く、相手を決めるのは
 * リポジトリの設定になる ── 名前で指せる形にすると、**画面に出ているブランチとは
 * 別のものへ送れる欄**になり、押した人から見て何が起きたのか分からなくなる。
 *
 * Main の側でも名前を組み立てていない。`@{upstream}` / `push.default` という
 * **git 自身に解かせる記法**だけを使うため、ブランチ名が引数として解釈される
 * 経路そのものが無い（gitCommands.ts）。
 *
 * ## `git pull` は使わない
 *
 * Pull は `fetch` → `merge --ff-only` の2つに分けてある。理由は2つ。
 *
 *   - `pull` は `pull.rebase` の設定で merge にも rebase にもなる。
 *     **同じボタンが PC ごとに違う履歴を作る**のは、いちばん説明しにくい振る舞い
 *   - 分けておけば、**どちらで失敗したか**が分かる。届かなかったのか、
 *     届いたが取り込めなかったのかで、次の一手はまったく違う
 *
 * 早送りできないときは取り込まずに `diverged` として返る。merge と rebase の
 * どちらを選ぶかはリポジトリの流儀で決まることで、アプリが黙って選ぶと
 * 利用者が意図していない形の履歴が残る。
 *
 * ## 押す前に分かることは、ネットワークへ出る前に分けておく
 *
 * ブランチの上に居ない・remote が1つも無い・送るものが無い ── どれも
 * 手元だけで分かる。分かるものを相手に聞きにいかないのは、Commit で
 * 名乗りを先に確かめている（gitCommit.ts）のと同じ形にあたる。
 * 待たされた末に「失敗しました」だけが返るのを避ける、という意味では
 * こちらの方が効く（相手のサーバー次第で数十秒かかる）。
 */

const log = createLogger('git')

/** Git 操作を始められる状態（この層が扱うのはこれだけ）。 */
type ReadyRepository = Extract<GitRepositoryState, { status: 'ready' }>

/* -------------------------------------------------------------------------------- Push */

/**
 * 今のブランチを追跡先へ送る。
 *
 * 追跡先がまだ無ければ、この1回の中で `--set-upstream` まで行う ──
 * 「初回だけ別のボタン」にすると、利用者はどちらを押すかを**先に判断する**ことになる。
 */
export async function applyGitPush(): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    const blocked =
      (await findPushDestinationProblem(before.repository)) ??
      (await findPushSubjectProblem(before.repository))

    if (blocked !== null) {
      return await finishGitOperation(before.workspaceId, { status: 'failed', reason: blocked })
    }

    return await finishGitOperation(before.workspaceId, await runPush(before.repository))
  })
}

/**
 * 「どこへ送るか」が成り立たない理由。無ければ null。
 *
 * **Commit しても変わらないもの**だけをここに入れてある ── Commit & Push は
 * この関数だけを Commit の前に通す（送るものの有無は、Commit すれば変わる）。
 */
async function findPushDestinationProblem(
  repository: ReadyRepository
): Promise<GitOperationFailureReason | null> {
  /*
    detached HEAD では「今のブランチ」が無く、送り先を決める土台が無い。
    アプリが代わりにブランチを作ることはしない（shared/git/operation.ts）。
  */
  if (repository.head.kind !== 'branch') {
    return 'not-on-branch'
  }

  const remotes = await hasAnyRemote()

  if (remotes === null) {
    return 'unknown'
  }

  return remotes ? null : 'no-remote'
}

/**
 * 「送るものがある」が成り立たない理由。無ければ null。
 *
 * ここで断るのは **`git push` の「Everything up-to-date」を失敗として出す**ため。
 * 黙って成功にすると、押しても何も起きないのに成功と出ることになり、
 * 「送れたのか、送るものが無かったのか」が利用者から見て区別できない
 * （グループの「すべて Stage」が空のときに `nothing-to-do` を返すのと同じ判断）。
 */
async function findPushSubjectProblem(
  repository: ReadyRepository
): Promise<GitOperationFailureReason | null> {
  /*
    追跡先があって差が 0。**`ahead === null`（差が分からない）では止めない** ──
    分からないのは追跡先の ref が手元に無いときで、それは「送るものが無い」とは
    別のことにあたる（shared/git/status.ts）。
  */
  if (repository.upstream !== null && repository.upstream.ahead === 0) {
    return 'nothing-to-do'
  }

  /*
    まだ1つも commit が無い（`git init` の直後）。ブランチ名は答えられても
    送る中身が無く、git は `src refspec ... does not match any` という
    分類しにくい形で断る ── 動かす前に分けておく。
  */
  const head = await hasGitHeadCommit()

  if (head === null) {
    return 'unknown'
  }

  return head ? null : 'nothing-to-do'
}

/** remote が1つでも設定されているか。分からなければ null。 */
async function hasAnyRemote(): Promise<boolean | null> {
  const outcome = await runGit(listRemotes())

  if (outcome.status !== 'completed' || outcome.exitCode !== 0) {
    return null
  }

  return outcome.stdout.trim().length > 0
}

/**
 * `git push` を1回動かす。
 *
 * 追跡先の有無で引数が変わる（gitCommands.ts）── どちらを使うかを決めるのは
 * **操作の前に読んだ状態**で、Renderer から届いた値ではない。
 */
async function runPush(repository: ReadyRepository): Promise<GitOperationOutcome> {
  const command = repository.upstream === null ? pushSettingUpstream() : pushToUpstream()
  const outcome = await runGit(command, { timeoutMs: GIT_NETWORK_TIMEOUT_MS })

  return toOutcome(outcome, classifyGitPushFailure)
}

/* -------------------------------------------------------------------------------- Pull */

/**
 * 追跡先の変更を取り込む（`fetch` → `merge --ff-only`）。
 */
export async function applyGitPull(): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    const blocked = findPullBlockingState(before.repository)

    if (blocked !== null) {
      return await finishGitOperation(before.workspaceId, { status: 'failed', reason: blocked })
    }

    return await finishGitOperation(before.workspaceId, await runPull())
  })
}

/**
 * 読んだ状態だけで分かる「Pull できない理由」。無ければ null。
 *
 * **どれも git を1回も動かさずに分かる。** 相手のサーバーを待たせてから
 * 手元の理由で断るのは、いちばん時間の無駄になる。
 */
function findPullBlockingState(repository: ReadyRepository): GitOperationFailureReason | null {
  if (repository.head.kind !== 'branch') {
    return 'not-on-branch'
  }

  /*
    どこから受け取るかが無い。**アプリが remote を推測して選ばない** ──
    選べば、意図しない相手から取り込むことになる（shared/git/operation.ts）。
  */
  if (repository.upstream === null) {
    return 'no-upstream'
  }

  /*
    競合が残っている間、git は merge を始めない。取ってくること自体は
    できるが、その後で必ず断られる ── 先に分けておけば、
    「取ってきたのに何も変わらない」を作らずに理由だけを出せる。
  */
  if (repository.changes.conflicted.length > 0) {
    return 'unresolved-conflicts'
  }

  return null
}

/**
 * `fetch` してから `merge --ff-only` する。
 *
 * **2回とも上限が違う。** fetch は相手のサーバー次第で待たされ（2分）、
 * merge は手元で終わるが `post-merge` hook が走りうる（Commit と同じ2分）──
 * 同じ数字でも理由が違うため、別の定数から取っている（runGit.ts）。
 */
async function runPull(): Promise<GitOperationOutcome> {
  const fetched = await runGit(fetchFromRemote(), { timeoutMs: GIT_NETWORK_TIMEOUT_MS })
  const fetchOutcome = toOutcome(fetched, classifyGitFetchFailure)

  if (fetchOutcome.status !== 'applied') {
    return fetchOutcome
  }

  const merged = await runGit(mergeUpstreamFastForwardOnly(), { timeoutMs: GIT_COMMIT_TIMEOUT_MS })

  /*
    取り込むものが無かった場合、git は「Already up to date.」と言って 0 で終わる。
    それを `nothing-to-do` にしないのは、Pull の目的が**取ってくること**にあり、
    それは通っているため ── 押した意味はあった、という結末にあたる。
  */
  return toOutcome(merged, classifyGitMergeFailure)
}

/* --------------------------------------------------------------------- Commit & Push */

/**
 * Commit してから Push する。
 *
 * ## 1つの枠の中で続けて動かす
 *
 * Renderer から `git:commit` → `git:push` と続けて呼ぶ形にはしていない
 * （shared/ipc/contracts/git.ts）── 順番待ちは1回の要求ごとに枠を取るため、
 * **その2回の間に別の操作が挟まりうる。** 挟まると「Commit したものを送った」と
 * 言えなくなる。
 *
 * ## Push できない土台は、Commit の前に見る
 *
 * ブランチの上に居ない・remote が1つも無い、はどちらも Commit しても変わらない。
 * 先に見ておけば、**通らないと分かっている Push のために commit を積まずに済む。**
 * 逆に「送るものがあるか」は見ない ── Commit すれば必ず1つ増える。
 *
 * ## 途中で止まったら `partly-applied`
 *
 * Commit は通ったのに Push が通らなかった、は普通に起こる（認証・ネットワーク・
 * remote 側の拒否）。これを失敗に丸めると、利用者は同じ内容をもう一度 Commit する
 * ── 履歴に同じ commit が2つ積まれる（shared/git/operation.ts）。
 *
 * **Commit を取り消して失敗に揃えることもしない。** 頼まれていない取り消しであり、
 * しかも戻す操作そのものが失敗しうる。Commit はそのまま残し、Push だけを押し直せばよい。
 */
export async function applyGitCommitAndPush(message: string): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    const blocked = await findPushDestinationProblem(before.repository)

    if (blocked !== null) {
      return await finishGitOperation(before.workspaceId, { status: 'failed', reason: blocked })
    }

    const committed = await runGitCommitStep(before.repository, message)

    if (committed.status !== 'applied') {
      // Commit が通らなければ Push もしない（送るものが増えていない）。
      return await finishGitOperation(before.workspaceId, committed)
    }

    const pushed = await runPush(before.repository)

    if (pushed.status === 'applied') {
      return await finishGitOperation(before.workspaceId, pushed)
    }

    log.info(`git commit succeeded but push did not: ${pushed.reason}`)

    return await finishGitOperation(before.workspaceId, {
      status: 'partly-applied',
      reason: pushed.reason
    })
  })
}

/* ------------------------------------------------------------------------------ 共通 */

/**
 * 1回の実行の結末を、操作の結末へ翻訳する。
 *
 * 分類の表だけを差し替えられるようにしてあるのは、**同じ終わり方でも
 * 読み方が違う**ため（gitFailure.ts）── fetch に「断られた」は無く、
 * merge にネットワークの失敗は無い。
 *
 * `git-unavailable` / `no-workspace` を `not-ready` に寄せているのは
 * Stage / Commit と同じで、どちらも「もう操作できる状態ではない」にあたる。
 * 一緒に返る `repository` が新しい状態を持っているので、画面はそちらへ切り替わる。
 */
function toOutcome(
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
