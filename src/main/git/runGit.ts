import { execFile } from 'child_process'
import { existsSync } from 'fs'
import type { GitFailureReason } from '@shared/git'
import { createLogger } from '../logger'
import { currentPlatform } from '../platform'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import type { GitCommand } from './gitCommands'
import { createGitEnvironment } from './gitEnvironment'
import { resolveGitExecutable } from './gitExecutable'
import { summarizeGitStderr } from './gitFailure'

/**
 * git を実行する唯一の場所（Session 3-8-1）。
 *
 * ## Renderer から任意の git を実行できる形を作らない
 *
 * この関数が受け取るのは `GitCommand` **1つだけ**で、次のどれも引数に取らない。
 *
 *   実行ファイル … `resolveGitExecutable` が PATH を辿って実体を確かめる
 *   作業ディレクトリ … 今の Workspace root（Main が持つ正本）
 *   引数 … main/git/gitCommands.ts が組み立てたものだけ
 *
 * とくに**作業ディレクトリを引数にしていない**のが要点になる。受け取る形にすると、
 * 呼び出し側が増えるたびに「どこで実行するか」を決める場所が増え、いずれ
 * Renderer から届いたパスがそこへ入る。正本から自分で取れば、その余地が無い
 * （main/terminal/terminalSessions.ts が cwd を受け取らないのと同じ形）。
 *
 * ## シェルを通さない
 *
 * `execFile` を使い（`exec` ではない）、`shell` は既定の false のまま。
 * シェルを通すと引数が文字列として再解釈され、`&` や `|` を含む値が
 * 別のコマンドとして走りうる。ブランチ名やファイル名にそういう文字は実際に入る。
 *
 * ## 利用者が書いた文章は、引数ではなく標準入力から渡す（Session 3-8-4）
 *
 * Commit メッセージのように「長く・改行を含み・先頭が `-` になりうる」値は、
 * コマンドラインに載せない（`input`）。載せる形にすると、長さの上限（Windows の
 * 32767 文字）・改行・オプションと読まれること・ログへの写り込みのそれぞれに
 * 別の配慮が要り、**そのどれか1つを忘れた日に破れる。**
 *
 * 標準入力なら、その文字列が引数として解釈される経路そのものが無い。
 * 何をどう読ませるか（`--file=-`）を決めるのは gitCommands.ts の側で、
 * ここが持つのは「渡す手段」だけになる。
 *
 * ## 終了コードを失敗として扱わない
 *
 * git は「正常な答え」を非0で返すことがある ── `symbolic-ref --quiet` が
 * detached HEAD で 1 を返すのがそれで、`rev-parse --show-toplevel` が
 * リポジトリでないフォルダで 128 を返すのもそれにあたる。
 * ここでは終了コードと stdout / stderr をそのまま返し、**意味を決めるのは
 * 呼び出し側**にしてある（main/git/gitRepository.ts）。
 *
 * `failed` として返すのは「git を動かせなかった」場合だけ ──
 * 起動できない・時間切れ・出力が大きすぎる。
 *
 * ## 詳細は Main に残す（設計判断 3）
 *
 * stderr は Renderer へ渡さず、ここでログへ残す。Renderer へ渡るのは
 * この後 `gitRepository.ts` が決める分類だけになる。
 */

const log = createLogger('git')

/**
 * 応答を待つ上限。
 *
 * Session 3-8-1 が呼ぶのはどれも即答するコマンドで、実測では 50ms ほどで返る。
 * これは**返ってこない場合の逃げ道**にあたる ── ネットワークドライブ上の
 * リポジトリ、巨大なリポジトリ、ロックの取り合いで待たされることがある。
 *
 * ここで諦めても利用者に見えるのは「もう一度試す」ボタンの付いた案内で、
 * パネルが固まったままになるより良い。
 *
 * Push / Pull（Session 3-8-5）は性質が違う（ネットワーク越しに数十秒かかりうる）
 * ため、そちらは別の上限を持たせる。Commit も同じ理由で別枠になる（下記）。
 */
export const GIT_COMMAND_TIMEOUT_MS = 10_000

/**
 * Commit を待つ上限（Session 3-8-4）。
 *
 * git 自身の仕事は一瞬で終わるが、**Commit だけは利用者のプログラムが走る**。
 * `pre-commit` / `commit-msg` などの hook はリポジトリが用意したもので、
 * lint やテストを丸ごと動かすものも珍しくない ── 10 秒で諦めると、
 * そういうリポジトリでは Commit が**必ず**時間切れになる。
 *
 * それでも上限そのものを外さないのは、hook が入力を待って止まる形（端末が
 * 付いていないため答えようが無い）があるため。2分は「重い hook は通り、
 * 止まった hook はいずれ返る」の境目にあたる。
 *
 * hook を迂回する（`--no-verify`）方で短くしないのは、リポジトリが置いた
 * 決まりごとをアプリが黙って外すことになるため（shared/git/operation.ts）。
 */
