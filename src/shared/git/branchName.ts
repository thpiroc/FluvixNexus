/**
 * ブランチ名として受け付ける形（Session 3-8-6）。
 *
 * ## なぜ shared に置くか
 *
 * commitMessage.ts とまったく同じ理由になる。**判断の正本は Main 側**にあるが
 * （Renderer から届いた文字列をそのまま git へ渡さない）、Renderer は入力中に
 * その場で「まだ作れない」を出せる必要がある ── 1文字打つたびに IPC を
 * 往復させるわけにはいかない。
 *
 * 2箇所に同じ規則を書くと、片方だけ直された時点で「ボタンは押せるのに Main が弾く」
 * （あるいはその逆）というずれが生まれる。規則そのものは OS にも DOM にも
 * git にも依存しない純粋な文字列の判断なので、shared に1つだけ置く。
 *
 * **Renderer が通した ＝ 許可された、ではない。** Main は受け取った名前を必ず
 * この関数へ通してから git を触る（main/ipc/handlers/git.ts）。
 *
 * ## 引数になる値であることが、Commit メッセージとの違い
 *
 * Commit メッセージは標準入力から渡るため、弾いているのは「引数として危ないから」
 * ではなかった（commitMessage.ts）。ブランチ名は**独立した1つの引数として
 * コマンドラインに載る**ので、事情が1つ増える。
 *
 * 載る側の備えは Main が持っている（`--end-of-options` の後ろに、必ず単独の
 * 引数として置く。main/git/gitCommands.ts）。それでもここで**先頭の `-` を
 * 弾いている**のは、pathspec に `--` と `--literal-pathspecs` を両方掛けているのと
 * 同じ形にあたる ── 片方が外れた日に破れる形にしない。
 *
 * ## git より厳しく、Windows で作れる形に絞る
 *
 * ブランチの実体は `.git/refs/heads/<name>` というファイル（あるいは packed-refs の
 * 1行）で、名前はそのままパスになる。したがって git が `check-ref-format` で
 * 禁じているものに加えて、**Windows のファイル名として作れないもの**
 * （`"` `<` `>` `|`）も受け付けない ── 通すと、作れそうに見えて git が
 * 分類しにくい形で失敗する。
 *
 * 逆に、ここで通る名前が git に断られることはありうる（大文字小文字だけが違う
 * 既存のブランチ、`a` と `a/b` の衝突）。**それは git に答えさせる** ── 手元の
 * リポジトリの中身を見ないと決まらないことで、名前の形の話ではない
 * （shared/git/operation.ts の `branch-exists`）。
 */

/**
 * ブランチ名の長さの上限（文字数）。
 *
 * git 自身の上限はパスの長さ（OS 依存）で、明示的な文字数の上限は無い。
 * ここで頭打ちにしているのは commitMessage.ts と同じ2つの理由による ──
 * IPC を渡るものに際限を持たせること、入力欄で扱える量に収めること。
 *
 * 200 文字は `feature/2026-08/very-long-descriptive-name` のような実務的な名前が
 * すべて収まり、かつ Windows のパス長（`.git/refs/heads/` ＋ 名前）にも余裕がある
 * 大きさ。数え方は `String.length` で、他の上限と揃えてある。
 */
export const GIT_BRANCH_NAME_MAX_LENGTH = 200

/**
 * 受け付けない理由。
 *
 * 「使えない」だけでは直しようがないため、何が引っかかったかを区別して返す。
 * 文言は Renderer 側が決める（renderer/src/git/gitBranches.ts）── shared に
 * 文言を置かない分担は files / Commit メッセージと同じになる。
 */
export type GitBranchNameProblem =
  /** 空、または空白だけ。 */
  | 'empty'
  /** 上限（`GIT_BRANCH_NAME_MAX_LENGTH`）を超える。 */
  | 'too-long'
  /** 使えない文字を含む（空白・制御文字・git の記号・Windows で作れない字）。 */
  | 'invalid-characters'
  /** 文字は使えるが、並びが規則から外れる（`..`・`/` の位置・`.lock` 終わりなど）。 */
  | 'invalid-shape'
  /** git 自身が別の意味で使う名前。 */
  | 'reserved'

/**
 * 名前の中に置けない記号。
 *
 * 前半（`~^:?*[]`）は git の `check-ref-format` が禁じているもの、
 * 後半（`\` `"` `<` `>` `|`）は Windows のファイル名として作れないものになる
 * （このファイルの冒頭）。
 *
 * `/` はここに**入れない** ── `feature/x` は正しい形で、位置だけが問題になる
 * （`findShapeProblem` が形として見る）。
 */
const FORBIDDEN_PUNCTUATION = '~^:?*[]\\"<>|'

