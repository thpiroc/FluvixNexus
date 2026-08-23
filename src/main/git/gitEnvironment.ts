/**
 * `git` へ渡す環境変数を組み立てる（Electron / fs / child_process 非依存・テスト対象）。
 *
 * Terminal の同じ役（main/terminal/terminalEnvironment.ts）とは目的が違う。
 * あちらは「素の PowerShell を開いたときと同じに見えること」を目指すが、
 * こちらは**アプリが黙って呼ぶプロセス**なので、逆に「利用者を待たせない」
 * ことを最優先にする。
 *
 * ## 落とすもの
 *
 * | 変数                   | 引き継ぐと起きること                                                    |
 * | ---------------------- | ----------------------------------------------------------------------- |
 * | `ELECTRON_RUN_AS_NODE` | git のフックや credential helper から起動される Electron アプリが壊れる |
 * | `NODE_OPTIONS`         | このアプリのための起動オプションが、無関係な node（フック）へ効く       |
 *
 * Terminal と同じ2つを落とす。git は自分では node を起動しないが、**フックと
 * credential helper は利用者が用意した任意のプログラム**で、その中に node が
 * 居ることは珍しくない。
 *
 * ## 足すもの
 *
 * ### `GIT_TERMINAL_PROMPT=0` ── 見えない場所で入力を待たせない
 *
 * git は認証情報が要るとき端末から尋ねようとする。アプリから呼ぶ git には
 * 端末が付いていないため、そのまま待ち続ける（＝Git パネルが固まる）。
 * `0` にすると尋ねる代わりに即座に失敗し、**待つのではなく理由が返る。**
 *
 * Session 3-8-1 の `rev-parse` に認証は要らないが、ここで先に決めておく。
 * Push / Pull（Session 3-8-4）が入った時点でこの設定が無いと、
 * 認証未設定の PC でパネルが固まる。設計判断 7（credential.helper 未設定時は
 * 強行せず案内する）は、この「固まらない」が前提になる。
 *
 * ### `GIT_OPTIONAL_LOCKS=0` ── 読むだけの問い合わせでロックを取らない
 *
 * `status` のような読み取り系のコマンドも、既定ではインデックスを更新するために
 * `.git/index.lock` を取ろうとする。Fluvix Nexus は**利用者自身が Terminal パネルで
 * git を叩いている最中にも**問い合わせるため、そのままだと利用者の
 * `git commit` を横から邪魔しうる（相手が `index.lock` を取れずに失敗する）。
 *
 * `0` にすると、ロックが要る最適化を諦めて答えだけを返す。
 * **アプリの問い合わせが、利用者の操作を失敗させない**ための設定になる。
 *
 * Session 3-8-8 で、この設定にはもう1つ意味が付いた ── `.git/index` を
 * 見張るようになったため（main/git/gitWatcher.ts）、読み取りが index を
 * 書き戻すと**アプリが自分の読み取りで自分を呼び戻し続ける**。
 * 引数側の `--no-optional-locks`（gitCommands.ts）と二重に掛けてあるのは
 * 3-8-2 からの形のままだが、外したときに起きることが増えている。
 *
 * ### `LC_ALL=C` ── 読む相手の言語を固定する
 *
 * git の失敗の理由は stderr の文章にしか無く、それを分類するのは Main の仕事に
 * なっている（main/git/gitFailure.ts）。文章は git の表示言語で変わるため、
 * 分類する側と分類される側の言語が揃っていないと、同じ失敗が環境によって
 * 「分かる」「分からない」に割れる。
 *
 * 固定するのは**アプリが呼ぶ git だけ**で、Terminal パネルの中の git には
 * 一切影響しない（利用者が読むものは利用者の言語のまま）。
 */

/**
 * 引き継がない環境変数。
 *
 * 「このアプリが Electron であることに由来するもの」だけを挙げる。
 * 利用者自身が設定したもの（`GIT_*` の各種設定を含む）は消さない ──
 * 消すと、利用者が意図して変えた振る舞いがアプリの中でだけ違うことになる。
 */
const REMOVED_VARIABLES: readonly string[] = ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']

/** アプリが呼ぶ git にだけ足す設定。 */
const ADDED_VARIABLES: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  LC_ALL: 'C'
}

export function createGitEnvironment(
  parentEnv: Readonly<Record<string, string | undefined>>
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...parentEnv }

  for (const name of REMOVED_VARIABLES) {
    delete env[name]
    /*
      Windows の環境変数は大文字小文字を区別しないが、`process.env` を
      展開したただのオブジェクトはそうではない。実際に届く綴りが
      定義と違うことがあるため、綴り違いも消す（terminalEnvironment.ts と同じ）。
    */
    delete env[name.toLowerCase()]
  }

  for (const [name, value] of Object.entries(ADDED_VARIABLES)) {
    env[name] = value
  }

  return env
}