export const GIT_COMMIT_TIMEOUT_MS = 120_000

/**
 * ネットワーク越しに動く git を待つ上限（Session 3-8-5）。
 *
 * `fetch` / `push` がこれを使う。10 秒では**普通に足りない** ── 相手のサーバー、
 * 回線、リポジトリの大きさのどれかが重ければ、正常な Push でも十数秒かかる。
 * そこで諦めると「時間切れ」しか出ないアプリになる。
 *
 * それでも上限を外さないのは、**返ってこない相手が実在する**ため。応答を返さない
 * proxy、到達できないホスト、認証待ちで止まった helper のどれもが、上限が
 * 無ければ永久に枠を握る ── 順番待ちは1本なので（gitQueue.ts）、
 * 握られた間は Stage も Commit も動かない。
 *
 * 値は Commit と同じ2分だが、**理由が違うので別の定数にしてある。** 片方を
 * 変えたいときに、もう片方まで一緒に動くのを避ける。
 *
 * `merge --ff-only` はネットワークを使わないため、こちらではなく
 * `GIT_COMMIT_TIMEOUT_MS` を使う ── あちらと同じく `post-merge` hook が走りうる、
 * つまり**利用者のプログラムが動く**方の理由にあたる（main/git/gitSync.ts）。
 */
export const GIT_NETWORK_TIMEOUT_MS = 120_000

/**
 * ブランチの切り替え / 作成を待つ上限（Session 3-8-6）。
 *
 * 上限が要る理由は Commit と同じ（`post-checkout` hook が走りうる ── つまり
 * **利用者のプログラムが動く**）が、それだけではない。切り替えは
 * **作業ツリーのファイルを実際に書き換える**操作で、git 自身の仕事が
 * 一瞬で終わらない場合がある。
 *
 *   ファイル数が多い    … ブランチ間で数万件が入れ替わることがある
 *   Windows の事情      … ウイルス対策ソフトが書き込みごとに割り込む
 *   ネットワークドライブ … 1ファイルごとの往復が効いてくる
 *
 * 10 秒（`GIT_COMMAND_TIMEOUT_MS`）では**普通に足りない**。そこで諦めると、
 * 大きなリポジトリでは切り替えが必ず時間切れになる ── しかも**途中まで
 * 書き換えた作業ツリー**が残る（プロセスを殺すため）。これは他のどの操作の
 * 時間切れよりも直しにくい状態にあたるので、上限は十分に長く取る。
 *
 * 値は Commit / ネットワークと同じ2分だが、**理由が違うので別の定数にしてある。**
 * 片方を変えたいときに、もう片方まで一緒に動くのを避ける
 * （`GIT_COMMIT_TIMEOUT_MS` と `GIT_NETWORK_TIMEOUT_MS` を分けてあるのと同じ）。
 *
 * ブランチの**一覧**はこちらを使わない（即答する読み取りなので既定のまま）。
 */
export const GIT_CHECKOUT_TIMEOUT_MS = 120_000

/**
 * 読み取る出力の上限。
 *
 * `execFile` の既定（1MB）は変更ファイルが数千件あるリポジトリの `status` で
 * 足りなくなる（Session 3-8-2）。ここで先に広げておく。
 * 上限そのものを外さないのは、**壊れたリポジトリやフックが延々と出力し続けた
 * ときに Main のメモリを食い潰させない**ため。
 */
export const GIT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/**
 * git を1回動かした結果。
 *
 * `completed` は「git が動いて、終了コードを返した」という事実だけを表す。
 * 成功とは限らない ── その判断は呼び出し側が行う。
 */
export type GitRunOutcome =
  | {
      readonly status: 'completed'
      readonly exitCode: number
      readonly stdout: string
      readonly stderr: string
    }
  /** Workspace が開かれていない（実行する場所が無い）。 */
  | { readonly status: 'no-workspace' }
  /** この PC で git を見つけられなかった。 */
  | { readonly status: 'git-unavailable' }
  /** git を動かせなかった。 */
  | { readonly status: 'failed'; readonly reason: GitFailureReason; readonly detail: string }

/**
 * `execFile` が渡してくる失敗の形。
 *
 * Node の型では `ExecFileException` になるが、終了コード（number）と
 * システムのエラー名（string）が同じ `code` に入ってくるため、
 * 読み分けるために自前の形で受ける。
 */
interface ExecFileFailure {
  readonly code?: number | string
  readonly killed?: boolean
  readonly signal?: string
  readonly name?: string
  readonly message?: string
}

/**
 * 1回の実行に添えられるもの（Session 3-8-4）。
 *
 * **どちらも「何を実行するか」ではない。** 実行ファイル・引数・作業ディレクトリを
 * 受け取らないという線（このファイルの冒頭）は動いていない ── ここにあるのは
 * 「渡し方」と「どれだけ待つか」だけになる。
 */
