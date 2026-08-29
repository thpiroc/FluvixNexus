/**
 * remote の URL として受け付ける形（Session 3-8-16）。
 *
 * ## このファイルは、Git 機能でいちばん危ない値を相手にしている
 *
 * 3-8-1 から引いている線は「**git の引数を渡せる欄を作らない**」だった
 * （shared/ipc/contracts/git.ts）── `git` は `-c core.pager=...` や
 * `-c alias.x=!sh` で任意のプログラムを起動できるため。
 *
 * remote の URL は、その線の**唯一の例外**にあたる ── 欄を作らなければ
 * remote を追加できないのに、URL そのものが git に任意のプログラムを
 * 起動させうる値になっている。
 *
 * ```
 * git remote add evil "ext::sh -c whoami"
 * ```
 *
 * これは今の git（2.54 で確かめた）が**そのまま受け取る。** 追加した時点では
 * 何も起きないが、以降の fetch / push でその文字列がシェルとして走る ──
 * つまり「URL を受け取る欄」は、素通しにすれば
 * **時間差で発火する任意コマンド実行の欄**になる。
 *
 * ## だから、弾くのではなく通す形を決め打ちにする
 *
 * pathspec で「危ないものを弾くのではなく、値が値でしかない状態を作る」と
 * したのと同じ構えを、ここでは**許可する形の列挙**として置く。
 * 知らない形は、危なそうに見えるかどうかに関わらず通さない。
 *
 *   通す   … `https://…` / `ssh://…` / `user@host:path`（scp 形式）
 *   通さない … それ以外の**すべて**
 *
 * 通さないものには、危なくないものも含まれる（`git://`・`http://`・
 * ローカルのパス）。それでも通さないのは、**「知らない形は通さない」を
 * 判断の余地なく言える**ことの方が、対応する形が増えることより効くため ──
 * 例外を1つ作った時点で、次の例外を断る根拠が「なんとなく危なそう」になる。
 *
 * 具体的にどれを断るかの一覧は docs/ARCHITECTURE.md §14.24 に置いてある。
 *
 * ## 認証情報を URL に載せさせない
 *
 * `https://<token>@github.com/o/r.git` は実在する使い方だが、これも断る ──
 * 通すと、**アプリが利用者の token を `.git/config` に平文で書く**ことに
 * なる。設計判断 7（アプリは認証情報を持たない）は「アプリのどこにも
 * 溜めない」であって、「アプリが別の場所へ書くのはよい」ではない。
 * 認証は credential helper と gh に任せる（main/git/gitCommands.ts）。
 *
 * `ssh://git@host/...` の `git@` は**利用者名**であって認証情報ではないため
 * 通す（`:` を含む形 ── つまりパスワード付き ── だけを断る）。
 *
 * ## なぜ shared に置くか
 *
 * branchName.ts と同じ理由になる。**判断の正本は Main 側**にあるが、
 * Renderer は入力中にその場で「まだ追加できない」を出せる必要がある。
 * **Renderer が通した ＝ 許可された、ではない** ── Main は受け取った URL を
 * 必ずこの関数へ通してから git を触る（main/ipc/handlers/git.ts）。
 *
 * ## ここで通った URL が、Renderer へ戻ることは無い
 *
 * 一覧に載るのは URL ではなく**表示用のラベル**になる（shared/git/remote.ts）。
 * つまり URL は「Renderer → Main へ1回だけ流れる値」で、往復はしない。
 */

/**
 * URL の長さの上限（文字数）。
 *
 * git 自身に上限は無い。頭打ちにしているのは他の値と同じ2つの理由による ──
 * IPC を渡るものに際限を持たせること、入力欄で扱える量に収めること。
 *
 * 2048 は、ブラウザの URL の実務的な上限として広く使われている数にあたる。
 * 実在する repository の URL がこれを超えることは無い。
 */
export const GIT_REMOTE_URL_MAX_LENGTH = 2048

