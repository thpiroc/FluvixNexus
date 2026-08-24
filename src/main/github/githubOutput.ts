/**
 * `gh` の出力を読む（Electron / fs 非依存・テスト対象）。
 *
 * main/git/gitOutput.ts と同じ役どころにあたる ── 実行（runGitHubCli.ts）と
 * 読み取りを分けておくと、**gh が実際に出す文字列をどう読むか**だけを
 * 固定して確かめられる。
 *
 * 読むものは1つしかない ── 作られた repository の URL になる。
 */

/**
 * `gh repo create` が出した repository の URL。読めなければ null。
 *
 * ## 版によって出力の形が変わる
 *
 * gh は**出力先が端末かどうか**で書き方を変える。アプリから呼ぶときは
 * 端末ではないので URL だけの1行になるが、版によっては
 * 「✓ Created repository owner/name on GitHub」と字下げされた URL の
 * 2行を出すものもある。
 *
 * どちらでも読めるように、**行を頭から見て最初に現れた `https://` の
 * ひとかたまり**を採る。「URL がどこかにある」以上の前提を置かないのが、
 * 版に振り回されないいちばん確かな読み方にあたる。
 *
 * ## https の URL しか受け付けない
 *
 * ここで返した文字列は、そのまま `git remote add origin <url>` の引数になる
 * （main/git/gitCommands.ts）。だから**形を確かめるのはここの仕事**になる ──
 * `https://` で始まらないものは、たとえ gh が出したものでも返さない
 * （オプションとして読まれうる文字列を、引数の位置へ通さない）。
 *
 * `git@github.com:owner/name.git` のような ssh の形を採らないのは、
 * gh が公開後に出すのが常に web の URL だからになる。GitHub は
 * `https://github.com/owner/name` をそのまま clone / push の宛先として
 * 受け付けるため、これで初回 Push まで通る ── しかも credential helper
 * （Windows の既定）が扱うのは https 側で、鍵の設定を要らずに済ませられる。
 */
export function readCreatedRepositoryUrl(stdout: string): string | null {
  for (const line of stdout.split('\n')) {
    for (const token of line.trim().split(/\s+/)) {
      if (isHttpsUrl(token)) {
        return token
      }
    }
  }

  return null
}

/**
 * `https://` で始まる、空白を含まない1つのかたまりか。
 *
 * 末尾の記号（`.` や `,`）まで含めて返さないよう、**許す文字を数え上げてある** ──
 * URL に現れうる字だけを通し、それ以外が混ざったものは URL として採らない。
 */
function isHttpsUrl(value: string): boolean {
  return /^https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(value)
}
