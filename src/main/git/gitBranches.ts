import type {
  GitBranchListing,
  GitOperationFailureReason,
  GitOperationOutcome,
  GitRepositoryState
} from '@shared/git'
import { GIT_LOCAL_BRANCH_LIMIT } from '@shared/git'
import { createLogger } from '../logger'
import {
  createBranch,
  deleteBranch,
  listExactBranch,
  listLocalBranches,
  renameBranch,
  switchBranch,
  type GitCommand
} from './gitCommands'
import {
  classifyGitBranchFailure,
  classifyGitCreateBranchFailure,
  classifyGitDeleteBranchFailure,
  classifyGitRenameBranchFailure,
  summarizeGitStderr
} from './gitFailure'
import {
  finishGitOperation,
  guardGitInProgress,
  notReadyGitOperation,
  type GitOperationResult
} from './gitOperationResult'
import { readLocalBranches } from './gitOutput'
import { runGitExclusively } from './gitQueue'
import { readGitRepositoryOutcome } from './gitRepository'
import { GIT_CHECKOUT_TIMEOUT_MS, runGit } from './runGit'

/**
 * ブランチの一覧 / 切り替え / 作成（Session 3-8-6）と、削除 / rename（Session 3-8-14）。
 *
 * ## 3-8-14 で、動かす git が2種類になった
 *
 * 3-8-13 までここが動かしていたのは `git switch` だけで、どれも
 * **作業ツリーを書き換える**操作だった。削除と rename が動かすのは
 * `git branch` で、書き換えるのは ref 1つになる ── 待ち時間の上限も、
 * 失敗の分類の表も、そこで分かれる（`runBranchCommand` / `runBranchRefCommand`）。
 *
 * 部品の分担は Stage / Unstage（gitStage.ts）・Commit（gitCommit.ts）・
 * Push / Pull（gitSync.ts）とまったく同じで、ここが持つのは噛み合わせだけになる。
 *
 *   順番待ち   … gitQueue.ts（走るのは常に1本）
 *   引数       … gitCommands.ts（組み立てられる場所はそこだけ）
 *   値の検証   … shared/git/branchName.ts（純粋・Renderer と共有）
 *   出力の読み … gitOutput.ts（純粋・テスト対象）
 *   失敗の分類 … gitFailure.ts（純粋・テスト対象）
 *   状態の読み … gitRepository.ts（操作の前後で同じ関数を使う）
 *   応答の形   … gitOperationResult.ts（Stage / Commit / Push と共有）
 *
 * ## 切り替えは「読む → 確かめる → 動かす → 読み直す」のまま
 *
 * 新しい形は1つも要らなかった。作業ツリーがまるごと入れ替わる操作でも、
 * **応答に載るのは操作後の状態**（ブランチ名・変更ファイルの一覧・追跡先）で、
 * それは他の操作とまったく同じ1つの読み直しから出てくる。
 *
 * Files / Editor が追いつく経路も新しく作っていない ── 切り替えで実際に
 * 書き換わるのは**ファイル**なので、監視（§12.1）が `files:changed` を出し、
 * ツリーも開いているタブもそれぞれの既存の仕組みで追従する。
 * Git パネルからファイルの変化を配る、という逆向きの経路は作らない。
 *
 * ## アプリの側から確認を挟まない（設計判断）
 *
 * 「未保存の変更があります。切り替えますか？」は**出さない。** 出す形にすると、
 * アプリが「切り替えると失われる」と判断したことになるが、その判断は
 * git 自身が持っている ── `--force` も `--merge` も渡していないので、
 * 失われるものがあるときは git が断る（`local-changes-blocked`）。
 *
 * アプリが重ねて尋ねると、次の2つが起こる。
 *
 *   - **通るはずの切り替えを止める。** 書きかけがあっても、切り替え先が
 *     そのファイルに触らなければ git は通す（それが普通の使い方にあたる）
 *   - **尋ねた後で git に断られる。** 確認を押した利用者から見ると、
 *     アプリが二度手間を作っただけになる
 *
 * 未保存の Editor の中身（まだファイルになっていないもの）は、そもそも
 * git から見えない ── 切り替えても消えず、タブに残ったままになる。
 * 失われるものがある操作に確認を挟む（§12.6）のは**こちらが消す側に回るとき**で、
 * ここはそうではない。
 */

const log = createLogger('git')

/** Git 操作を始められる状態（この層が扱うのはこれだけ）。 */
type ReadyRepository = Extract<GitRepositoryState, { status: 'ready' }>

