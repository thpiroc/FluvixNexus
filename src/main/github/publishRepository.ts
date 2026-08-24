import type {
  GitOperationFailureReason,
  GitOperationOutcome,
  GitRepositoryState
} from '@shared/git'
import type { GitHubAvailability, GitHubRepositoryVisibility } from '@shared/github'
import { addOriginRemote, pushSettingUpstreamInteractively } from '../git/gitCommands'
import { classifyGitOperationFailure, classifyGitPushFailure } from '../git/gitFailure'
import {
  finishGitOperation,
  notReadyGitOperation,
  toGitOperationOutcome,
  type GitOperationResult
} from '../git/gitOperationResult'
import { runGitExclusively } from '../git/gitQueue'
import { hasGitHeadCommit, readGitRepositoryOutcome } from '../git/gitRepository'
import { GIT_INTERACTIVE_PUSH_TIMEOUT_MS, runGit } from '../git/runGit'
import { createLogger } from '../logger'
import { getGitHubRepositoryPublisher } from './githubRepositoryPublisher'

/**
 * GitHub への公開（Session 3-8-10）。
 *
 * DESIGN.md §3 の「初回のみ『GitHub に公開』ボタンから、Git 初期化 →
 * 初回 Commit → GitHub リポジトリ作成 → remote 設定 → Push まで」のうち、
 * **後ろの3つ**を1つの操作にしたものになる。
 *
 * 前の2つ（初期化・初回 Commit）は**この操作に含めない。**
 *
 *   `git init`   … 別の操作（main/git/gitInit.ts）。押した後に公開を促しもしない
 *   初回 Commit  … 自動化しない。commit が無ければ `no-commit` として断る
 *
 * 5つを一続きにしないのは、3-8-1 で初期化を見送った理由がそのまま効くため ──
 * **途中まで自動でやって止まると、利用者が自分で片付けられない状態が残る。**
 * 分けたうえで、残った3つの側は「途中で止まっても、もう一度押せば続きから
 * 進む」形にしてある（下記）。
 *
 * ## 部品の分担
 *
 *   順番待ち     … git/gitQueue.ts（走る git は常に1本。gh もこの枠の中で動く）
 *   repository   … githubRepositoryPublisher.ts（**差し替え可能な境界**。設計判断 12）
 *   git の引数   … git/gitCommands.ts（組み立てられる場所はそこだけ）
 *   失敗の分類   … git/gitFailure.ts / githubFailure.ts（純粋・テスト対象）
 *   状態の読み   … git/gitRepository.ts（操作の前後で同じ関数を使う）
 *   応答の形     … git/gitOperationResult.ts（Stage / Commit / Push と共有）
 *
 * **新しい仕組みを1つも作っていない**のがこのファイルの要点になる。公開は
 * 「読む → 確かめる → 動かす → 読み直す」という 3-8-3 からの形のままで、
 * 増えたのは真ん中で動かすものが3つになったことだけにあたる。
 *
 * ## 途中経過を覚えない
 *
 * 「どこまで進んだか」をアプリの中に持たない。押されるたびに
 * **Git の実状態（remote があるか・commit があるか）を読み直して**、
 * 済んでいるところを飛ばす。
 *
 * 覚える形にすると、覚えたものと実際が食い違ったときに
 * **食い違ったまま次が走る** ── 端末で `git remote add` した・GitHub 側で
 * repository を消した、はどちらも普通に起こる。読み直すなら、その2つは
 * どちらも「今の状態」として正しく扱われる。
 *
 * ## 既にあるものは作り直さない
 *
 * remote が1つでもあれば repository を作らない（`origin` を上書きしない）。
 * 同じ名前が GitHub にあれば**別名で作り直さない**（`github-repository-exists`
 * として断り、次の名前は利用者が決める）。`--force` にあたるものは
 * どこにも無い ── 公開は「外に物ができる」操作で、押し間違えたときに
 * 戻せないものを増やさない。
 */

const log = createLogger('github')

/** Git 操作を始められる状態（この層が扱うのはこれだけ）。 */
type ReadyRepository = Extract<GitRepositoryState, { status: 'ready' }>

/** 公開の要求（検証済みの値だけが届く）。 */
export interface PublishRepositoryRequest {
  readonly name: string
  readonly visibility: GitHubRepositoryVisibility
}

/**
 * GitHub CLI が使える状態かを尋ねる。
 *
 * ## 順番待ちを通さない
 *
 * git を1回も動かさず、リポジトリにも触らないため（gh に聞くだけ）。
 * 枠を取ると、公開の面を開いただけで Stage / Commit が待たされることになる ──
 * `git:get-repository` が枠を取っているのとは事情が違う（あちらは
 * 操作の途中の index を読まないための順番待ちだった）。
 */
export async function describeGitHubAvailability(): Promise<GitHubAvailability> {
  return await getGitHubRepositoryPublisher().checkAvailability()
}

/**
 * 今のリポジトリを GitHub へ公開する。
 *
 * 順番は「確かめる → 作る → remote → Push → 読み直す」で、**確かめる側が
 * いちばん長い** ── 外に物ができてから断るのがいちばん高くつくため。
 */
