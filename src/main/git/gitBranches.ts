import type {
  GitBranchListing,
  GitOperationFailureReason,
  GitOperationOutcome,
  GitRepositoryState
} from '@shared/git'
import { GIT_LOCAL_BRANCH_LIMIT } from '@shared/git'
import { createLogger } from '../logger'
import { createBranch, listLocalBranches, switchBranch, type GitCommand } from './gitCommands'
import { classifyGitBranchFailure, summarizeGitStderr } from './gitFailure'
import {
  finishGitOperation,
  notReadyGitOperation,
  type GitOperationResult
} from './gitOperationResult'
import { readLocalBranches } from './gitOutput'
import { runGitExclusively } from './gitQueue'
import { readGitRepositoryOutcome } from './gitRepository'
import { GIT_CHECKOUT_TIMEOUT_MS, runGit } from './runGit'

/**
 * ブランチの一覧 / 切り替え / 作成（Session 3-8-6）。
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
export async function applyGitCreateBranch(name: string): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    return await finishGitOperation(before.workspaceId, await runBranchCommand(createBranch(name)))
  })
}

/* ------------------------------------------------------------------------ 共通 */

/**
 * `git switch` を1回動かして、結末に翻訳する。
 *
 * 切り替えと作成で同じ関数を通すのは、**動かしているコマンドが同じ**
 * （`switch`）で、終わり方の読み方も同じ表から出るため（gitFailure.ts）。
 *
 * 待ち時間の上限が長いのは、ここで作業ツリーが実際に書き換わり、
 * `post-checkout` hook まで走りうるため（runGit.ts の `GIT_CHECKOUT_TIMEOUT_MS`）。
 */
async function runBranchCommand(command: GitCommand): Promise<GitOperationOutcome> {
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

  return { status: 'failed', reason: classifyGitBranchFailure(outcome.stderr) }
}