/* ------------------------------------------------------------------------ 一覧 */

/** 一覧の問い合わせの答え（IPC の応答がそのまま持つ形）。 */
export interface GitBranchListingOutcome {
  readonly workspaceId: string | null
  readonly listing: GitBranchListing
}

/**
 * ローカルブランチを一覧する。
 *
 * ## 順番待ちを通す
 *
 * 読み取りだけだが、枠を取る（`describeGitRepository` と同じ理由）── 切り替えの
 * 最中に読むと、**どちらでもない一瞬**の写しが返りうる。利用者はそれを
 * 「今どこに居るか」として読むことになる。
 *
 * ## 先に「操作してよい状態か」を確かめる
 *
 * `for-each-ref` は Workspace root がリポジトリ root でなくても答えるが、
 * ここではその手前で止める ── 一覧を出すということは**切り替え先を選ばせる**
 * ことで、Git 操作を行わないと決めた状態（`nested` など。設計判断 10）で
 * 選ばせる形にはできない。
 *
 * 確かめ方は他の操作と同じ `readGitRepositoryOutcome` にしてある。専用の
 * 軽い判定を別に置くと、「Git 操作を始められる」の意味が2箇所に生まれる。
 */
export async function listGitBranches(): Promise<GitBranchListingOutcome> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return { workspaceId: before.workspaceId, listing: { status: 'not-ready' } as const }
    }

    return { workspaceId: before.workspaceId, listing: await readBranchListing() }
  })
}

/**
 * `for-each-ref` を1回動かして、一覧として読む。
 *
 * **読めなかったことを失敗の分類に落とさない**（`failed` の1種類だけ）──
 * 一覧が出せないときに利用者が取れる手は「開き直す」しか無く、
 * 理由で次の一手が変わらないため（分類の粒度の基準は gitFailure.ts）。
 */
async function readBranchListing(): Promise<GitBranchListing> {
  const outcome = await runGit(listLocalBranches(GIT_LOCAL_BRANCH_LIMIT))

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
    log.info(`git for-each-ref exited ${outcome.exitCode}: ${summarizeGitStderr(outcome.stderr)}`)
    return { status: 'failed' }
  }

  const reading = readLocalBranches(outcome.stdout, GIT_LOCAL_BRANCH_LIMIT)

  /*
    ブランチが0件になるのは「まだ1つも commit が無い」リポジトリだけ
    （`git init` の直後は HEAD が指す先がまだ無く、ref も無い）。
    失敗にしない ── 一覧が空であることは、それ自体が正しい答えにあたる。
  */
  return { status: 'ready', branches: reading.branches, truncated: reading.truncated }
}

/* -------------------------------------------------------------------- 切り替え */

/**
 * 別のローカルブランチへ切り替える。
 *
 * `name` は検証済み（ハンドラが `normalizeGitBranchName` を通している）。
 * ここへ来るのは**そのまま引数として渡せる形**の文字列だけになる。
 */
export async function applyGitSwitchBranch(name: string): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    /*
      途中の操作があるあいだは切り替えない（Session 3-8-22A）。

      切り替えについては **git も断る**（`cannot switch branch while merging`。
      実物で確かめてある）── それでも手前で断つのは、断り方を1つに揃えるため
      と、どちらを通すかを決めているのが git だからになる
      （退避は同じ状態で通ってしまう。shared/git/inProgress.ts）。
    */
    const guarded = guardGitInProgress(before, 'switch-branch')

    if (guarded !== null) {
      return guarded
    }

    const blocked = findSwitchBlockingState(before.repository, name)

    if (blocked !== null) {
      return await finishGitOperation(before.workspaceId, { status: 'failed', reason: blocked })
    }

    return await finishGitOperation(before.workspaceId, await runBranchCommand(switchBranch(name)))
  })
}

/**
 * 読んだ状態だけで分かる「切り替えられない理由」。無ければ null。
 *
 * **どちらも git を動かす前に分かる。** 作業ツリーをまるごと入れ替えうる操作を
 * 走らせてから断られるより、走らせずに理由を出す方がよい（Commit で名乗りを
 * 先に確かめているのと同じ形）。
 */
