import { createGitEnvironment } from '../git/gitEnvironment'

/**
 * `gh` へ渡す環境変数を組み立てる（Electron / fs / child_process 非依存・テスト対象）。
 *
 * ## git 用のものを土台にする
 *
 * `createGitEnvironment`（main/git/gitEnvironment.ts）の上に足す形にしてある。
 * 土台が持っているものは、そのまま gh にも要るためになる。
 *
 *   `ELECTRON_RUN_AS_NODE` / `NODE_OPTIONS` を落とす
 *       … gh は**自分で git を起動する**（`gh auth setup-git` など）。
 *         そこから先で hook や credential helper の node が動きうる
 *   `GIT_TERMINAL_PROMPT=0`
 *       … 上と同じ理由。gh が呼ぶ git にも、端末の無いところで
 *         入力を待たせない
 *   `LC_ALL=C`
 *       … 失敗の理由を文字列から分類するのは gh でも同じ（githubFailure.ts）
 *
 * 2つの表を別々に持つと、片方だけ直された日に「git は止まるのに
 * gh からは対話が出る」といった穴ができる。
 *
 * ## gh にだけ足すもの
 *
 * | 変数                     | なぜ                                                                 |
 * | ------------------------ | -------------------------------------------------------------------- |
 * | `GH_PROMPT_DISABLED=1`   | 対話を止める。端末が無いので、尋ねられても答えようが無い             |
 * | `GH_NO_UPDATE_NOTIFIER=1`| 更新の確認でネットワークへ出ない・出力を汚さない                     |
 * | `GH_PAGER=`（空）        | pager を挟ませない。挟まると**出力を読み終えられない**               |
 * | `NO_COLOR=1`             | 色の制御文字を混ぜない（分類にも、URL の読み取りにも効く）           |
 * | `GH_TOKEN` / `GITHUB_TOKEN` を消さない … 利用者が意図して置いた資格情報を、アプリの中でだけ無視しない |
 *
 * **`GH_HOST` は固定しない。** 相手は `gh auth status --hostname github.com` で
 * 明示しており（githubCommands.ts）、環境変数まで上書きすると
 * GitHub Enterprise を使っている人の設定をアプリの中でだけ変えることになる。
 *
 * **アプリは GitHub の資格情報を持たない**（設計判断 7）。ここに token を
 * 組み立てて渡す欄が無いのはそのためで、認証は gh 自身が覚えているものだけを使う。
 */

/** gh にだけ足す設定。 */
const ADDED_VARIABLES: Readonly<Record<string, string>> = {
  GH_PROMPT_DISABLED: '1',
  GH_NO_UPDATE_NOTIFIER: '1',
  GH_PAGER: '',
  NO_COLOR: '1'
}

export function createGitHubCliEnvironment(
  parentEnv: Readonly<Record<string, string | undefined>>
): Record<string, string | undefined> {
  const env = createGitEnvironment(parentEnv)

  for (const [name, value] of Object.entries(ADDED_VARIABLES)) {
    env[name] = value
  }

  return env
}
