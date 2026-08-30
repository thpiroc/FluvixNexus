import type { GitRemoteBranchListing, GitRepositoryState } from '@shared/git'
import { GIT_REMOTE_BRANCH_LIMIT } from '@shared/git'
import { createLogger } from '../logger'
import {
  createTrackingBranch,
  listExactBranch,
  listExactRemoteBranch,
  listRemoteBranches,
  listRemotes
} from './gitCommands'
import { classifyGitBranchFailure, summarizeGitStderr } from './gitFailure'
import {
  finishGitOperation,
  notReadyGitOperation,
  toGitOperationOutcome,
  type GitOperationResult
} from './gitOperationResult'
import { readRemoteBranches, readRemoteNames } from './gitOutput'
import { runGitExclusively } from './gitQueue'
import { readGitRepositoryOutcome } from './gitRepository'
import { GIT_CHECKOUT_TIMEOUT_MS, runGit } from './runGit'

/**
 * remote-tracking branch の一覧と、そこからのローカルブランチ作成（Session 3-8-19）。
 *
 * ## gitBranches.ts と別のファイルにしてある
 *
 * 見ているものが違う（`refs/remotes/` と `refs/heads/`）というだけではない。
 * **git を動かす前に確かめることの数が、ここで初めて2つになる。**
 *
 *   3-8-6 の切り替え … 読んだ状態だけで分かる2つ（今のブランチか・競合が残っているか）
 *   3-8-13 の作成    … 1つも無い（始点が解けるかは git に答えさせる）
 *   3-8-19 の作成    … **git へ2回聞く**（名前が埋まっていないか・始点は本当に remote の枝か）
 *
 * 同じファイルに置くと、`applyGitCreateBranch` と `applyGitCreateTrackingBranch` が
 * 「似ているが確かめる数が違う関数」として並ぶ ── 片方を直した日に、
 * もう片方の確かめが増えたり減ったりする形になる。
 *
 * 部品の分担は 3-8-6 / 3-8-14 とまったく同じで、ここが持つのは噛み合わせだけになる。
 *
 *   順番待ち   … gitQueue.ts（走るのは常に1本）
 *   引数       … gitCommands.ts（組み立てられる場所はそこだけ）
 *   値の検証   … shared/git/branchName.ts（純粋・Renderer と共有）
 *   出力の読み … gitOutput.ts（純粋・テスト対象）
 *   失敗の分類 … gitFailure.ts（純粋・テスト対象）
 *   状態の読み … gitRepository.ts（操作の前後で同じ関数を使う）
 *   応答の形   … gitOperationResult.ts（Stage / Commit / Push と共有）
 *
 * ## ネットワークへ出ない
 *
 * 一覧も作成も `fetch` を1回も動かさない ── 読むのは手元の `refs/remotes/` で、
 * 作るのはその ref が指している commit からになる（shared/git/remoteBranch.ts）。
 * したがって認証も要らず、待ち時間の上限もネットワークを見込んだ長さにしていない。
 *
 * つまり**一覧に出るのは最後に fetch / pull した時点の写し**で、それは
 * 画面にそのまま書いてある（renderer/src/git/gitRemoteBranches.ts）。
 *
 * ## アプリが上書き・削除・自動切替をしない（設計判断）
 *
 * 同じ名前のローカルブランチが既にあるとき、取りうる道は4つあった。
 *
 *   1. `--force`（`-C`）で付け替える  … 元の枝がどこにあったかを見失わせる（3-8-13 の線）
 *   2. 先に削除して作り直す           … そこにしか無い commit を巻き添えにしうる（3-8-14 の線）
 *   3. 既にあるブランチへ切り替える   … 押したのは「作る」であって「切り替える」ではない
 *   4. **git を動かさずに断る**       … これにした
 *
 * 3 を選ばないのがいちばん迷うところになる ── 利用者が本当に欲しいのは
 * たいてい「その枝で作業を始めること」で、切り替えれば済むように見える。
 * だがその「既にあるブランチ」が**同じ名前の別物**であることは普通に起こる
 * （手元で作った `feature/x` と、remote の `origin/feature/x` は無関係でありうる）──
 * 黙って切り替えると、押した人は remote の内容が手元に来たと思ったまま、
 * 別の枝の上で作業を始めることになる。
 */

const log = createLogger('git')

/** Git 操作を始められる状態（この層が扱うのはこれだけ）。 */
type ReadyRepository = Extract<GitRepositoryState, { status: 'ready' }>

/* ------------------------------------------------------------------------ 一覧 */

