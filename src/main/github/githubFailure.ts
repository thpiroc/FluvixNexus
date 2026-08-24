import type { GitOperationFailureReason } from '@shared/git'

/**
 * `gh` の stderr を「利用者の次の一手」へ翻訳する（Electron / fs 非依存・テスト対象）。
 *
 * main/git/gitFailure.ts と同じ分担・同じ基準になる。
 *
 *   - **生の stderr は Renderer へ渡らない**（設計判断 3）。ここへ来るのは
 *     文字列で、出ていくのは分類だけ。元の文章は Main のログに残る
 *   - **分けるのは「次の一手が変わるもの」だけ。** 文言の種類を増やしても、
 *     UI に同じ案内が2つ並ぶだけになる
 *   - **分からないものは `unknown` に倒す。** 当てにいって外すより、
 *     分からないままの方がよい
 *
 * ## 読む相手の言語は固定してある
 *
 * gh の英文を当てにできるのは、アプリが呼ぶ gh に `LC_ALL=C` を渡している
 * ためになる（githubEnvironment.ts）。この2つは対になっていて、片方だけ
 * 変えると分類が環境ごとに割れる。
 *
 * ## gh に固有の分類は3つだけ
 *
 * 残りは git 側の分類（`network-unavailable` / `unknown`）へ落ちる ──
 * 公開の失敗として画面に出るときは、Push の失敗と同じ1行の場所を使うため、
 * 分類の型も同じもの（`GitOperationFailureReason`）にしてある。
 */

/**
 * 「同じ名前が既にある」の言い回し。
 *
 * GitHub の API が返す文言（422）を gh がそのまま見せる形になる。
 * `already exists` だけを見ているのは、前後（`Name already exists on this
 * account` / `repository already exists`）が版で揺れるためになる。
 */
const REPOSITORY_EXISTS_NEEDLES: readonly string[] = ['already exists']

/**
 * 「ログインしていない / 資格情報が通らない」の言い回し。
 *
 * `gh auth login` を促す文言そのものを拾っているのは、それが
 * **gh 自身が出す次の一手**で、こちらが出す案内と一致するためになる。
 */
const SIGNED_OUT_NEEDLES: readonly string[] = [
  'gh auth login',
  'not logged in',
  'authentication failed',
  'bad credentials',
  'http 401',
  'requires authentication'
]

/**
 * 「相手へ届かなかった」の言い回し。
 *
 * gh は Go のネットワークの失敗をそのまま見せるため、git とは違う文言になる
 * （`dial tcp` / `no such host` / `i/o timeout`）── main/git/gitFailure.ts の
 * 表を使い回さず、こちらで数え上げてあるのはそのためにあたる。
 */
const NETWORK_NEEDLES: readonly string[] = [
  'dial tcp',
  'no such host',
  'connection refused',
  'i/o timeout',
  'tls handshake',
  'certificate',
  'network is unreachable',
  'proxyconnect'
]

/**
 * repository を作れなかった理由を決める。
 *
 * **順番に意味がある。** 「既にある」を先に見るのは、その文言が
 * ネットワークや認証の語を含むことがないのに対し、逆（認証の失敗の説明の中に
 * `already exists` が現れる）は起こりうるため ── いちばん確かなものから採る。
 */
export function classifyGitHubCreateFailure(stderr: string): GitOperationFailureReason {
  const text = stderr.toLowerCase()

  if (REPOSITORY_EXISTS_NEEDLES.some((needle) => text.includes(needle))) {
    return 'github-repository-exists'
  }

  if (SIGNED_OUT_NEEDLES.some((needle) => text.includes(needle))) {
    return 'github-signed-out'
  }

  if (NETWORK_NEEDLES.some((needle) => text.includes(needle))) {
    return 'network-unavailable'
  }

  return 'unknown'
}