function findSwitchBlockingState(
  repository: ReadyRepository,
  name: string
): GitOperationFailureReason | null {
  /*
    今そこに居るブランチを選んだ。git を動かすと成功として終わるが、
    **何も起きていない**のに「切り替えました」と出ることになる ──
    押した意味が無かったことは、そう伝える（shared/git/operation.ts）。

    一覧では今のブランチも選べるようにしてある（印は付く）。選べなくすると、
    「今どこに居るか」を確かめるために開いた面で、いちばん見たい行だけが
    押せない形になる。
  */
  if (repository.head.kind === 'branch' && repository.head.name === name) {
    return 'nothing-to-do'
  }

  /*
    競合が残っている間、git は切り替えを始めない（index を先に片付けろと言う）。
    先に分けておけば、「押したのに何も変わらない」を作らずに理由だけを出せる
    （Pull で同じ判断をしている。main/git/gitSync.ts）。
  */
  if (repository.changes.conflicted.length > 0) {
    return 'unresolved-conflicts'
  }

  return null
}

/* ------------------------------------------------------------------------ 作成 */

/**
 * 今の場所から新しいブランチを作って、そこへ切り替える。
 *
 * ## 事前に確かめることが1つも無い
 *
 * 切り替えと違い、**手元の状態から分かる「作れない理由」が無い。**
 *
 *   同じ名前がある     … 手元のリポジトリを見ないと分からない（git が答える）
 *   detached HEAD      … 作れる。むしろ、そこから抜け出す手立てになる
 *   書きかけがある     … 作業ツリーはそのまま新しいブランチへ付いてくる
 *   競合が残っている   … 切り替え先が同じ commit なので、git の判断に委ねる
 *
 * 名前の形だけは手前（IPC ハンドラ）で確かめてある ── そこは
 * 「利用者が打った文字列」であって、リポジトリの状態ではない。
 */
export async function applyGitCreateBranch(
  name: string,
  startPoint: string | null
): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    /*
      作成は `switch --create` の1回で作って切り替えるため、切り替えと
      まったく同じ危うさを持つ（Session 3-8-22A）。
    */
    const guarded = guardGitInProgress(before, 'create-branch')

    if (guarded !== null) {
      return guarded
    }

    /*
      始点が解けるかどうかを、ここで先に確かめない（Session 3-8-13）。

      3-8-12 の詳細では `show --no-patch` で先に解いているが、あちらは
      **親の数を知る必要がある**ためで、解くこと自体が目的ではなかった。
      こちらで欲しいのは「作れたか」だけなので、`switch --create` の結末が
      そのまま答えになる ── 先に確かめる形にすると git を2回動かしたうえ、
      確かめてから作るまでの間に消える余地（その1回ぶんの隙間）を
      自分で作ることになる。

      始点の有無で分類の読み方だけが変わる（gitFailure.ts）。
    */
    const outcome = await runBranchCommand(
      createBranch(name, startPoint),
      startPoint === null ? classifyGitBranchFailure : classifyGitCreateBranchFailure
    )

    return await finishGitOperation(before.workspaceId, outcome)
  })
}

/* ------------------------------------------------------------------ 削除（3-8-14） */

/**
 * ローカルブランチを1つ削除する（Session 3-8-14）。
 *
 * ## 作業ツリーに触らない、最初のブランチ操作
 *
 * 切り替えも作成も `git switch` で作業ツリーを書き換えたが、これは
 * `refs/heads/<name>` という ref を1つ消すだけになる ── 押した人の書きかけにも
 * index にも何も起こらない。したがって待ち時間の上限は既定のまま
 * （`GIT_CHECKOUT_TIMEOUT_MS` を使わない。gitCommands.ts）。
 *
 * ## 事前に分かるのは1つだけ
 *
 *   今そこに居るブランチ … 分かる（`head`）。git を動かさずに返す
 *   マージ済みか         … **分からない。** 基準（HEAD か追跡先）を持つのは git で、
 *                          一覧にも載せていない（shared/git/branch.ts）
 *   そのブランチがあるか … 分からない。押すまでの間に消えていることがある
 *
 * 切り替えで `nothing-to-do` と `unresolved-conflicts` を先に分けたのと同じ形で、
 * **押す前に分かることは git を動かす前に分ける**（§14.14）。競合が残っていても
 * ブランチは消せるので、そちらは見ない ── 切り替えと同じ表を当てない理由になる。
 */
