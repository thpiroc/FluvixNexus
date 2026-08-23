/**
 * Commit メッセージとして受け付ける形（Session 3-8-4）。
 *
 * ## なぜ shared に置くか
 *
 * files ドメインの `fileName.ts` とまったく同じ理由になる。**判断の正本は Main 側**に
 * あるが（Renderer から届いた文字列をそのまま git へ渡さない）、Renderer は
 * 入力中にその場で「まだ Commit できない」を出せる必要がある ── 1文字打つたびに
 * IPC を往復させるわけにはいかない。
 *
 * 2箇所に同じ規則を書くと、片方だけ直された時点で「ボタンは押せるのに Main が弾く」
 * （あるいはその逆）というずれが生まれる。規則そのものは OS にも DOM にも
 * git にも依存しない純粋な文字列の判断なので、shared に1つだけ置いて
 * 両者が同じ答えを見る形にする。
 *
 * **Renderer が通した ＝ 許可された、ではない。** Main は受け取ったメッセージを
 * 必ずこの関数へ通してから git を触る（main/ipc/handlers/git.ts）。
 * ここにあるのは共有された規則であって、検査を Renderer へ委譲したわけではない。
 *
 * ## 「git へ渡す形」に揃えてから判断する
 *
 * `normalizeGitCommitMessage` が返すのは**そのまま git の標準入力へ流す文字列**で、
 * 検査もその値に対して行う。受け取った生の文字列を検査して、渡すときに別の加工を
 * するという形にしない ── 加工が検査より後にあると、「検査を通った文字列」と
 * 「実際に git が読む文字列」が別のものになる（pathspec で正規化した値の方を
 * 使っているのと同じ判断。main/git/gitPathspec.ts）。
 *
 * ## コマンドライン引数にはしない
 *
 * この文字列が `-m <message>` として引数に並ぶことは無い。渡し方は標準入力
 * （`git commit --file=-`）で、理由は main/git/gitCommands.ts の
 * `commitStagedChanges` に書いてある。ここで弾いているのは「引数として危ないから」
 * ではなく、**Commit メッセージとして意味を成さないから**になる。
 */

/**
 * メッセージの長さの上限（文字数）。
 *
 * git 自身には上限が無い。ここで頭打ちにしているのは2つの理由による。
 *
 *   - **IPC と標準入力を渡るものに際限を持たせる。** Renderer は差し替えられうる
 *     前提に立っているため（main/ipc/handlers/git.ts）、Main が受け取る文字列の
 *     大きさを契約の側で決めておく
 *   - **Git パネルの入力欄で書き切れる量に収める。** ここは1〜数行の要約を書く
 *     場所で、それ以上のものは端末の `git commit` かエディタの領分になる
 *
 * 10,000 文字は「長い本文付きの Commit（要約 + 空行 + 数十行の説明）」でも
 * 十分に収まり、かつ貼り付け事故（ファイルの中身をそのまま貼る）は止まる大きさ。
 *
 * 数え方は JavaScript の `String.length`（UTF-16 の符号単位）で、
 * `FILE_NAME_MAX_LENGTH` と揃えてある ── 上限の意味が「おおよその大きさの頭打ち」
 * である以上、数え方の違いで規則を分ける理由が無い。
 */
export const GIT_COMMIT_MESSAGE_MAX_LENGTH = 10_000

/**
 * 受け付けない理由。
 *
 * 「使えない」だけでは直しようがないため、何が引っかかったかを区別して返す。
 * 文言は Renderer 側が決める（renderer/src/git/gitChanges.ts）── shared に
 * 文言を置かない分担は files ドメインと同じになる。
 */
export type GitCommitMessageProblem =
  /** 空、または空白（改行・タブを含む）だけ。 */
  | 'empty'
  /** 上限（GIT_COMMIT_MESSAGE_MAX_LENGTH）を超える。 */
  | 'too-long'
  /** NUL などの制御文字を含む。 */
  | 'invalid-characters'

/**
 * 改行と復帰を LF に揃える。
 *
 * Windows の `<textarea>` は CRLF を返すことがあり、クリップボードから貼られた
 * 文字列には CR だけの行が混じりうる。**揃えるのは git へ渡す前**で、
 * 揃えないまま渡すと commit object の中に CR がそのまま入り、
 * 他のツール（GitHub / 端末の `git log`）で余分な字として見える。
 */
function normalizeLineEndings(message: string): string {
  return message.replace(/\r\n?/g, '\n')
}

/**
 * Commit メッセージとして残してよい制御文字か。
 *
 * 残すのは改行とタブだけになる。**NUL は名指しで止める必要がある** ── git は
 * commit object を NUL 区切りで扱う場面があり、途中で切れたメッセージが
 * 記録されうる。それ以外の C0 と DEL は、Commit メッセージに入れる理由が無く、
 * ログにも UI にも壊れた形で出る（pathspec で C0 を弾いているのと同じ判断）。
 */
function isForbiddenCharacter(codePoint: number): boolean {
  if (codePoint === 0x09 || codePoint === 0x0a) {
    return false
  }

  return codePoint < 0x20 || codePoint === 0x7f
}

function hasForbiddenCharacter(message: string): boolean {
  for (const character of message) {
    const codePoint = character.codePointAt(0)

    if (codePoint !== undefined && isForbiddenCharacter(codePoint)) {
      return true
    }
  }

  return false
}

/**
 * Commit メッセージとして受け付けられない理由を返す（問題が無ければ null）。
 *
 * 渡すのは `normalizeGitCommitMessage` を通した形。順番には意味があり、
 * **空を先に見る** ── 空白だけの長い文字列を「長すぎます」と言っても、
 * 利用者が直すべきところが伝わらない。
 */
export function findGitCommitMessageProblem(message: string): GitCommitMessageProblem | null {
  if (message.length === 0) {
    return 'empty'
  }

  if (message.length > GIT_COMMIT_MESSAGE_MAX_LENGTH) {
    return 'too-long'
  }

  if (hasForbiddenCharacter(message)) {
    return 'invalid-characters'
  }

  return null
}

/**
 * 入力された文字列を「git へ渡す形」に揃える（**受け付けられるかは見ない**）。
 *
 * ## 前後の空白を落とす
 *
 * 空白だけのメッセージを弾く（`empty`）ためだけではない。**残したまま渡しても
 * git が落とす**（`--cleanup=whitespace`）ため、残す方を選ぶと
 * 「入力した文字列」と「記録された文字列」が別のものになる ── 落とすのが
 * こちらなら、画面の文字数と記録される中身が一致する。
 *
 * 途中の空行は落とさない（要約と本文を分ける空行はメッセージの一部にあたる）。
 *
 * 検証と分けてあるのは Renderer のため ── 入力中に**どの問題で押せないのか**を
 * 出すには、null ではなく理由が要る（renderer/src/git/gitChanges.ts）。
 */
export function prepareGitCommitMessage(message: string): string {
  return normalizeLineEndings(message).trim()
}

/**
 * git の標準入力へ流せる形に揃える。受け付けられない値なら null。
 *
 * Main はこちらを使う ── 理由の区別が要るのは入力欄を持つ側だけで、
 * Main にとっては「通せるか、通せないか」しかない
 * （main/ipc/handlers/git.ts）。
 *
 * **文字列でない値は null。** 契約の上では文字列で届くが、境界の外から来た値として
 * 素直に信じない（`normalizeGitPathspec` と同じ構え）。
 */
export function normalizeGitCommitMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  const prepared = prepareGitCommitMessage(raw)

  return findGitCommitMessageProblem(prepared) === null ? prepared : null
}
