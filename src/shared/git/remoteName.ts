/**
 * remote 名として受け付ける形（Session 3-8-16）。
 *
 * ## なぜ shared に置くか
 *
 * branchName.ts / commitMessage.ts とまったく同じ理由になる。**判断の正本は
 * Main 側**にあるが（Renderer から届いた文字列をそのまま git へ渡さない）、
 * Renderer は入力中にその場で「まだ追加できない」を出せる必要がある ──
 * 1文字打つたびに IPC を往復させるわけにはいかない。
 *
 * 2箇所に同じ規則を書くと、片方だけ直された時点で「ボタンは押せるのに
 * Main が弾く」（あるいはその逆）というずれが生まれる。
 *
 * **Renderer が通した ＝ 許可された、ではない。** Main は受け取った名前を
 * 必ずこの関数へ通してから git を触る（main/ipc/handlers/git.ts）。
 *
 * ## ブランチ名と別のファイルにしてある
 *
 * 規則はほとんど重なるが、**同じ関数を使い回さない。** 理由は2つ。
 *
 *   - 実体が違う。ブランチは `refs/heads/<name>`、remote は
 *     `refs/remotes/<name>/...` と `remote.<name>.url` という**設定のキー**の
 *     両方になる ── だから `.` の扱いだけが本当に違う（下記）
 *   - 片方に規則が増えた日に、もう片方が黙って変わる形にしない
 *     （3-8-14 で削除と rename の失敗の表を書き写して分けたのと同じ判断）
 *
 * ## `.` を含む名前を断る ── ここだけがブランチ名より厳しい
 *
 * remote 名は `remote.<name>.url` という設定のキーの**真ん中**に入る。
 * git の設定は `セクション.サブセクション.キー` で、サブセクションに `.` が
 * 入ると読み書きの境目が動く ── `git remote add a.b <url>` は通るが、
 * その後の `git config remote.a.b.url` がどこを指すのかは、打った人にも
 * 見分けが付かない。**作れるが、後から扱えない名前**を作らせない。
 *
 * ## git より厳しく、実務的な形に絞る
 *
 * ここで通る名前が git に断られることはありうる（既に同じ名前がある）。
 * **それは git に答えさせる** ── 手元のリポジトリの中身を見ないと決まらない
 * ことで、名前の形の話ではない（shared/git/operation.ts の `remote-exists`）。
 */

/**
 * remote 名の長さの上限（文字数）。
 *
 * git 自身に明示的な文字数の上限は無い。ここで頭打ちにしているのは
 * branchName.ts と同じ2つの理由による ── IPC を渡るものに際限を持たせること、
 * 入力欄で扱える量に収めること。
 *
 * 100 文字は `origin` / `upstream` / `fork-of-someone-very-long` のような
 * 実務的な名前がすべて収まる大きさで、ブランチ名（200）より短くしてあるのは
 * **remote 名が `refs/remotes/<name>/<branch>` の前半にしかならない**ため
 * （後半のブランチ名の分だけ余地を残す）。数え方は `String.length` で、
 * 他の上限と揃えてある。
 */
export const GIT_REMOTE_NAME_MAX_LENGTH = 100

/**
 * 受け付けない理由。
 *
 * 「使えない」だけでは直しようがないため、何が引っかかったかを区別して返す。
 * 文言は Renderer 側が決める（renderer/src/git/gitRemotes.ts）── shared に
 * 文言を置かない分担は files / Commit メッセージ / ブランチ名と同じになる。
 */
export type GitRemoteNameProblem =
  /** 空、または空白だけ。 */
  | 'empty'
  /** 上限（`GIT_REMOTE_NAME_MAX_LENGTH`）を超える。 */
  | 'too-long'
  /** 使えない文字を含む（空白・制御文字・git の記号・Windows で作れない字・`.`）。 */
  | 'invalid-characters'
  /** 文字は使えるが、並びが規則から外れる（先頭の `-`・`/` の位置など）。 */
  | 'invalid-shape'
  /** git 自身が別の意味で使う名前。 */
  | 'reserved'