export async function applyGitDeleteBranch(name: string): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    /*
      マージの途中では止めない（ref を1つ動かすだけで MERGE_HEAD に触らない）。
      rebase / cherry-pick / revert の途中では止める ── あちらは
      途中の状態がブランチの ref を指しているため（shared/git/inProgress.ts）。
    */
    const guarded = guardGitInProgress(before, 'delete-branch')

    if (guarded !== null) {
      return guarded
    }

    /*
      今そこに居るブランチは消せない。git も同じことを言うが（`used by
      worktree at ...`）、**押す前に分かることを git に聞かない** ── 画面の側でも
      その行の ✕ は押せないようにしてあり、ここはその二重の備えにあたる
      （pathspec とブランチ名を「形」と「置き方」の両方で守っているのと同じ構え）。

      detached HEAD のときは head.kind が 'branch' ではないので、ここは通らない ──
      どのブランチもチェックアウトされていないため、実際どれでも消せる。
    */
    if (before.repository.head.kind === 'branch' && before.repository.head.name === name) {
      return await finishGitOperation(before.workspaceId, {
        status: 'failed',
        reason: 'branch-checked-out'
      })
    }

    const outcome = await runBranchRefCommand(deleteBranch(name), classifyGitDeleteBranchFailure)

    return await finishGitOperation(before.workspaceId, outcome)
  })
}

/* ----------------------------------------------------------------- rename（3-8-14） */

/**
 * ローカルブランチの名前を変える（Session 3-8-14）。
 *
 * ## 失われるものが1つも無い操作
 *
 * 変わるのは ref の名前だけで、commit も作業ツリーも index も動かない ──
 * **今そこに居るブランチでも改名でき**、その場合は git が HEAD を追随させる
 * （未コミットの変更もそのまま残る。実物で確かめてある）。したがって確認は
 * 挟まず、削除と違って「戻せない」側の操作でもない。
 *
 * ## 大文字小文字だけを変える改名を通すための1回
 *
 * Windows（と既定の macOS）では `refs/heads/feature` と `refs/heads/Feature` が
 * 同じファイルになるため、素の `--move` は
 * `a branch named 'Feature' already exists` で断る。だがそのとき「既にある」と
 * 指されているのは**改名しようとしているブランチ自身**で、別のブランチではない。
 *
 * そこだけは `--force` を立てて通す。ただし `--force` は本来
 * 「相手を消して名前を奪う」ものなので、**立てる前に相手が自分自身であることを
 * 確かめる** ── 綴りが大文字小文字だけ違い、かつ**完全に同じ綴りの
 * ブランチが実在しない**、の2つが揃ったときだけになる。
 *
 * 2つめを確かめるのに `show-ref --verify` は使えない（ファイルシステム越しの
 * 参照なので大文字小文字を区別しない。gitCommands.ts）── 保管されている名前を
 * 突き合わせる `branch --list` を1回だけ動かす。
 *
 * 大文字小文字を区別するファイルシステムでは `feature` と `Feature` が
 * 同時に在りうるが、そのときこの確認が当たって `--force` は立たない ──
 * git が `branch-exists` として断り、相手のブランチは消えない。
 */
export async function applyGitRenameBranch(
  name: string,
  newName: string
): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    // 削除と同じ線（Session 3-8-22A）。
    const guarded = guardGitInProgress(before, 'rename-branch')

    if (guarded !== null) {
      return guarded
    }

    /*
      同じ名前を打った。git は成功として終わるが、何も起きていないのに
      「変更しました」と出ることになる ── 切り替えで今のブランチを選んだときと
      同じ判断で、押した意味が無かったことはそう伝える。

      画面の側でも押せないようにしてあるが、ここでも見る（二重の備え）。
    */
    if (name === newName) {
      return await finishGitOperation(before.workspaceId, {
        status: 'failed',
        reason: 'nothing-to-do'
      })
    }

    const force = await needsForceForCaseOnlyRename(name, newName)

    const outcome = await runBranchRefCommand(
      renameBranch(name, newName, force),
      classifyGitRenameBranchFailure
    )

    return await finishGitOperation(before.workspaceId, outcome)
  })
}

/**
 * 「相手は自分自身」と言い切れるときだけ true（Session 3-8-14）。
 *
 * 条件は2つで、**どちらも満たさなければ `--force` は立たない。**
 *
 *   1. 綴りが大文字小文字だけ違う（`feature` → `Feature`）
 *   2. 行き先の綴りちょうどのブランチが**実在しない**
 *
 * 1つめが外れていれば、行き先は明らかに別の名前になる ── そこに何かが
 * 在れば本物の衝突で、git に断ってもらう。
 *
 * 2つめを確かめられなかったとき（git が動かなかった・非0で終わった）は
 * **false に倒す。** 分からないまま `--force` を立てると、確かめられなかった
 * 一回だけ他人のブランチを消しうる ── 倒しておけば、最悪でも
 * 「大文字小文字だけの改名が断られる」で済む。
 */
