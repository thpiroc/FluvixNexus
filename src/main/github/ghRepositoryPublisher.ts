import type { GitHubAvailability } from '@shared/github'
import { createLogger } from '../logger'
import { createGitHubRepository, showGitHubAuthStatus } from './githubCommands'
import { classifyGitHubCreateFailure } from './githubFailure'
import { readCreatedRepositoryUrl } from './githubOutput'
import type {
  GitHubRepositoryCreation,
  GitHubRepositoryCreationRequest,
  GitHubRepositoryPublisher
} from './githubRepositoryPublisher'
import { runGitHubCli } from './runGitHubCli'

/**
 * GitHub CLI（`gh`）で repository を作る実装（Session 3-8-10）。
 *
 * 差し替え可能な境界（githubRepositoryPublisher.ts）の、今のところ唯一の実装に
 * あたる。gh の都合（引数・出力の読み方・失敗の文言）はすべてこの中に収まり、
 * 外から見えるのは「作れた / 作れなかった（分類つき）」だけになる。
 *
 * ## なぜ gh なのか（設計判断）
 *
 * repository を作るには GitHub の資格情報が要る。自前で OAuth を持つと、
 * **アプリが token を保管することになる** ── 暗号化・失効・複数アカウントの
 * 設計がアプリ1つ分増え、しかも利用者の PC には既に同じものを持った道具
 * （gh）が居ることが多い（設計判断 7 で、git の資格情報を持たないと決めたのと
 * まったく同じ理由）。
 *
 * 代償は「gh が入っていなければ公開できない」ことになる。**アプリが勝手に
 * 入れることはしない** ── 案内と winget の1行を出すところまでで止める
 * （renderer/src/git/githubPublish.ts）。
 */

const log = createLogger('github')

/**
 * `gh auth status` の答えを、そのまま状態にする。
 *
 * ## 終了コードだけを見る
 *
 * gh の版によって、ログインの情報を stdout に書くものと stderr に書くものが
 * ある。文言も変わる ── 当てにできるのは終了コード1つだけになる。
 *
 * ## 非0を `signed-out` に倒す
 *
 * ネットワークが繋がらないときも `gh auth status` は非0で終わりうる。
 * それでも `failed` ではなく `signed-out` に倒すのは、**そこから出す案内が
 * 次の一手として正しい**ため ── `gh auth login` は繋がらなければそこで
 * 分かるし、繋がれば公開まで通る。逆に「もう一度お試しください」だけを
 * 出すと、ログインしていない人が何度も押すことになる。
 */
async function checkAvailability(): Promise<GitHubAvailability> {
  const outcome = await runGitHubCli(showGitHubAuthStatus())

  switch (outcome.status) {
    case 'cli-missing':
      return { status: 'cli-missing' }

    /*
      Workspace が閉じられた（gh を動かす場所が無い）。gh の状態そのものは
      分からないので `failed` に落とす ── 公開の面は Workspace が開いている
      ときにしか出ないため、利用者がここを見ることは無い。
    */
    case 'no-workspace':
    case 'failed':
      return { status: 'failed' }

    case 'completed':
      break
  }

  return outcome.exitCode === 0 ? { status: 'ready' } : { status: 'signed-out' }
}

/**
 * 空の repository を1つ作る。
 *
 * ## 出力から URL を読めなければ、作れなかったことにしない
 *
 * gh が 0 で終わったなら repository は**できている。** そこで URL だけが
 * 読めなかった場合に `failed` を返すと、利用者から見て
 * 「失敗したと言われたのに GitHub には repository がある」になる ──
 * それでも `failed` を返すのは、**remote を設定できない以上そこから先へ
 * 進めない**ためで、分類は `unknown`（＝「詳しくはログを見てほしい」）に
 * してある。次に押したときは `already exists` として返り、
 * 「別の名前をお試しください」という次の一手が出る。
 *
 * この形になるのは gh の出力が想定と違ったときだけで、実際には起こらない。
 */
async function createRepository(
  request: GitHubRepositoryCreationRequest
): Promise<GitHubRepositoryCreation> {
  const outcome = await runGitHubCli(createGitHubRepository(request.name, request.visibility))

  switch (outcome.status) {
    case 'cli-missing':
      return { status: 'failed', reason: 'github-cli-missing' }

    case 'no-workspace':
      return { status: 'failed', reason: 'not-ready' }

    /*
      起動できなかった・時間切れ。どちらも「もう一度試す」が次の一手になる
      （時間切れかどうかを分けていないのは、gh の側で長く待たせるのが
      ネットワークだけで、その理由は `network-unavailable` として
      stderr から分かるため）。
    */
    case 'failed':
      return { status: 'failed', reason: 'unknown' }

    case 'completed':
      break
  }

  if (outcome.exitCode !== 0) {
    return { status: 'failed', reason: classifyGitHubCreateFailure(outcome.stderr) }
  }

  const remoteUrl = readCreatedRepositoryUrl(outcome.stdout)

  if (remoteUrl === null) {
    log.warn('gh repo create succeeded but its output did not contain a repository URL.')
    return { status: 'failed', reason: 'unknown' }
  }

  return { status: 'created', remoteUrl }
}

export const ghRepositoryPublisher: GitHubRepositoryPublisher = {
  checkAvailability,
  createRepository
}