export interface GitRunOptions {
  /**
   * 標準入力へ流す文字列。
   *
   * 渡した時点で書き込んで閉じる（`end`）── git が読み終わらない限り
   * 終わらないコマンド（`--file=-`）に対して、閉じないまま待つと双方が止まる。
   */
  readonly input?: string
  /** 待ち時間の上限。省略すると `GIT_COMMAND_TIMEOUT_MS`。 */
  readonly timeoutMs?: number
}

/**
 * 今の Workspace で git を1回動かす。
 *
 * 例外は投げない。結末はすべて `GitRunOutcome` として返る
 * （IPC のハンドラが IpcError へ翻訳するのはさらに上の層）。
 */
export async function runGit(command: GitCommand, options?: GitRunOptions): Promise<GitRunOutcome> {
  const workspace = getCurrentWorkspaceFolder()
  const timeoutMs = options?.timeoutMs ?? GIT_COMMAND_TIMEOUT_MS

  if (workspace === null) {
    return { status: 'no-workspace' }
  }

  /*
    毎回辿る（覚えない）。利用者はアプリを開いたまま Git を入れることがあり、
    控えると「入れたのに使えない」が起動し直すまで続く（gitExecutable.ts）。
  */
  const executable = resolveGitExecutable(currentPlatform, process.env, existsSync)

  if (executable === null) {
    log.info('git was not found on this machine.')
    return { status: 'git-unavailable' }
  }

  return await new Promise<GitRunOutcome>((resolve) => {
    const child = execFile(
      executable,
      [...command.args],
      {
        // 実行する場所は Main が持つ正本だけ。呼び出し側は指定できない。
        cwd: workspace.rootPath,
        env: createGitEnvironment(process.env),
        timeout: timeoutMs,
        maxBuffer: GIT_MAX_OUTPUT_BYTES,
        // コンソールの窓を一瞬も出さない（利用者から見て git は裏で動く）。
        windowsHide: true,
        encoding: 'utf8'
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ status: 'completed', exitCode: 0, stdout, stderr })
          return
        }

        const failure = error as ExecFileFailure

        // 非0で終わった。git は動いているので、意味は呼び出し側が決める。
        if (typeof failure.code === 'number') {
          if (stderr.trim().length > 0) {
            // 詳細は Main に残し、Renderer へは分類だけを渡す（設計判断 3）。
            log.info(`git ${command.label} exited ${failure.code}: ${summarizeGitStderr(stderr)}`)
          }

          resolve({ status: 'completed', exitCode: failure.code, stdout, stderr })
          return
        }

        resolve(toRunFailure(command, failure, timeoutMs))
      }
    )

    if (options?.input !== undefined) {
      writeGitInput(child.stdin, options.input)
    }
  })
}

/**
 * 標準入力へ流して閉じる（Session 3-8-4）。
 *
 * **書き込みの失敗を握り潰す。** git が読む前に終わった場合（引数が違う・
 * hook が即座に落ちた）、こちらの書き込みは EPIPE になる。それは
 * 「git を動かせなかった」ではなく、その git の**終了コードで既に分かっている**
 * ことなので、ここで別の失敗として立てると同じ1回の実行に2つの結末が生まれる。
 *
 * 文字列は UTF-8 で送る。git は commit メッセージを既定で UTF-8 として扱う
 * （`i18n.commitEncoding`）ため、日本語もそのまま記録される。
 */
function writeGitInput(stdin: NodeJS.WritableStream | null, input: string): void {
  if (stdin === null) {
    return
  }

  stdin.on('error', () => undefined)
  stdin.end(Buffer.from(input, 'utf8'))
}

/** git を動かせなかった場合の結末を決める。 */
function toRunFailure(
  command: GitCommand,
  failure: ExecFileFailure,
  timeoutMs: number
): GitRunOutcome {
  const detail = `${failure.name ?? 'Error'}: ${failure.message ?? 'unknown'}`

  /*
    timeout に達すると Node はプロセスを殺す。`killed` はそのときに立つ
    （signal だけを見ると、外から殺された場合と区別できない）。
  */
  if (failure.killed === true) {
    log.warn(`git ${command.label} timed out after ${timeoutMs}ms.`)
    return { status: 'failed', reason: 'timeout', detail }
  }

  // 解決した直後に消えた（アンインストール中など）。
  if (failure.code === 'ENOENT') {
    return { status: 'git-unavailable' }
  }

  if (failure.code === 'EACCES' || failure.code === 'EPERM') {
    log.error(`git ${command.label} could not be started: ${detail}`)
    return { status: 'failed', reason: 'permission-denied', detail }
  }

  // 出力が上限を超えた。読み切れていないので、答えとして使えない。
  if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    log.error(`git ${command.label} produced more output than ${GIT_MAX_OUTPUT_BYTES} bytes.`)
    return { status: 'failed', reason: 'unreadable-output', detail }
  }

  log.error(`git ${command.label} failed to run: ${detail}`)

  return { status: 'failed', reason: 'unknown', detail }
}