/** 一覧の問い合わせの答え（IPC の応答がそのまま持つ形）。 */
export interface GitRemoteBranchListingOutcome {
  readonly workspaceId: string | null
  readonly listing: GitRemoteBranchListing
  readonly hasRemote: boolean
}

/**
 * remote-tracking branch を一覧する。
 *
 * ## git を2回動かす（`listGitBranches` は1回だった）
 *
 *   1. `git remote`              … 名前の一覧（`origin/feature/x` を切る位置を決める）
 *   2. `for-each-ref refs/remotes` … ref の一覧
 *
 * 1 を省いて名前の最初の `/` で切る形にしないのは、**remote 名に `/` を
 * 入れられる**ため（main/git/gitOutput.ts の `readRemoteBranches`）。
 * 既定のローカル名を間違えると、押した人はそれを打ち直すしかない ──
 * 「既定値を出す」機能が、既定値を直す手間に変わる。
 *
 * 1 の答えは `hasRemote` としても使う ── 一覧が空だったときに言うことが
 * 2つに分かれるためになる（shared/ipc/contracts/git.ts）。**同じ1回の
 * 問い合わせの中で確かめる**ので、`repository.hasRemote` と別の瞬間の
 * 写しになることは無い。
 *
 * ## 順番待ちを通す（`listGitBranches` と同じ）
 *
 * 読み取りだけだが枠を取る ── 切り替えや Pull の最中に読むと、
 * **どちらでもない一瞬**の写しが返りうる。2回の git がその枠の中で
 * 連続して走ることも、ここで担保される（間に他の操作が挟まらない）。
 *
 * ## 先に「操作してよい状態か」を確かめる
 *
 * 一覧を出すということは**手元にブランチを作らせる**ことなので、
 * Git 操作を行わないと決めた状態（`nested` など。設計判断 10）では出さない。
 * 確かめ方は他の操作と同じ `readGitRepositoryOutcome` にしてある。
 */
export async function listGitRemoteBranches(): Promise<GitRemoteBranchListingOutcome> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return {
        workspaceId: before.workspaceId,
        listing: { status: 'not-ready' } as const,
        hasRemote: false
      }
    }

    const remoteNames = await readRemoteNameList()

    if (remoteNames === null) {
      return {
        workspaceId: before.workspaceId,
        listing: { status: 'failed' } as const,
        hasRemote: false
      }
    }

    return {
      workspaceId: before.workspaceId,
      listing: await readRemoteBranchListing(remoteNames),
      hasRemote: remoteNames.length > 0
    }
  })
}

/**
 * 登録されている remote の名前を、長い順で読む。読めなければ null。
 *
 * **読めなかったことを「1つも無い」に倒さない**（`resolveHasRemote` とは逆の判断）。
 * あちらが `false` に倒せたのは、間違えても「公開の入口が出る」で済み、
 * 押せば git が実際の状態を見て断るためだった。
 *
 * こちらで倒すと**一覧そのものが空になる**（どの remote にも属さない行として
 * 全部落ちる）── 利用者から見ると「remote の枝が1つも無い」で、それは嘘になる。
 * 読めなければ一覧を `failed` として返し、開き直してもらう。
 */
async function readRemoteNameList(): Promise<readonly string[] | null> {
  const outcome = await runGit(listRemotes())

  if (outcome.status !== 'completed') {
    return null
  }

  if (outcome.exitCode !== 0) {
    log.info(`git remote exited ${outcome.exitCode}: ${summarizeGitStderr(outcome.stderr)}`)
    return null
  }

  return readRemoteNames(outcome.stdout)
}

/**
 * `for-each-ref refs/remotes` を1回動かして、一覧として読む。
 *
 * **読めなかったことを失敗の分類に落とさない**（`failed` の1種類だけ）──
 * `readBranchListing`（3-8-6）とまったく同じ判断で、一覧が出せないときに
 * 利用者が取れる手は「開き直す」しか無い。
 *
 * 0件は失敗にしない ── remote が1つも無い場合も、まだ一度も fetch していない
 * 場合も、`for-each-ref` は 0 で終わって何も出さない。どちらも正しい答えの1つで、
 * その2つの言い分けは `hasRemote` が持つ。
 */
