import type {
  GitOperationFailureReason,
  GitOperationOutcome,
  GitRepositoryState
} from '@shared/git'
import { createLogger } from '../logger'
import { abortMerge, listExactBranch, mergeBranch } from './gitCommands'
import {
  classifyGitAbortMergeFailure,
  classifyGitMergeBranchFailure,
  summarizeGitStderr
} from './gitFailure'
import {
  finishGitOperation,
  notReadyGitOperation,
  type GitOperationResult
} from './gitOperationResult'
import { runGitExclusively } from './gitQueue'
import { readGitRepositoryOutcome } from './gitRepository'
import { GIT_CHECKOUT_TIMEOUT_MS, runGit } from './runGit'

/**
 * ブランチのマージの開始 / 中止（Session 3-8-20）。
 *
 * ## gitBranches.ts / gitSync.ts と別のファイルにしてある
 *
 * 一覧の行から押す操作なので `gitBranches.ts` に見えるが、**そこが持つ
 * 4つ（切り替え・作成・削除・rename）とは、動くものも起こることも違う。**
 *
 *   切り替え / 作成 … `git switch`。作業ツリーを**入れ替える**
 *   削除 / rename   … `git branch`。ref を1つ書き換える
 *   マージ          … `git merge`。**2つの履歴を1つにし、競合しうる**
 *
 * `gitSync.ts` の Pull も `git merge` を動かすが、あちらは
 * `--ff-only @{upstream}` で「取り込めるか断られるか」の2つにしか
 * ならなかった ── 競合という3つめの結末が要るのはここだけになる。
 *
 * 部品の分担は 3-8-6 / 3-8-14 / 3-8-19 とまったく同じで、
 * ここが持つのは噛み合わせだけになる。
 *
 *   順番待ち   … gitQueue.ts（走るのは常に1本）
 *   引数       … gitCommands.ts（組み立てられる場所はそこだけ）
 *   値の検証   … shared/git/branchName.ts（純粋・Renderer と共有）
 *   失敗の分類 … gitFailure.ts（純粋・テスト対象）
 *   状態の読み … gitRepository.ts（操作の前後で同じ関数を使う）
 *   応答の形   … gitOperationResult.ts（Stage / Commit / Push と共有）
 *
 * ## 「押す前に分かること」を、git を動かす前に全部見る
 *
 * §14.14 からの構えをいちばん厚く効かせている場所になる。マージは
 * **作業ツリーと index を同時に書き換える**操作で、走り出してから断られると
 * 半端な状態が残りうる ── 先に見れば、そこへ入らずに理由だけを出せる。
 *
 *   ブランチの上に居ない … `not-on-branch`（detached では取り込み先が無い）
 *   既にマージ中         … `unresolved-conflicts`（MERGE_HEAD が在る）
 *   競合が残っている     … `unresolved-conflicts`（`stash pop` の競合も含む）
 *   相手が今のブランチ   … `nothing-to-do`（画面でも押せない）
 *   相手が実在しない     … `branch-not-found`（tag / hash / remote ref を含む）
 *
 * 最後の1つが 3-8-20 でいちばん効く確かめにあたる（下記）。
 *
 * ## 3-8-18 の続きとして噛み合う
 *
 * 競合した結末は `partly-applied`（`completed: 'merge'`）で返り、
 * 応答の状態は `merging: true` になる ── そこから先に足したものは1つも無い。
 *
 *   競合の行     … 3-8-2 の「競合」グループにそのまま並ぶ
 *   解決済みにする … 3-8-18 の `git:resolve-conflict` がそのまま効く
 *   Commit       … 3-8-4 の引数がそのままマージ commit を作り MERGE_HEAD を消す
 *
 * 3つとも実物で確かめてある（gitMergeRepository.test.ts）── 3-8-18 が
 * 「アプリが競合を生む唯一の経路は `stash pop`」と書いていた穴が、
 * ここで正面から埋まる。
 */

const log = createLogger('git')

/** Git 操作を始められる状態（この層が扱うのはこれだけ）。 */
type ReadyRepository = Extract<GitRepositoryState, { status: 'ready' }>

/* ------------------------------------------------------------------ マージの開始 */

/**
 * ローカルブランチを今のブランチへ取り込む。
 *
 * `name` は検証済み（ハンドラが `normalizeGitBranchName` を通している）。
 * ここへ来るのは**そのまま引数として渡せる形**の文字列だけになる ──
 * ただし「形が正しい」と「そのブランチが在る」は別の話で、後者は下で確かめる。
 */
export async function applyGitMergeBranch(name: string): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    const blocked = await findMergeBlockingState(before.repository, name)

    if (blocked !== null) {
      return await finishGitOperation(before.workspaceId, { status: 'failed', reason: blocked })
    }

    return await finishGitOperation(before.workspaceId, await runMerge(name))
  })
}

