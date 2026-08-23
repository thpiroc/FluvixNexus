/**
 * シェルへ渡す環境変数を組み立てる（Electron / fs / node-pty 非依存・テスト対象）。
 *
 * ## Electron の中で動いていることを、子プロセスへ持ち出さない
 *
 * ターミナルは Main Process の子として起動するため、何もしなければ
 * **Electron が自分のために立てた環境変数をそのまま受け継ぐ。**
 * その中には、素の Node.js や別の Electron アプリの振る舞いを変えてしまうものがある。
 *
 * | 変数                   | 引き継ぐと起きること                                              |
 * | ---------------------- | ----------------------------------------------------------------- |
 * | `ELECTRON_RUN_AS_NODE` | ターミナルから起動した Electron アプリが**素の Node として立ち上がる**。`require('electron')` が文字列を返し、アプリ側のバグに見える形で落ちる |
 * | `NODE_OPTIONS`         | このアプリのために付けた起動オプションが、無関係な node へ効く    |
 *
 * とくに1つめは、**このアプリで Electron アプリを開発する利用者が最初に踏む**
 * 類のもので、しかも原因がターミナル側にあると気づきにくい
 * （落ちるのは相手のアプリなので、そちらを疑うことになる）。
 * 「開いたターミナルは、素の PowerShell を開いたときと同じように振る舞う」を
 * 満たすために、ここで落とす。
 *
 * ## 足すのは端末であることの申告だけ
 *
 * `TERM` は「相手が端末かどうか」「色を出してよいか」の判断に使われる。
 * PowerShell 自身は見ないが、その中から起動される多くの CLI（git・npm・
 * Claude Code）が見る。**アプリ固有の値は1つも入れない** ── 環境変数は
 * そこから起動されるすべてに効くため、増やすほど「素のシェルと違う場所」になる。
 */

/**
 * 引き継がない環境変数。
 *
 * 「このアプリが Electron であることに由来するもの」だけを挙げる。
 * 利用者自身が設定したものを消さないため、判断の基準をここから広げないこと。
 */
const REMOVED_VARIABLES: readonly string[] = ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']

/** シェルに申告する端末の種類。xterm.js が解釈できる範囲に合わせる。 */
const TERM_VALUE = 'xterm-256color'

export function createTerminalEnvironment(
  parentEnv: Readonly<Record<string, string | undefined>>
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...parentEnv }

  for (const name of REMOVED_VARIABLES) {
    delete env[name]
    /*
      Windows の環境変数は大文字小文字を区別しないが、`process.env` を
      展開したただのオブジェクトはそうではない。実際に届く綴りが
      定義と違うことがあるため、綴り違いも消す。
    */
    delete env[name.toLowerCase()]
  }

  env.TERM = TERM_VALUE

  return env
}