async function readRemoteBranchListing(
  remoteNames: readonly string[]
): Promise<GitRemoteBranchListing> {
  const outcome = await runGit(listRemoteBranches(GIT_REMOTE_BRANCH_LIMIT))

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
    log.info(
      `git for-each-ref refs/remotes exited ${outcome.exitCode}: ${summarizeGitStderr(outcome.stderr)}`
    )
    return { status: 'failed' }
  }

  const reading = readRemoteBranches(outcome.stdout, remoteNames, GIT_REMOTE_BRANCH_LIMIT)

  return { status: 'ready', branches: reading.branches, truncated: reading.truncated }
}

/* ------------------------------------------------------------------------ 作成 */

/**
 * remote-tracking branch を追うローカルブランチを作って、そこへ切り替える。
 *
 * `name` も `startPoint` も検証済み（ハンドラが `normalizeGitBranchName` を
 * 通している）。ここへ来るのは**そのまま引数として渡せる形**の文字列だけになる ──
 * ただし「形が通る」と「それが remote-tracking branch である」は別で、
 * 後者はここで確かめる。
 *
 * ## 順番は「名前 → 始点」
 *
 * 2つとも git へ聞くが、**名前の側を先に見る。** 利用者から見て直しやすいのは
 * 名前の方だからになる ── 名前が埋まっていれば打ち替えればよく、それは
 * 同じ欄の中にある。始点が無いのは一覧が古いということで、次の一手は
 * 「面を開き直す」になる。両方が当たっている場合に、手前の一手を先に出す。
 *
 * ## 確かめてから動かすまでの間に変わりうる（承知のうえ）
 *
 * 3つの git は同じ順番待ちの枠の中で連続して走るので、**このアプリの中では**
 * 間に何も挟まらない。挟まりうるのは外（端末・別のツール）で、そのときは
 * `switch --create` 自身が断る ── `branch-exists` も `invalid reference` も
 * 分類の表に載っている（`classifyGitBranchFailure`）。**確かめは git の
 * 断りを置き換えるものではなく、押した人に近い言葉で先に返すためのもの**にあたる。
 *
 * ## 作業ツリーの状態は見ない（`applyGitCreateBranch` と同じ）
 *
 * 書きかけがあるか・競合が残っているかは確かめない。3-8-13 で始点つきの作成を
 * 足したときと同じ判断で、**切り替えてよいかを決めるのは git 自身**になる
 * （`--force` も `--merge` も渡していないので、失われるものがあれば断られる。
 * §14.14）。切り替え（`applyGitSwitchBranch`）が競合を先に見るのは、
 * git が「index を先に片付けろ」としか言わず、押した人に何も伝わらないためだった。
 */
export async function applyGitCreateTrackingBranch(
  name: string,
  startPoint: string
): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    const blocked = await findTrackingBranchBlockingState(before.repository, name, startPoint)

    if (blocked !== null) {
      return await finishGitOperation(before.workspaceId, { status: 'failed', reason: blocked })
    }

    const outcome = await runGit(createTrackingBranch(name, startPoint), {
      timeoutMs: GIT_CHECKOUT_TIMEOUT_MS
    })

    return await finishGitOperation(
      before.workspaceId,
      toGitOperationOutcome(outcome, classifyGitBranchFailure)
    )
  })
}

/**
 * 作業ツリーを書き換える前に分かる「作れない理由」。無ければ null。
 *
 * 返しうるのは2つだけで、**どちらも `switch --create` を動かさずに分かる。**
 *
 *   `branch-exists`    … その名前のローカルブランチが既にある
 *   `branch-not-found` … 指した remote-tracking branch が `refs/remotes/` に無い
 *
 * ## 分類は「切り替え / 作成」の表と同じものを返す
 *
 * `classifyGitBranchFailure` が stderr から読む2つと、**同じ分類**にしてある ──
 * 先に返そうと git に断られようと、利用者から見て起きたことは同じで、
 * 次の一手も同じになる（前者は「別の名前を打つ」、後者は「面を開き直す」）。
 * 別の分類を新しく作ると、同じことに2つの文言が付く。
 */
async function findTrackingBranchBlockingState(
  repository: ReadyRepository,
  name: string,
  startPoint: string
): Promise<'branch-exists' | 'branch-not-found' | null> {
  if (await hasExactLocalBranch(name)) {
    return 'branch-exists'
  }

  /*
    HEAD が指しているブランチは `refs/heads/` に無いことがある ── まだ commit が
    1つも無いリポジトリ（unborn）では、`main` という名前は出ていても ref は無い。
    その状態で `main` を作ろうとすると `branch --list` は空を返し、
    ここは通る ── そして `switch --create main --track origin/main` は**通る**
    （実物で確かめてある）。unborn の HEAD が指していた名前を、そのまま
    remote の枝の上で実体にする形になり、これは押した人の意図どおりにあたる。

    したがってここで `repository.head` を見て塞ぐことはしない。読んだ状態を
    引数に取っているのは、この判断を書き残しておくためになる。
  */
  void repository

  if (!(await hasExactRemoteBranch(startPoint))) {
    return 'branch-not-found'
  }

  return null
}