/**
 * git 自身が別の意味で使う名前。
 *
 * `HEAD` は「今どこに居るか」を指す名前で、`@` はその略記にあたる。
 * ブランチとして作れてしまうと、以降どちらの意味なのかが人にも git にも
 * 曖昧になる（git 自身も断るが、断り方は版で変わる）。
 */
const RESERVED_NAMES: readonly string[] = ['HEAD', '@']

/**
 * ブランチ名に置けない文字か。
 *
 * 空白（0x20）と制御文字（それ未満と DEL）をまとめて弾く ── 空白は git の
 * ref として使えず、制御文字はログにも UI にも壊れた形で出る
 * （`normalizeGitPathspec` が C0 を弾いているのと同じ判断）。
 *
 * 正規表現ではなく符号位置で見ているのは commitMessage.ts と同じ形で、
 * 文字クラスの中に見えない文字を書かずに済む。
 */
function isForbiddenCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0)

  if (codePoint === undefined) {
    return false
  }

  if (codePoint <= 0x20 || codePoint === 0x7f) {
    return true
  }

  return FORBIDDEN_PUNCTUATION.includes(character)
}

function hasForbiddenCharacter(name: string): boolean {
  for (const character of name) {
    if (isForbiddenCharacter(character)) {
      return true
    }
  }

  return false
}

/**
 * 文字は使えるのに、並びとして通らない形。
 *
 * git の `check-ref-format` が見ているものと同じ規則を、ブランチ名
 * （`refs/heads/` の下の部分）に絞って並べてある。
 *
 * **先頭の `-` はここで弾く。** git 自身も断るが、断り方は版で変わる ──
 * それ以前に、引数として渡る値の先頭が `-` にならないことを、渡す側の備え
 * （`--end-of-options`）と**両方から**担保しておきたい（このファイルの冒頭）。
 */
function findShapeProblem(name: string): GitBranchNameProblem | null {
  if (name.startsWith('-')) {
    return 'invalid-shape'
  }

  // `..` は git の revision 記法（範囲）、`@{` は reflog の記法にあたる。
  if (name.includes('..') || name.includes('@{')) {
    return 'invalid-shape'
  }

  if (name.startsWith('/') || name.endsWith('/') || name.includes('//')) {
    return 'invalid-shape'
  }

  if (name.endsWith('.')) {
    return 'invalid-shape'
  }

  /*
    `/` で区切られた1つ1つが、それぞれ ref の名前として通る必要がある
    （実体はフォルダとファイルの並びになる）。
  */
  for (const part of name.split('/')) {
    if (part.startsWith('.') || part.endsWith('.lock')) {
      return 'invalid-shape'
    }
  }

  return null
}

/**
 * ブランチ名として受け付けられない理由を返す（問題が無ければ null）。
 *
 * 渡すのは `prepareGitBranchName` を通した形。**順番に意味がある** ── 空を先に
 * 見るのは commitMessage.ts と同じで、続けて長さ・文字・形と、利用者が
 * 直しやすい順に見ていく。
 */
export function findGitBranchNameProblem(name: string): GitBranchNameProblem | null {
  if (name.length === 0) {
    return 'empty'
  }

  if (name.length > GIT_BRANCH_NAME_MAX_LENGTH) {
    return 'too-long'
  }

  if (hasForbiddenCharacter(name)) {
    return 'invalid-characters'
  }

  if (RESERVED_NAMES.includes(name)) {
    return 'reserved'
  }

  return findShapeProblem(name)
}

/**
 * 入力された文字列を「git へ渡す形」に揃える（**受け付けられるかは見ない**）。
 *
 * 落とすのは前後の空白だけになる。**中の空白は落とさない** ── 落とすと
 * `my branch` が黙って `mybranch` として作られることになり、打った名前と
 * 作られた名前が別のものになる。空白を含む名前は `invalid-characters` として
 * 断る方が、何が起きたかが伝わる。
 *
 * 検証と分けてあるのは Renderer のため ── 入力中に**どの問題で押せないのか**を
 * 出すには、null ではなく理由が要る（renderer/src/git/gitBranches.ts）。
 */
export function prepareGitBranchName(name: string): string {
  return name.trim()
}

/**
 * git へ渡せる形に揃える。受け付けられない値なら null。
 *
 * Main はこちらを使う ── 理由の区別が要るのは入力欄を持つ側だけで、Main に
 * とっては「通せるか、通せないか」しかない（main/ipc/handlers/git.ts）。
 *
 * **文字列でない値は null。** 契約の上では文字列で届くが、境界の外から来た値として
 * 素直に信じない（`normalizeGitPathspec` / `normalizeGitCommitMessage` と同じ構え）。
 */
export function normalizeGitBranchName(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  const prepared = prepareGitBranchName(raw)

  return findGitBranchNameProblem(prepared) === null ? prepared : null
}
