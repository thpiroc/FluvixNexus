/**
 * remote の URL → 画面に出す**表示用のラベル**（Electron / fs / child_process 非依存・
 * テスト対象・Session 3-8-16）。
 *
 * ## この関数が置かれている場所そのものが、決めごとになっている
 *
 * shared ではなく main に在る。規則としては純粋な文字列の判断で、
 * branchName.ts や remoteUrl.ts と同じ性質を持っているのに、
 * **Renderer と共有しない。**
 *
 * 理由は1つで、**逆はできない、と言い切れるようにするため**にあたる ──
 * Renderer が受け取るのはラベルだけで（shared/git/remote.ts）、
 * そこから URL を組み立て直す材料を持たない。この関数が shared に在ると、
 * Renderer は「URL → ラベル」の対応表を手元に持つことになり、
 * 保証の根拠がその中身の議論に移ってしまう。
 *
 * 同じ理由で、**ラベルは Main へ送り返されない** ── 削除の要求に載るのは
 * 名前だけになる（shared/ipc/contracts/git.ts）。
 *
 * ## 落とすものが、そのまま「渡さないもの」の一覧になる
 *
 *   scheme       … `https://` / `ssh://`。付いていると URL に見える
 *   認証情報     … `user@` / `token@`。**画面にもログにも出さない**
 *   port         … `:2222`。読む人の判断を変えない
 *   末尾の `.git` … どの repository かは変わらない
 *
 * 残るのは `github.com/octocat/Hello-World` のような「どこを指しているか」だけで、
 * これは**リポジトリ root の名前だけを渡している**（`nested` の
 * `repositoryName`）のと同じ形になる。
 *
 * ## 読む相手は、アプリが追加したものだけではない
 *
 * ここが `shared/git/remoteUrl.ts` と役割の違うところにあたる。あちらは
 * **これから追加してよい形**を決める関数で、通すのは3つだけだった。
 * こちらが相手にするのは**既にリポジトリに在るもの**で、そこには
 * 端末から追加された `git://` も、ローカルのパスも、`ext::` も居りうる ──
 * 追加できない形だからといって、一覧から消すことはできない
 * （見えない remote が Push の送り先になっている、という形を作らない）。
 *
 * したがって、
 *
 *   読める形       … ホストと path を出す（scheme を問わない）
 *   ローカルのパス … **場所は出さず**「ローカルのパス」とだけ言う（§9.2）
 *   読めない形     … 「不明な形式」とだけ言う（`ext::…` がここへ落ちる）
 *
 * 空欄にしないのは、**空の行が「読み込みに失敗した行」と見分けが付かない**
 * ため（`GitStashEntry.subject` と同じ判断）。
 */

/**
 * ラベルの長さの上限（文字数）。
 *
 * URL の上限（`GIT_REMOTE_URL_MAX_LENGTH`）が効くのは**アプリから追加する
 * 値**だけで、端末から追加された URL の長さには何の保証も無い ── そのまま
 * ラベルにすると、IPC を渡る文字列の長さがリポジトリ次第で決まることになる
 * （配列の長さに上限を置いているのと同じ理由。shared/git/remote.ts）。
 *
 * 120 は、実在する repository の URL から scheme と `.git` を落とした形が
 * 十分に収まる長さになる。超えた分は末尾を省いて、省いたことが分かる形にする。
 */
export const GIT_REMOTE_LABEL_MAX_LENGTH = 120

/** 場所そのものは出さない（§9.2）。 */
const LOCAL_LABEL = 'ローカルのパス'

/** 読めなかった（`ext::…` のような、URL の形をしていない値）。 */
const UNKNOWN_LABEL = '不明な形式'

/**
 * `[user@]host[:port]` から、ホストだけを取り出す。
 *
 * **認証情報は捨てる**（`@` より前をまるごと落とす）── `token@github.com` の
 * `token` は、URL に書かれた認証情報にあたる。アプリからは追加できない形だが
 * （shared/git/remoteUrl.ts）、端末から追加されたものが一覧に並ぶことはある。
 * 画面にもログにも出さない。
 */
function readHost(authority: string): string {
  const afterUser = authority.slice(authority.indexOf('@') + 1)
  const colon = afterUser.indexOf(':')

  return colon < 0 ? afterUser : afterUser.slice(0, colon)
}