/**
 * その綴りちょうどのローカルブランチが実在するか。
 *
 * 使うのは 3-8-14 の `listExactBranch` そのもの ── 大文字小文字を区別する
 * （保管されている名前と突き合わせる）ことも、`show-ref --verify` が
 * Windows では当てにならないことも、あちらの冒頭に書いてある。
 *
 * ## 読めなかったときは false へ倒す
 *
 * 倒す先を選ぶ基準は 3-8-14 の `needsForceForCaseOnlyRename` と同じ
 * 「間違えたときにどちらが取り返しがつくか」になる。
 *
 *   false へ倒す … `switch --create` が走り、**同じ名前があれば git が断る**
 *                  （`branch-exists`。何も壊れない）
 *   true へ倒す  … 実際には空いている名前で作れなくなり、押した人には
 *                  「既にあります」という**嘘**が出る
 *
 * 前者は「先に返す」が効かないだけで、結末は変わらない。
 *
 * ## 大文字小文字だけが違う名前は、ここでは当たらない
 *
 * `feature` がある手元で `Feature` を作ろうとすると、この確認は素通りする
 * （綴りが違うため）。そのまま `switch --create` が走り、Windows では
 * ref の実体が同じファイルなので git が `already exists` で断る ──
 * 分類は同じ `branch-exists` になり、画面に出る文も同じになる
 * （3-8-14 が rename でだけ `--force` を立てたのは、そこで「相手は自分自身」と
 * 言い切れたためで、作成にその事情は無い）。
 */
async function hasExactLocalBranch(name: string): Promise<boolean> {
  const outcome = await runGit(listExactBranch(name))

  if (outcome.status !== 'completed' || outcome.exitCode !== 0) {
    return false
  }

  return outcome.stdout.trim().length > 0
}

/**
 * その名前ちょうどの remote-tracking branch が実在し、**symbolic ref ではない**か。
 *
 * ## 読めなかったときは true へ倒す（ローカル名の確認とは逆）
 *
 * ここでも基準は「間違えたときにどちらが取り返しがつくか」だが、
 * **答えが裏返る。**
 *
 *   true へ倒す  … `switch --create --track` が走る。名前が解けなければ git が
 *                  `invalid reference` で断り（`branch-not-found`）、
 *                  **同じ分類が同じ文言で出る**
 *   false へ倒す … git を動かさずに「見つかりません」と言い切る。実際には
 *                  在るのに作れない、という**嘘**になる
 *
 * ローカル名の側で false へ倒したのと同じ考え方（確認が効かないだけで、
 * 結末は git が出す）が、ここでは true の側に来る。
 *
 * ただし**倒した先で守られないことが1つ**ある ── ローカルブランチ名を
 * 渡された場合、git はそれを受け取って `branch.<名前>.remote=.` を書く
 * （実物で確かめてある）。これが起こるのは「`git branch --remotes --list` が
 * 動かなかった」という、既に git がまともに動いていない場合に限られる ──
 * そのとき `switch --create` も同じように失敗する見込みが高い。
 * 確実さのために「在るのに作れない」を常時作るより、この一点を受け入れる。
 *
 * ## symbolic ref（`origin/HEAD`）は始点として認めない
 *
 * 一覧から除いてあるものが、要求としては届きうる（`branch --list` の
 * パターンには一致する。実物で確かめてある）── 認めると
 * 「`origin/HEAD` を追うブランチ」が作られ、その追跡先は**別名**を指す。
 * remote 側で既定ブランチが変わった日に、追跡先が黙って別の枝へ移ることになる。
 */
async function hasExactRemoteBranch(name: string): Promise<boolean> {
  const outcome = await runGit(listExactRemoteBranch(name))

  if (outcome.status !== 'completed' || outcome.exitCode !== 0) {
    return true
  }

  for (const line of outcome.stdout.split('\n')) {
    const separator = line.indexOf('\0')

    if (separator < 0) {
      continue
    }

    // 空でなければ symbolic ref（`origin/HEAD`）── 始点にしない。
    if (line.slice(separator + 1).trim().length > 0) {
      continue
    }

    if (line.slice(0, separator).trim().length > 0) {
      return true
    }
  }

  return false
}
