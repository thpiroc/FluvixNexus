import type { GitHubRepositoryVisibility } from '@shared/github'

/**
 * Main が組み立てる `gh` の引数の表（Electron / fs / child_process 非依存）。
 *
 * ## 表があることが、境界そのものになっている
 *
 * main/git/gitCommands.ts と同じ形で、「**何を実行するか**」をここへ集める。
 * `runGitHubCli` はここが作った `GitHubCliCommand` しか受け取らないため、
 * 引数を組み立てられる場所はこのファイルだけになる。
 *
 * ## なぜ gh の引数を外から渡させてはいけないか
 *
 * git が `-c core.pager=<任意のコマンド>` で任意のプログラムを起動できるのと
 * 同じ性質を、gh も持っている。
 *
 * ```
 * gh repo create --template <任意のリポジトリ>   … 中身が丸ごと入れ替わる
 * gh alias set x '!<任意のコマンド>' / gh x      … シェル経由で任意の実行
 * gh api <任意のエンドポイント> --method DELETE  … 利用者のアカウントを操作する
 * ```
 *
 * つまり「gh の引数を渡せる API」は、実質「利用者の GitHub アカウントに対して
 * 任意の操作ができる API」になる。危ないものを弾くのではなく、
 * **渡せる欄そのものを作らない**（shared/ipc/contracts/github.ts）。
 *
 * ## 外から来る値は repository 名1つだけ
 *
 * しかもそれは `shared/github/repositoryName.ts` を通った後の形で、
 * **英数字と `-` `_` `.` しか含まない**（先頭の `-` / `.` も弾いてある）──
 * オプションとして読まれうる文字列そのものが作れない。
 *
 * 公開範囲は閉じた集合の値で、ここで**こちらが持っている固定の文字列**
 * （`--private` / `--public`）に写し替える ── 届いた文字列を
 * `--${visibility}` のように組み立てないのは、その形にすると
 * 「知らない値が来たときに何が起きるか」が型の外の話になるため。
 */

/** gh を1回動かすための引数一式。 */
export interface GitHubCliCommand {
  /** ログに出す短い名前（引数そのものは出さない）。 */
  readonly label: string
  readonly args: readonly string[]
}

/**
 * 相手にするホスト。
 *
 * `gh` は複数のホスト（GitHub Enterprise を含む）にログインできる。
 * 明示しないと「どれか1つでもログインしていれば ready」になり、
 * **github.com へは入っていないのに公開を押せる**画面になる。
 *
 * 固定の文字列にしてあるのは、Session 3-8-10 が扱うのが
 * DESIGN.md §3 の「GitHub に公開」＝ github.com だからになる。
 * Enterprise を選べるようにするなら、それは
 * 「どこへ公開するか」を選ぶ画面と一緒に設計する。
 */
const GITHUB_HOST = 'github.com'

/**
 * GitHub アカウントが結び付いているかを尋ねる。
 *
 * ログインしていれば 0、していなければ非0で終わる。**出力は読まない** ──
 * gh の版によって書き先（stdout / stderr）も文言も変わるため、
 * こちらが当てにするのは終了コード1つだけになる（githubFailure.ts）。
 *
 * ネットワークへ出ることがある（token の有効性を確かめる版がある）ため、
 * 待ち時間の上限はネットワーク側の値を使う（runGitHubCli.ts）。
 */
export function showGitHubAuthStatus(): GitHubCliCommand {
  return { label: 'auth status', args: ['auth', 'status', '--hostname', GITHUB_HOST] }
}

/**
 * 空の repository を作る。
 *
 * ## 付けていないもの
 *
 * | 付けない            | なぜ                                                                    |
 * | ------------------- | ----------------------------------------------------------------------- |
 * | `--add-readme`      | **remote に手元が持たない commit が1つ載る** ── 直後の Push が必ず断られる |
 * | `--gitignore` / `--license` | 同上。しかも中身をアプリが選ぶことになる                         |
 * | `--template`        | 任意のリポジトリの中身（hook を含む）がそのまま入る                     |
 * | `--source` / `--push` | gh に**こちらのリポジトリを触らせない**（git を動かすのは Main の表だけ） |
 * | `--remote`          | 同上。remote の設定は `git remote add`（main/git/gitCommands.ts）で行う  |
 * | `--description` / `--homepage` | 欄そのものが無い。後から GitHub 側でいつでも書ける            |
 * | 所有者（`OWNER/name`）| ログインしているアカウントの下に作る。他所を指せる欄は作らない          |
 *
 * `--source` を使えば「作る」と「remote を設定する」を1回にできるが、
 * そうすると **gh が自分で `git` を探して起動する**ことになる ── どの git が
 * 動くかを Main が決められなくなり、§14.1 で引いた線（PATH に任せない）の
 * 外側へ出る。往復は1回増えるが、git を動かすのは常にこちらの表からにする。
 *
 * `--json` は付けない。gh は作った repository の URL を **stdout に1行**で出し、
 * それだけが必要なものになる（githubOutput.ts が読む）。
 */
export function createGitHubRepository(
  name: string,
  visibility: GitHubRepositoryVisibility
): GitHubCliCommand {
  return {
    label: `repo create (${visibility})`,
    args: ['repo', 'create', name, visibilityFlag(visibility)]
  }
}

/**
 * 公開範囲 → gh のフラグ。
 *
 * **届いた文字列から組み立てない**（`--${visibility}`）── 閉じた集合の値を
 * こちらが持っている固定の文字列へ写し替えることで、知らない値が来たときに
 * 何が起きるかが型の中の話に収まる。
 */
function visibilityFlag(visibility: GitHubRepositoryVisibility): string {
  return visibility === 'public' ? '--public' : '--private'
}