/**
 * path の側を整える。
 *
 * 先頭の `/` と `~/` を落とすのは、ホストと繋いだときに `host//path` や
 * `host/~/path` にならないようにするため。末尾の `.git` と `/` を落とすのは、
 * **どの repository を指すかが変わらない**ためになる。
 */
function readPath(path: string): string {
  let value = path.replace(/^\/+/, '')

  if (value.endsWith('/')) {
    value = value.replace(/\/+$/, '')
  }

  if (value.length > '.git'.length && value.endsWith('.git')) {
    value = value.slice(0, -'.git'.length)
  }

  return value
}

/** `host` と path を1つに繋ぐ（path が空ならホストだけ）。 */
function joinLabel(host: string, path: string): string | null {
  if (host.length === 0) {
    return null
  }

  return path.length === 0 ? host : `${host}/${path}`
}

/**
 * URL の形から、ホストと path を読む。読めなければ null。
 *
 * 見るのは2つの形だけになる。
 *
 *   `<scheme>://[user@]host[:port]/path` … scheme は**何でもよい**（捨てるので）
 *   `[user@]host:path`（scp 形式）      … `@` が在ることを手掛かりにする
 *
 * 2つめで `@` を必須にしてあるのは `findScpProblem` と同じ理由で、
 * **Windows のパスと見分けが付かない**ため（`C:/repos/x` は「ホスト `C`」とも
 * 読める。shared/git/remoteUrl.ts）。
 */
function readRemoteLocation(url: string): string | null {
  const scheme = url.indexOf('://')

  if (scheme >= 0) {
    const rest = url.slice(scheme + '://'.length)
    const slash = rest.indexOf('/')

    if (slash < 0) {
      return joinLabel(readHost(rest), '')
    }

    return joinLabel(readHost(rest.slice(0, slash)), readPath(rest.slice(slash)))
  }

  const colon = url.indexOf(':')

  if (colon < 0) {
    return null
  }

  const authority = url.slice(0, colon)

  if (!authority.includes('@')) {
    return null
  }

  return joinLabel(readHost(authority), readPath(url.slice(colon + 1)))
}

/**
 * ローカルのリポジトリを指していそうか。
 *
 * 「そうだ」と言い切れる形を探すのではなく、**他のどれでもなかったもの**の
 * うち、path として読める形をこちらへ寄せる ── `../bare` も `C:/repos/x` も
 * `/srv/git/x` もここへ来る。
 *
 * `ext::sh -c whoami` を除くのがこの関数の要点になる（`::` を含むか、
 * 空白を含むもの）── あれは path ではなく**コマンド行**で、
 * 「ローカルのパス」と出すと嘘になる。
 */
function looksLikeLocalPath(url: string): boolean {
  if (url.includes('::')) {
    return false
  }

  for (const character of url) {
    const codePoint = character.codePointAt(0)

    if (codePoint !== undefined && codePoint <= 0x20) {
      return false
    }
  }

  return true
}

/**
 * 上限を超えたら末尾を省く。省いたことが分かる形にする。
 *
 * 前を残して後ろを省くのは、**ホストが先頭に居る**ため ── どこを指して
 * いるかのいちばん大きな手掛かりが、切られずに残る。
 */
function truncateLabel(label: string): string {
  if (label.length <= GIT_REMOTE_LABEL_MAX_LENGTH) {
    return label
  }

  return `${label.slice(0, GIT_REMOTE_LABEL_MAX_LENGTH - 1)}…`
}

/**
 * remote の URL から、画面に出すラベルを作る。
 *
 * **null も空文字も返さない。** 読めなかった場合も、そう言う文字列を返す ──
 * 空の行は「読み込みに失敗した行」と見分けが付かない（このファイルの冒頭）。
 */
export function describeGitRemoteUrl(url: string): string {
  const trimmed = url.trim()

  if (trimmed.length === 0) {
    return UNKNOWN_LABEL
  }

  const location = readRemoteLocation(trimmed)

  if (location !== null) {
    return truncateLabel(location)
  }

  return looksLikeLocalPath(trimmed) ? LOCAL_LABEL : UNKNOWN_LABEL
}