/**
 * 名前の中に置けない記号。
 *
 * `~^:?*[]` は git の `check-ref-format` が禁じているもの、
 * `\` `"` `<` `>` `|` は Windows のファイル名として作れないもの
 * （`refs/remotes/<name>/` はフォルダになる）。
 *
 * **`.` がここに入っているのがブランチ名との違い**にあたる ──
 * 設定のキーの真ん中に入る値だから（このファイルの冒頭）。
 *
 * `/` はここに**入れない** ── `git remote add a/b <url>` は git も通す
 * （実物で確かめてある）ので、位置だけを形として見る（`findShapeProblem`）。
 */
const FORBIDDEN_PUNCTUATION = '~^:?*[]\\"<>|.'

/**
 * git 自身が別の意味で使う名前。
 *
 * `HEAD` と `@` はブランチ名と同じ理由（`refs/remotes/HEAD` が
 * 「今どこか」と読める）。`origin` を予約語にはしない ── それは
 * **ただの慣習の名前**で、使えなくする理由が1つも無い。
 */
const RESERVED_NAMES: readonly string[] = ['HEAD', '@']

/**
 * remote 名に置けない文字か。
 *
 * 空白（0x20）と制御文字（それ未満と DEL）をまとめて弾く ── 空白は
 * `git remote --verbose` の出力を読むときの区切りにも関わり
 * （main/git/gitOutput.ts）、制御文字はログにも UI にも壊れた形で出る。
 *
 * 正規表現ではなく符号位置で見ているのは branchName.ts と同じ形で、
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
 * **先頭の `-` はここで弾く。** `git remote add --end-of-options -x <url>` は
 * git が**受け取ってしまう**（実物で確かめてある ── `-x` という名前の
 * remote が実際に作られ、その後 `git remote remove -x` はオプションとして
 * 読まれて消せなくなる）。つまり `--end-of-options` は「引数として
 * 解釈されない」ことは守るが、**扱えない名前が生まれること**は止めない ──
 * 渡す側の備え（main/git/gitCommands.ts）と両方から掛ける。
 */
function findShapeProblem(name: string): GitRemoteNameProblem | null {
  if (name.startsWith('-')) {
    return 'invalid-shape'
  }

  // `@{` は reflog の記法（`origin@{1}`）にあたる。`..` は `.` を弾いた時点で通らない。
  if (name.includes('@{')) {
    return 'invalid-shape'
  }

  if (name.startsWith('/') || name.endsWith('/') || name.includes('//')) {
    return 'invalid-shape'
  }

  /*
    `/` で区切られた1つ1つが、それぞれ ref の名前として通る必要がある
    （実体はフォルダとファイルの並びになる）。`.lock` 終わりは `.` を
    弾いた時点で通らないため、ここで見るのは空の区画だけになる。
  */
  for (const part of name.split('/')) {
    if (part.length === 0) {
      return 'invalid-shape'
    }
  }

  return null
}

/**
 * remote 名として受け付けられない理由を返す（問題が無ければ null）。
 *
 * 渡すのは `prepareGitRemoteName` を通した形。**順番に意味がある** ──
 * 空を先に見るのは branchName.ts と同じで、続けて長さ・文字・形と、
 * 利用者が直しやすい順に見ていく。
 */
export function findGitRemoteNameProblem(name: string): GitRemoteNameProblem | null {
  if (name.length === 0) {
    return 'empty'
  }

  if (name.length > GIT_REMOTE_NAME_MAX_LENGTH) {
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
 * `my remote` が黙って `myremote` として作られることになり、打った名前と
 * 作られた名前が別のものになる（branchName.ts と同じ判断）。
 */
export function prepareGitRemoteName(name: string): string {
  return name.trim()
}

/**
 * git へ渡せる形に揃える。受け付けられない値なら null。
 *
 * Main はこちらを使う ── 理由の区別が要るのは入力欄を持つ側だけで、Main に
 * とっては「通せるか、通せないか」しかない（main/ipc/handlers/git.ts）。
 *
 * **文字列でない値は null。** 契約の上では文字列で届くが、境界の外から来た値
 * として素直に信じない（`normalizeGitBranchName` と同じ構え）。
 */
export function normalizeGitRemoteName(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  const prepared = prepareGitRemoteName(raw)

  return findGitRemoteNameProblem(prepared) === null ? prepared : null
}
