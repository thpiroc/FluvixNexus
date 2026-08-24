import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { createLogger } from '../logger'
import { currentPlatform } from '../platform'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import { summarizeGitStderr } from '../git/gitFailure'
import type { GitHubCliCommand } from './githubCommands'
import { createGitHubCliEnvironment } from './githubEnvironment'
import { resolveGitHubCliExecutable } from './githubExecutable'

/**
 * `gh` を実行する唯一の場所（Session 3-8-10）。
 *
 * 形は main/git/runGit.ts とまったく同じで、受け取るのは
 * `GitHubCliCommand` **1つだけ**になる。
 *
 *   実行ファイル     … `resolveGitHubCliExecutable` が PATH を辿って実体を確かめる
 *   作業ディレクトリ … 今の Workspace root（Main が持つ正本）
 *   引数             … main/github/githubCommands.ts が組み立てたものだけ
 *
 * シェルを通さない（`execFile`・`shell` は既定の false）のも同じ ── 通すと
 * 引数が文字列として再解釈され、`&` や `|` を含む値が別のコマンドとして走りうる。
 *
 * ## 標準入力を渡す欄が無い
 *
 * runGit は Commit メッセージのために `input` を持つ（gitCommands.ts）が、
 * こちらには渡すものが1つも無い。**stdin は開いたまま閉じる** ── gh が
 * 何かを尋ねようとした場合、読める入力が無いことで即座に諦める
 * （対話は環境変数でも止めてある。githubEnvironment.ts）。
 *
 * ## 終了コードを失敗として扱わない
 *
 * git と同じで、非0は「正常な答えの1つ」でありうる ── `gh auth status` は
 * ログインしていなければ 1 で終わり、それは**答え**にあたる。
 * 意味を決めるのは呼び出し側になる（ghRepositoryPublisher.ts）。
 *
 * ## 詳細は Main に残す（設計判断 3）
 *
 * stderr は Renderer へ渡さず、ここでログへ残す。gh の出力には
 * repository の URL や利用者のアカウント名が混ざるため、**要約して**残す
 * （`summarizeGitStderr` は改行を潰して長さを切る。main/git/gitFailure.ts）。
 */

const log = createLogger('github')

/**
 * 応答を待つ上限。
 *
 * gh はネットワークへ出る（repository の作成は GitHub の API を1回叩き、
 * `auth status` も token の有効性を確かめに行くことがある）。
 * 10 秒では回線次第で足りず、かといって git の2分ほどは要らない ──
 * こちらが待っているのは**API 1回分の往復**で、大きなデータの転送では
 * ないため。
 *
 * 上限そのものを外さないのは、公開の一連がまるごと1つの順番待ちの枠に
 * 入っている（gitQueue.ts）ため ── 握られている間は Stage も Commit も動かない。
 */
export const GITHUB_CLI_TIMEOUT_MS = 60_000

/**
 * 読み取る出力の上限。
 *
 * 読むのは URL 1行だけで、`auth status` でも数行にしかならない。
 * 上限を置いているのは、壊れた gh や差し替えられた実行ファイルが延々と
 * 出力し続けたときに Main のメモリを食い潰させないためになる。
 */
export const GITHUB_CLI_MAX_OUTPUT_BYTES = 1024 * 1024

/** gh を1回動かした結果。 */
export type GitHubCliOutcome =
  | {
      readonly status: 'completed'
      readonly exitCode: number
      readonly stdout: string
      readonly stderr: string
    }
  /** Workspace が開かれていない（実行する場所が無い）。 */
  | { readonly status: 'no-workspace' }
  /** この PC で gh を見つけられなかった。 */
  | { readonly status: 'cli-missing' }
  /** gh を動かせなかった（起動できない・時間切れ・出力が大きすぎる）。 */
  | { readonly status: 'failed'; readonly detail: string }

/** `execFile` が渡してくる失敗の形（runGit.ts と同じ理由で自前の形で受ける）。 */
interface ExecFileFailure {
  readonly code?: number | string
  readonly killed?: boolean
  readonly name?: string
  readonly message?: string
}

/**
 * 今の Workspace で gh を1回動かす。
 *
 * 例外は投げない。結末はすべて `GitHubCliOutcome` として返る。
 *
 * ## 作業ディレクトリを引数にしない
 *
 * runGit.ts と同じ線になる。ここで動かす2つのコマンドはどちらも
 * 作業ディレクトリを読まない（`repo create` に `--source` を渡していないため。
 * githubCommands.ts）が、**受け取る形にしないこと自体**が守っているもので、
 * 呼び出し側が増えても「どこで実行するか」を決める場所は増えない。
 *
 * Workspace が開かれていなければ動かさない。gh の答えは Workspace に依らないが、
 * **場所の分からないプロセスを起動しない**方を選んである（アプリの起動時の
 * カレントディレクトリは、どこであってもおかしくない）。
 */
export async function runGitHubCli(command: GitHubCliCommand): Promise<GitHubCliOutcome> {
  const workspace = getCurrentWorkspaceFolder()

  if (workspace === null) {
    return { status: 'no-workspace' }
  }

  /*
    毎回辿る（覚えない）。公開を押した人がその場で gh を入れることが
    いちばんありうるため（githubExecutable.ts）。
  */
  const executable = resolveGitHubCliExecutable(currentPlatform, process.env, existsSync)

  if (executable === null) {
    log.info('the GitHub CLI was not found on this machine.')
    return { status: 'cli-missing' }
  }

  return await new Promise<GitHubCliOutcome>((resolve) => {
    execFile(
      executable,
      [...command.args],
      {
        // 実行する場所は Main が持つ正本だけ。呼び出し側は指定できない。
        cwd: workspace.rootPath,
        env: createGitHubCliEnvironment(process.env),
        timeout: GITHUB_CLI_TIMEOUT_MS,
        maxBuffer: GITHUB_CLI_MAX_OUTPUT_BYTES,
        // コンソールの窓を一瞬も出さない（利用者から見て gh は裏で動く）。
        windowsHide: true,
        encoding: 'utf8'
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ status: 'completed', exitCode: 0, stdout, stderr })
          return
        }

        const failure = error as ExecFileFailure

        // 非0で終わった。gh は動いているので、意味は呼び出し側が決める。
        if (typeof failure.code === 'number') {
          if (stderr.trim().length > 0) {
            log.info(`gh ${command.label} exited ${failure.code}: ${summarizeGitStderr(stderr)}`)
          }

          resolve({ status: 'completed', exitCode: failure.code, stdout, stderr })
          return
        }

        resolve(toCliFailure(command, failure))
      }
    )
  })
}

/** gh を動かせなかった場合の結末を決める。 */
function toCliFailure(command: GitHubCliCommand, failure: ExecFileFailure): GitHubCliOutcome {
  const detail = `${failure.name ?? 'Error'}: ${failure.message ?? 'unknown'}`

  if (failure.killed === true) {
    log.warn(`gh ${command.label} timed out after ${GITHUB_CLI_TIMEOUT_MS}ms.`)
    return { status: 'failed', detail }
  }

  // 解決した直後に消えた（アンインストール中など）。
  if (failure.code === 'ENOENT') {
    return { status: 'cli-missing' }
  }

  log.error(`gh ${command.label} failed to run: ${detail}`)

  return { status: 'failed', detail }
}
