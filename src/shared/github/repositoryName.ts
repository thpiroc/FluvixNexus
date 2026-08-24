/**
 * GitHub の repository 名として受け付ける形（Session 3-8-10）。
 *
 * ## なぜ shared に置くか
 *
 * shared/git/branchName.ts とまったく同じ理由になる。**判断の正本は Main 側**に
 * あるが（Renderer から届いた文字列をそのまま `gh` へ渡さない）、Renderer は
 * 入力中にその場で「まだ公開できない」を出せる必要がある ── 1文字打つたびに
 * IPC を往復させるわけにはいかない。
 *
 * 2箇所に同じ規則を書くと、片方だけ直された時点で「ボタンは押せるのに Main が
 * 弾く」（あるいはその逆）というずれが生まれる。規則そのものは OS にも DOM にも
 * gh にも依存しない純粋な文字列の判断なので、shared に1つだけ置く。
 *
 * **Renderer が通した ＝ 許可された、ではない。** Main は受け取った名前を必ず
 * この関数へ通してから gh を触る（main/ipc/handlers/github.ts）。
 *
 * ## 引数になる値なので、GitHub 自身より狭くする
 *
 * この名前は `gh repo create <name>` の**独立した1つの位置引数**として
 * コマンドラインに載る。ブランチ名（`--end-of-options` の後ろに置く。
 * shared/git/branchName.ts）と違い、`gh` の側にはその置き方に当たる備えが
 * 版をまたいで確かとは言えない ── そこで**名前の形の方を、記号が
 * 1つも通らないところまで狭めてある。**
 *
 *   通す   … 英数字・`-`・`_`・`.`
 *   通さない … それ以外すべて（空白・`/`・`:`・引用符・制御文字・非 ASCII）
 *
 * この集合には `-` で始まる形も `.` で始まる形も無く（下記）、つまり
 * **オプションとして読まれうる文字列そのものが作れない。**
 *
 * GitHub 自身はもう少し寛容で、日本語の名前も作れる（URL では
 * パーセントエンコードされる）。それを通していないのは、
 * **作れたのに URL では別の文字列になる**名前を、初めて公開する人の
 * 最初の1回に勧める理由が無いため ── 名前は後から GitHub 側で変えられる。
 *
 * ## 「その名前が空いているか」は、ここでは答えない
 *
 * 同じ名前の repository が既にあるかどうかは GitHub にしか分からない
 * （`branch-exists` を git に答えさせているのと同じ分担。
 * shared/git/operation.ts の `github-repository-exists`）。
 */

/**
 * repository 名の長さの上限（文字数）。
 *
 * GitHub 自身の上限が 100 文字で、ここはそれに合わせてある ── 独自に
 * 短くすると、「GitHub では作れるのに Fluvix Nexus からは作れない」名前が
 * 生まれる。数え方は `String.length` で、他の上限と揃えてある。
 */
export const GITHUB_REPOSITORY_NAME_MAX_LENGTH = 100

/**
 * 受け付けない理由。
 *
 * 「使えない」だけでは直しようがないため、何が引っかかったかを区別して返す。
 * 文言は Renderer 側が決める（renderer/src/git/githubPublish.ts）── shared に
 * 文言を置かない分担は files / Commit メッセージ / ブランチ名と同じになる。
 */
export type GitHubRepositoryNameProblem =
  /** 空、または空白だけ。 */
  | 'empty'
  /** 上限（`GITHUB_REPOSITORY_NAME_MAX_LENGTH`）を超える。 */
  | 'too-long'
  /** 使える文字（英数字・`-`・`_`・`.`）以外を含む。 */
  | 'invalid-characters'
  /** 文字は使えるが、並びが規則から外れる（先頭が `-` / `.`、`.` だけ、など）。 */
  | 'invalid-shape'

/** 名前に置ける文字か（英数字・`-`・`_`・`.` だけ）。 */
function isAllowedCharacter(character: string): boolean {
  return /^[A-Za-z0-9._-]$/.test(character)
}

function hasForbiddenCharacter(name: string): boolean {
  for (const character of name) {
    if (!isAllowedCharacter(character)) {
      return true
    }
  }

  return false
}

/**
 * 文字は使えるのに、並びとして通らない形。
 *
 * **先頭の `-` を弾く**のは、この名前が位置引数として渡るため
 * （shared/git/branchName.ts と同じ構え）。先頭の `.` を弾くのは、
 * GitHub 自身が受け付けないのに加えて、`.` / `..` が**フォルダを指す記法**
 * として読まれうる形だから ── 名前としてありえないものを、
 * 引数として渡してから断られる形にしない。
 */
function findShapeProblem(name: string): GitHubRepositoryNameProblem | null {
  if (name.startsWith('-') || name.startsWith('.')) {
    return 'invalid-shape'
  }

  /*
    `.git` で終わる名前は GitHub が断る（clone の URL と衝突するため）。
    形として決まっていることなので、こちらで先に伝える。
  */
  if (name.toLowerCase().endsWith('.git')) {
    return 'invalid-shape'
  }

  return null
}

/**
 * repository 名として受け付けられない理由を返す（問題が無ければ null）。
 *
 * 渡すのは `prepareGitHubRepositoryName` を通した形。**順番に意味がある** ──
 * 空を先に見るのは shared/git/branchName.ts と同じで、続けて長さ・文字・形と、
 * 利用者が直しやすい順に見ていく。
 */
export function findGitHubRepositoryNameProblem(name: string): GitHubRepositoryNameProblem | null {
  if (name.length === 0) {
    return 'empty'
  }

  if (name.length > GITHUB_REPOSITORY_NAME_MAX_LENGTH) {
    return 'too-long'
  }

  if (hasForbiddenCharacter(name)) {
    return 'invalid-characters'
  }

  return findShapeProblem(name)
}

/**
 * 入力された文字列を「gh へ渡す形」に揃える（**受け付けられるかは見ない**）。
 *
 * 落とすのは前後の空白だけになる。**中の空白は落とさない**（ブランチ名と同じ）
 * ── 落とすと `my repo` が黙って `myrepo` として作られることになり、打った名前と
 * 作られた名前が別のものになる。空白を含む名前は `invalid-characters` として
 * 断る方が、何が起きたかが伝わる。
 *
 * この関数は**入力の下ごしらえ**にも使う ── Workspace のフォルダ名を
 * 欄の初期値として入れるとき、そのままでは通らない名前がありうるため
 * （renderer/src/git/githubPublish.ts）。
 */
export function prepareGitHubRepositoryName(name: string): string {
  return name.trim()
}

/**
 * gh へ渡せる形に揃える。受け付けられない値なら null。
 *
 * Main はこちらを使う ── 理由の区別が要るのは入力欄を持つ側だけで、Main に
 * とっては「通せるか、通せないか」しかない（main/ipc/handlers/github.ts）。
 *
 * **文字列でない値は null。** 契約の上では文字列で届くが、境界の外から来た値として
 * 素直に信じない（`normalizeGitBranchName` と同じ構え）。
 */
export function normalizeGitHubRepositoryName(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  const prepared = prepareGitHubRepositoryName(raw)

  return findGitHubRepositoryNameProblem(prepared) === null ? prepared : null
}