export async function publishRepositoryToGitHub(
  request: PublishRepositoryRequest
): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    const blocked = await findPublishBlockingState(before.repository)

    if (blocked !== null) {
      return await finishGitOperation(before.workspaceId, { status: 'failed', reason: blocked })
    }

    /*
      remote が既にある ＝ ここまでは済んでいる（あるいは利用者が自分で
      設定した）。**作り直さず、残りの Push だけを行う。**
    */
    if (before.repository.hasRemote) {
      return await finishGitOperation(before.workspaceId, await runInitialPush(false))
    }

    const created = await getGitHubRepositoryPublisher().createRepository(request)

    if (created.status === 'failed') {
      log.info(`the GitHub repository could not be created: ${created.reason}`)

      return await finishGitOperation(before.workspaceId, {
        status: 'failed',
        reason: created.reason
      })
    }

    const connected = await connectOrigin(created.remoteUrl)

    if (connected !== null) {
      return await finishGitOperation(before.workspaceId, connected)
    }

    return await finishGitOperation(before.workspaceId, await runInitialPush(true))
  })
}

/**
 * 読んだ状態だけで分かる「公開できない理由」。無ければ null。
 *
 * **どれも外へ出る前に分かる。** repository を作ってから手元の理由で断ると、
 * GitHub 側に誰も使わない空の repository が残る ── Push の前に
 * ブランチと remote を確かめている（main/git/gitSync.ts）のと同じ判断だが、
 * こちらは**残るものがアプリの外にある**分だけ効く。
 */
async function findPublishBlockingState(
  repository: ReadyRepository
): Promise<GitOperationFailureReason | null> {
  /*
    detached HEAD。送り先のブランチを決める土台が無く、**アプリが代わりに
    ブランチを作ることはしない**（Push と同じ。shared/git/operation.ts）。
  */
  if (repository.head.kind !== 'branch') {
    return 'not-on-branch'
  }

  const head = await hasGitHeadCommit()

  if (head === null) {
    return 'unknown'
  }

  /*
    commit がまだ1つも無い。**中身の無いリポジトリを公開しない** ──
    アプリが代わりに Commit を作ることもしない（shared/git/operation.ts の
    `no-commit`）。次の一手は「先に Commit する」で、それは同じパネルの
    すぐ上にそのまま在る。
  */
  return head ? null : 'no-commit'
}

/**
 * `origin` を設定する。うまくいけば null、駄目ならその結末。
 *
 * ## 失敗を `partly-applied` として返す
 *
 * ここまで来ている時点で、**GitHub 側には repository ができている。**
 * ただの失敗として返すと、利用者は同じ名前でもう一度押し、今度は
 * 「同じ名前が既にあります」と言われる ── 何が起きたのか分からなくなる。
 *
 * `reason` に `no-remote` を入れているのは、それが**今この瞬間の事実**
 * だからになる（repository はある。remote は無い）。画面には
 * 「repository は作成された」＋「remote が設定されていない」の2つが並ぶ。
 *
 * **作った repository を消して失敗に揃えることはしない** ── 頼まれていない
 * 取り消しであり、しかも消す操作そのものが失敗しうる（Commit & Push が
 * commit を戻さないのと同じ判断。shared/git/operation.ts）。
 *
 * なお、ここが失敗するのは `.git/config` に書けないときだけになる
 * （`origin` が既にある場合は、その手前で remote の有無を見て分かれている）。
 */
async function connectOrigin(remoteUrl: string): Promise<GitOperationOutcome | null> {
  const outcome = await runGit(addOriginRemote(remoteUrl))

  if (outcome.status === 'completed' && outcome.exitCode === 0) {
    return null
  }

  const failure = toGitOperationOutcome(outcome, classifyGitOperationFailure)

  log.warn(
    `the GitHub repository was created but origin could not be set: ${
      failure.status === 'applied' ? 'unknown' : failure.reason
    }`
  )

  return { status: 'partly-applied', completed: 'github-repository', reason: 'no-remote' }
}

/**
 * 初回 Push（`--set-upstream` まで）。
 *
 * ## ここだけ credential helper の対話を許す
 *
 * 使う引数は `pushSettingUpstreamInteractively`（main/git/gitCommands.ts）で、
 * 通常の Push と違って `credential.interactive=false` を渡さない ──
 * 利用者が「GitHub に公開する」と押した直後は、**認証を求められることを
 * 予期できる唯一の場面**にあたる。理由はあちらの冒頭に書いてある。
 *
 * 待ち時間の上限も専用のもの（人が答える時間が要る。runGit.ts）。
 *
 * ## 作った直後だけ `partly-applied`
 *
 * `justCreated` は「**この1回で**外に物ができたか」になる。remote が既にあって
 * Push だけを行った場合は、通らなくても増えたものが無い ── ただの失敗として
 * 返し、押した人は Push ボタンで同じことを試せる。
 */
async function runInitialPush(justCreated: boolean): Promise<GitOperationOutcome> {
  const outcome = await runGit(pushSettingUpstreamInteractively(), {
    timeoutMs: GIT_INTERACTIVE_PUSH_TIMEOUT_MS
  })
  const pushed = toGitOperationOutcome(outcome, classifyGitPushFailure)

  if (pushed.status === 'applied' || !justCreated) {
    return pushed
  }

  log.info(
    `the GitHub repository was created but the first push did not go through: ${pushed.reason}`
  )

  return { status: 'partly-applied', completed: 'github-repository', reason: pushed.reason }
}
