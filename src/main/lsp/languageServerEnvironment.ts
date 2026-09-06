/**
 * Language Server へ渡す環境変数を組み立てる
 * （Electron / fs / child_process 非依存・テスト対象）。
 *
 * ## Electron の中で動いていることを、子プロセスへ持ち出さない
 *
 * Language Server は Main Process の子として起動するため、何もしなければ
 * **Electron が自分のために立てた環境変数をそのまま受け継ぐ。**
 *
 * | 変数                   | 引き継ぐと起きること                                                     |
 * | ---------------------- | ------------------------------------------------------------------------ |
 * | `ELECTRON_RUN_AS_NODE` | Node で書かれたサーバ（typescript-language-server / Pyright）の起動経路が変わる |
 * | `NODE_OPTIONS`         | このアプリのために付けた起動オプションが、無関係な node へ効く            |
 *
 * これは main/terminal/terminalEnvironment.ts と同じ判断だが、**同じ関数は使わない。**
 * あちらが落としているのは「利用者が開いたシェルを、素の PowerShell と同じに保つ」
 * ためで、足しているもの（`TERM`）も端末であることの申告になる。
 * Language Server に端末は付いておらず、`TERM` を申告すると
 * **サーバによっては色の付いたログを stderr へ流し始める**（読むのはこちらのログだけで、
 * 誰の役にも立たない）。落とす理由が同じでも、足すものが違うため別に持つ。
 *
 * ## 足すものは無い
 *
 * この層が返すのは「親の環境から2つ落としたもの」だけになる。
 * サーバごとの設定（`PYTHONPATH` など）はここに入れない ── 環境変数は
 * そこから起動されるすべてに効くため、増やすほど利用者の PC と違う場所になる。
 * サーバへの設定は LSP の `initialize` の `initializationOptions` で渡すのが筋で、
 * それは Session 5-2 以降の話にあたる。
 */

/**
 * 引き継がない環境変数。
 *
 * 「このアプリが Electron であることに由来するもの」だけを挙げる。
 * 利用者自身が設定したものを消さないため、判断の基準をここから広げないこと。
 */
const REMOVED_VARIABLES: readonly string[] = ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']

export function createLanguageServerEnvironment(
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

  return env
}