/**
 * 受け付けない理由。
 *
 * 文言は Renderer 側が決める（renderer/src/git/gitRemotes.ts）。
 * **`unsupported-scheme` と `credentials` を分けている**のは、
 * 次の一手がまったく違うため ── 前者は「別の形で打ち直す」、後者は
 * 「認証の部分を消す」になる。
 */
export type GitRemoteUrlProblem =
  /** 空、または空白だけ。 */
  | 'empty'
  /** 上限（`GIT_REMOTE_URL_MAX_LENGTH`）を超える。 */
  | 'too-long'
  /** 空白や制御文字を含む。 */
  | 'invalid-characters'
  /** 通す3つの形のどれでもない（`git://`・`file://`・`ext::`・ローカルのパスなど）。 */
  | 'unsupported-scheme'
  /** 形は合っているが、URL の中に認証情報が入っている。 */
  | 'credentials'
  /** 形は合っているが、ホストか path が欠けている。 */
  | 'invalid-shape'

/** ホスト名として通す形（`example.com` / `localhost` / `192.168.0.1`）。 */
const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/

/** 利用者名として通す形（`git` / `my-user` ── `:` を含まないので password になりえない）。 */
const USER = /^[A-Za-z0-9._-]+$/

/** port として通す形。 */
const PORT = /^[0-9]{1,5}$/

/**
 * URL に置けない文字か。
 *
 * 空白（0x20）と制御文字（それ未満と DEL）をまとめて弾く ── URL は
 * **独立した1つの引数**として git へ渡る（main/git/gitCommands.ts）ので
 * 空白があっても壊れはしないが、`ext::sh -c whoami` のような
 * 「コマンド行に見える値」がここで先に落ちる。制御文字はログにも UI にも
 * 壊れた形で出る（branchName.ts と同じ判断）。
 */
function hasForbiddenCharacter(url: string): boolean {
  for (const character of url) {
    const codePoint = character.codePointAt(0)

    if (codePoint !== undefined && (codePoint <= 0x20 || codePoint === 0x7f)) {
      return true
    }
  }

  return false
}

/**
 * `host` / `host:port` / `user@host` / `user@host:port` を見る。
 *
 * 返すのは問題だけ（無ければ null）。`allowUser` が false なのは https の側で、
 * そこでは**利用者名も断る** ── `https://token@host/...` の `token` は
 * 利用者名の欄に入った認証情報にあたるため（このファイルの冒頭）。
 */
function findAuthorityProblem(authority: string, allowUser: boolean): GitRemoteUrlProblem | null {
  const at = authority.indexOf('@')

  if (at >= 0) {
    if (!allowUser) {
      return 'credentials'
    }

    const user = authority.slice(0, at)

    /*
      `user:password@host` は `USER` に当たらない（`:` を含む）。
      つまりパスワード付きは必ずここで `credentials` として落ちる。
    */
    if (!USER.test(user)) {
      return user.includes(':') ? 'credentials' : 'invalid-shape'
    }
  }

  const hostAndPort = authority.slice(at + 1)
  const colon = hostAndPort.indexOf(':')
  const host = colon < 0 ? hostAndPort : hostAndPort.slice(0, colon)
  const port = colon < 0 ? null : hostAndPort.slice(colon + 1)

  if (!HOST.test(host)) {
    return 'invalid-shape'
  }

  if (port !== null && !PORT.test(port)) {
    return 'invalid-shape'
  }

  return null
}

/**
 * `https://` / `ssh://` の形を見る。
 *
 * path を**必須**にしてあるのは、`https://github.com` だけでは repository を
 * 指していないため ── git は受け取るが、その remote へは何も送れない。
 * 押した後に必ず失敗する値を、押す前に断る。
 */
function findSchemeProblem(rest: string, allowUser: boolean): GitRemoteUrlProblem | null {
  const slash = rest.indexOf('/')

  if (slash < 0) {
    return 'invalid-shape'
  }

  const authorityProblem = findAuthorityProblem(rest.slice(0, slash), allowUser)

  if (authorityProblem !== null) {
    return authorityProblem
  }

  // `https://host/` のように path が空なら、指している先が無い。
  return rest.slice(slash + 1).length === 0 ? 'invalid-shape' : null
}