/**
 * マージを始められない理由。無ければ null。
 *
 * ## 4つは読んだ状態だけで分かる。5つめだけ git へ1回聞く
 *
 * 聞く1回（`branch --list`）が要るのは、**名前の形からは
 * 「ローカルブランチかどうか」が分からない**ため ── `v1.0` は tag として
 * 通る名前でもあり、`3d0574a` は commit hash として解ける名前でもある。
 * `git merge` はどちらも受け取り、**ブランチではないものをマージする**
 * （実物で確かめてある）。
 *
 * 3-8-19 の `hasExactLocalBranch` と同じ `listExactBranch` を使うが、
 * **読めなかったときに倒す先が逆**になる（下記）。
 */
async function findMergeBlockingState(
  repository: ReadyRepository,
  name: string
): Promise<GitOperationFailureReason | null> {
  /*
    detached HEAD では「今のブランチ」が無く、取り込み先を決める土台が無い。

    git 自身は detached でも merge する（実物で確かめてある）が、そのとき
    できるのは**どのブランチにも属さない merge commit** で、切り替えた瞬間に
    辿れなくなる ── アプリが代わりにブランチを作ることはしない
    （Push で `not-on-branch` を返すのと同じ判断。main/git/gitSync.ts）。
  */
  if (repository.head.kind !== 'branch') {
    return 'not-on-branch'
  }

  /*
    既にマージの途中。git も断るが（`Merging is not possible because you have
    unmerged files`）、**押す前に分かることを git に聞かない。**

    画面の側でも、マージ中は帯が出て「まず中止するか、解決して Commit する」
    ことが見えている（renderer/src/git/GitView.tsx）── ここはその二重の備えになる。
  */
  if (repository.merging) {
    return 'unresolved-conflicts'
  }

  /*
    競合が残っている（マージ中でなくても起こる ── `stash pop` の競合。3-8-15）。
    git は index が片付くまでマージを始めない ── 先に分けておけば、
    「押したのに何も変わらない」を作らずに理由だけを出せる
    （Pull / 切り替えと同じ判断）。
  */
  if (repository.changes.conflicted.length > 0) {
    return 'unresolved-conflicts'
  }

  /*
    今そこに居るブランチを選んだ。git は成功として終わる（`Already up to
    date.`）が、何も起きていないのに「取り込みました」と出ることになる ──
    切り替えで今のブランチを選んだときと同じ判断にあたる。

    画面の側では、今のブランチの行にマージの口を出していない
    （renderer/src/git/gitBranches.ts）── ここはその二重の備えになる。
  */
  if (repository.head.name === name) {
    return 'nothing-to-do'
  }

  /*
    その綴りちょうどのローカルブランチが実在するか。

    ## 読めなかったときは「無い」に倒す（3-8-19 とは逆）

    3-8-19 の始点の確認は true（在る）へ倒していた ── 倒した先で git が
    `invalid reference` として同じ分類を返すので、結末が変わらなかったため。
    こちらは**倒した先で結末が変わる。**

      false へ倒す … 「見つかりません」と言い切る。実際には在るのに
                     マージできない、という間違いが起こりうる。
                     次の一手（一覧を開き直す）を踏めば直る
      true へ倒す  … `git merge <名前>` が走る。名前が tag や hash として
                     解ければ、**ブランチではないものが取り込まれる** ──
                     merge commit が作られてしまえば、戻す口はアプリに無い
                     （3-8-20 の範囲外）

    「確かめられなかった一回だけ、押していないものが履歴に入る」を避ける、
    という判断は 3-8-18 の競合マーカーの確認とまったく同じ形になる。
  */
  if (!(await hasExactLocalBranch(name))) {
    return 'branch-not-found'
  }

  return null
}

/**
 * その綴りちょうどのローカルブランチが実在するか。
 *
 * 使うのは 3-8-14 の `listExactBranch` そのもの ── `refs/heads/` だけを見る
 * ので、tag（`refs/tags/`）も remote-tracking branch（`refs/remotes/`）も
 * commit hash も**空を返す**（実物で確かめてある）。大文字小文字を区別する
 * ことも、`show-ref --verify` が Windows では当てにならないことも、
 * あちらの冒頭に書いてある。
 *
 * 読めなかったときに false（無い）を返すのは、呼ぶ側の判断そのものになる
 * （`findMergeBlockingState`）── ここは「確かめられた在る」だけを true にする。
 */
async function hasExactLocalBranch(name: string): Promise<boolean> {
  const outcome = await runGit(listExactBranch(name))

  if (outcome.status !== 'completed' || outcome.exitCode !== 0) {
    return false
  }

  return outcome.stdout.trim().length > 0
}