async function needsForceForCaseOnlyRename(name: string, newName: string): Promise<boolean> {
  if (name.toLowerCase() !== newName.toLowerCase()) {
    return false
  }

  const outcome = await runGit(listExactBranch(newName))

  if (outcome.status !== 'completed' || outcome.exitCode !== 0) {
    return false
  }

  // 空 ＝ その綴りちょうどのブランチは無い ＝ git が指しているのは改名元自身。
  return outcome.stdout.trim().length === 0
}

/* ------------------------------------------------------------------------ 共通 */

/**
 * `git branch` を1回動かして、結末に翻訳する（Session 3-8-14）。
 *
 * ## `runBranchCommand` と分けてある
 *
 * 待ち時間の上限が違うため。あちら（`switch`）は**作業ツリーを実際に
 * 書き換える**ので2分を掛けているが、こちらが書き換えるのは ref 1つで、
 * ファイル数もウイルス対策ソフトもネットワークドライブも効かない
 * （`post-checkout` hook も走らない）── 即答するはずの操作に2分を掛けると、
 * 本当に返ってこなくなった場合の逃げ道がその分だけ遠くなる。
 *
 * 分類の関数は必ず呼ぶ側が渡す。削除と rename では起こりうることが
 * 重ならず、既定を1つ決めると「渡し忘れた側が、起こりえない分類を返す」形が
 * 残るためになる（`runBranchCommand` の既定を 3-8-13 で残したのとは逆の判断で、
 * あちらは3つの入口のうち2つが同じ表を使っていた）。
 */
async function runBranchRefCommand(
  command: GitCommand,
  classify: (stderr: string) => GitOperationFailureReason
): Promise<GitOperationOutcome> {
  const outcome = await runGit(command)

  switch (outcome.status) {
    case 'no-workspace':
    case 'git-unavailable':
      return { status: 'failed', reason: 'not-ready' }

    case 'failed':
      return { status: 'failed', reason: outcome.reason === 'timeout' ? 'timeout' : 'unknown' }

    case 'completed':
      break
  }

  if (outcome.exitCode !== 0) {
    return { status: 'failed', reason: classify(outcome.stderr) }
  }

  /*
    削除が通ったときの `Deleted branch x (was <hash>)` は stdout に出る。
    **消した ref がどの commit を指していたか**は、後から reflog を見に行く前の
    唯一の手掛かりになる ── Renderer へは渡さない（分類だけが境界を越える）が、
    ログには残す。
  */
  const trailing = outcome.stdout.trim()

  if (trailing.length > 0) {
    log.info(`git ${command.label}: ${summarizeGitStderr(trailing)}`)
  }

  return { status: 'applied' }
}

/**
 * `git switch` を1回動かして、結末に翻訳する。
 *
 * 切り替えと作成で同じ関数を通すのは、**動かしているコマンドが同じ**
 * （`switch`）で、終わり方の読み方も同じ表から出るため（gitFailure.ts）。
 *
 * 待ち時間の上限が長いのは、ここで作業ツリーが実際に書き換わり、
 * `post-checkout` hook まで走りうるため（runGit.ts の `GIT_CHECKOUT_TIMEOUT_MS`）。
 */
async function runBranchCommand(
  command: GitCommand,
  /**
   * 終了コードが非0だったときに stderr を読む関数（Session 3-8-13）。
   *
   * 切り替えと、始点を渡さない作成は `classifyGitBranchFailure`。始点を
   * 渡した作成だけが `classifyGitCreateBranchFailure` になる ── **同じ文言が
   * 別のものを指す**ため（gitFailure.ts）。分類そのものをこの関数の中に
   * 書き分けないのは、どのコマンドを組み立てたかを知っているのが
   * 呼ぶ側だからになる。
   */
  classify: (stderr: string) => GitOperationFailureReason = classifyGitBranchFailure
): Promise<GitOperationOutcome> {
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

  /*
    `post-checkout` hook の出力は stdout 側に出ることが多い。分類には使わないが、
    原因を追えるようにログには残す ── Renderer へは分類だけが渡る方針は
    3-8-1 のまま（shared/git/operation.ts）。
  */
  const trailing = outcome.stdout.trim()

  if (trailing.length > 0) {
    log.info(
      `git ${command.label} exited ${outcome.exitCode} with stdout: ${summarizeGitStderr(trailing)}`
    )
  }

  return { status: 'failed', reason: classify(outcome.stderr) }
}