/**
 * scp 形式（`user@host:path`）の形を見る。
 *
 * ## `user@` を必須にしてある
 *
 * git 自身は `host:path`（利用者名なし）も受け取るが、こちらは通さない ──
 * **Windows のパスと見分けが付かない**ため（`C:/repos/x` は
 * 「ホスト `C` の path `/repos/x`」とも読める）。実務で使われるのは
 * `git@github.com:owner/repo.git` の形で、そこに `user@` は必ず居る。
 *
 * この1つの条件が、ローカルのパスと `ext::sh -c ...` の両方を
 * まとめて落としている。
 */
function findScpProblem(url: string): GitRemoteUrlProblem | null {
  const colon = url.indexOf(':')

  if (colon < 0) {
    return 'unsupported-scheme'
  }

  const authority = url.slice(0, colon)

  if (!authority.includes('@')) {
    return 'unsupported-scheme'
  }

  const authorityProblem = findAuthorityProblem(authority, true)

  if (authorityProblem !== null) {
    return authorityProblem
  }

  return url.slice(colon + 1).length === 0 ? 'invalid-shape' : null
}

/**
 * URL として受け付けられない理由を返す（問題が無ければ null）。
 *
 * 渡すのは `prepareGitRemoteUrl` を通した形。**順番に意味がある** ──
 * 空・長さ・文字を先に見るのは他の値と同じで、形の判定はその後になる。
 */
export function findGitRemoteUrlProblem(url: string): GitRemoteUrlProblem | null {
  if (url.length === 0) {
    return 'empty'
  }

  if (url.length > GIT_REMOTE_URL_MAX_LENGTH) {
    return 'too-long'
  }

  if (hasForbiddenCharacter(url)) {
    return 'invalid-characters'
  }

  /*
    先頭の `-` は、`--end-of-options` を置いてあってもここで弾く
    （pathspec に `--` と `--literal-pathspecs` を両方掛けているのと同じ構え。
    main/git/gitCommands.ts）。
  */
  if (url.startsWith('-')) {
    return 'unsupported-scheme'
  }

  const lower = url.toLowerCase()

  if (lower.startsWith('https://')) {
    return findSchemeProblem(url.slice('https://'.length), false)
  }

  if (lower.startsWith('ssh://')) {
    return findSchemeProblem(url.slice('ssh://'.length), true)
  }

  /*
    ここへ来た時点で `https` でも `ssh` でもない。**scheme らしきものが
    付いていれば、その時点で断る** ── `ext::`・`git://`・`file://`・
    `http://` を、それぞれ個別に知っている必要が無い形にしてある。
  */
  if (lower.includes('://') || lower.includes('::')) {
    return 'unsupported-scheme'
  }

  return findScpProblem(url)
}

/**
 * 入力された文字列を「git へ渡す形」に揃える（**受け付けられるかは見ない**）。
 *
 * 落とすのは前後の空白だけ ── 貼り付けた URL の末尾に改行が付いてくるのは
 * 普通に起こる。中は1文字も変えない（`.git` を足すことも、`http` を
 * `https` に直すこともしない）── 打った URL と登録される URL が
 * 別のものになる形を作らない。
 */
export function prepareGitRemoteUrl(url: string): string {
  return url.trim()
}

/**
 * git へ渡せる形に揃える。受け付けられない値なら null。
 *
 * Main はこちらを使う ── 理由の区別が要るのは入力欄を持つ側だけで、Main に
 * とっては「通せるか、通せないか」しかない（main/ipc/handlers/git.ts）。
 */
export function normalizeGitRemoteUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  const prepared = prepareGitRemoteUrl(raw)

  return findGitRemoteUrlProblem(prepared) === null ? prepared : null
}