/**
 * `git merge` を1回動かして、結末に翻訳する。
 *
 * ## `toGitOperationOutcome` を通さない
 *
 * 他の操作が使う共通の翻訳（gitOperationResult.ts）は **stderr だけ**を
 * 分類へ渡すが、**マージの競合は stdout に出る**（`--quiet` を付けても残る。
 * 実物で確かめてある）── そのまま通すと、いちばん起こる結末が
 * `unknown` に落ちる。
 *
 * もう1つ、共通の翻訳は結末を `applied` か `failed` の2つにしか畳めない ──
 * 競合は**そのどちらでもない**（`partly-applied`）。翻訳の側に3つめを
 * 足すと、競合しない操作にまで「途中まで通った」の枝が生えることになる。
 *
 * ## 待ち時間の上限は切り替えと同じ
 *
 * 作業ツリーが実際に書き換わり、`post-merge` / `pre-merge-commit` hook まで
 * 走りうる（`GIT_CHECKOUT_TIMEOUT_MS`。runGit.ts）── ref を1つ書き換える
 * だけの削除 / rename とは性質が違う。
 */
async function runMerge(name: string): Promise<GitOperationOutcome> {
  const command = mergeBranch(name)
  const outcome = await runGit(command, { timeoutMs: GIT_CHECKOUT_TIMEOUT_MS })

  switch (outcome.status) {
    case 'no-workspace':
    case 'git-unavailable':
      return { status: 'failed', reason: 'not-ready' }

    case 'failed':
      return { status: 'failed', reason: outcome.reason === 'timeout' ? 'timeout' : 'unknown' }

    case 'completed':
      break
  }

  /*
    通った。早送りだったのか merge commit が作られたのかは**区別しない** ──
    どちらも「取り込めた」で、次の一手は無い。`Already up to date.` も
    同じ 0 で終わるが、それだけを分けるために git を1回増やしたり
    結果の型を足したりはしない（3-8-5 の Pull と同じ判断）。
  */
  if (outcome.exitCode === 0) {
    return { status: 'applied' }
  }

  /*
    分類には stdout と stderr の両方を渡す（gitFailure.ts）── どちらに
    何が出るかを呼ぶ側で決めない。ログには要約だけを残し、
    Renderer へ渡るのは分類だけ、という 3-8-1 からの方針は変わらない。
  */
  const reason = classifyGitMergeBranchFailure(`${outcome.stdout}\n${outcome.stderr}`)

  log.info(
    `git ${command.label} exited ${outcome.exitCode} (${reason}): ` +
      summarizeGitStderr(`${outcome.stdout} ${outcome.stderr}`)
  )

  /*
    競合は「失敗」ではなく「途中」にあたる（shared/git/operation.ts）──
    git は自動でマージできた分を作業ツリーと index へ既に書き込んでおり、
    MERGE_HEAD も在る。丸めると利用者はもう一度マージを押し、
    そこから先へ進む手立てが画面のどこにも見えなくなる。
  */
  if (reason === 'merge-conflict') {
    return { status: 'partly-applied', completed: 'merge', reason }
  }

  return { status: 'failed', reason }
}

/* ------------------------------------------------------------------ マージの中止 */

/**
 * 途中のマージをやめて、始める前の状態へ戻す。
 *
 * ## マージ中でなければ、git を1回も動かさない
 *
 * `git merge --abort` は MERGE_HEAD が無ければ
 * `fatal: There is no merge to abort (MERGE_HEAD missing).` で終わる
 * （実物で確かめてある）── それは読んだ状態（`merging`）だけで先に分かる。
 * 押す前に分かることを git に聞かない、という §14.14 からの構えのまま。
 *
 * 画面の側でも、中止の口はマージ中にしか出さない
 * （renderer/src/git/GitView.tsx）── ここはその二重の備えになる。
 *
 * ## 確認はここに無い
 *
 * 消えるものがある操作なので確認を挟むが、それは Renderer の中の話で、
 * **要求に「確認したか」の欄は無い**（3-8-14 以降と同じ判断。
 * shared/ipc/contracts/git.ts）。
 */
export async function applyGitAbortMerge(): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    if (!before.repository.merging) {
      return await finishGitOperation(before.workspaceId, {
        status: 'failed',
        reason: 'nothing-to-do'
      })
    }

    return await finishGitOperation(before.workspaceId, await runAbortMerge())
  })
}

/**
 * `git merge --abort` を1回動かして、結末に翻訳する。
 *
 * ## 待ち時間の上限は切り替えと同じ
 *
 * 作業ツリーを**マージを始める前の姿へ書き戻す**（`reset --merge` 相当）ので、
 * 触るファイル数はマージそのものと変わらない ── ref を1つ書き換えるだけの
 * 削除 / rename と同じ既定にすると、大きなリポジトリで足りなくなる。
 *
 * ## 分類は stderr だけを見る
 *
 * マージ本体（`runMerge`）が stdout も読むのとは違う ── 中止は成功すれば
 * 何も言わず、断るときは必ず `fatal:` として stderr に出る
 * （実物で確かめてある）。
 */
async function runAbortMerge(): Promise<GitOperationOutcome> {
  const command = abortMerge()
  const outcome = await runGit(command, { timeoutMs: GIT_CHECKOUT_TIMEOUT_MS })

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

  const reason = classifyGitAbortMergeFailure(outcome.stderr)

  log.info(
    `git ${command.label} exited ${outcome.exitCode} (${reason}): ` +
      summarizeGitStderr(outcome.stderr)
  )

  return { status: 'failed', reason }
}
