import { normalizeWorkspaceRelativePath } from '../files/workspacePath'

/**
 * Renderer から届いた相対位置を、git へ渡してよい pathspec に変える
 * （Electron / fs / child_process 非依存・テスト対象・Session 3-8-3）。
 *
 * ## Files の検証を土台にして、その上に git の分だけ足す
 *
 * 「Workspace の中の相対位置か」という問いは Files と同じで、答えるのも同じ関数
 * （`main/files/workspacePath.ts` の `normalizeWorkspaceRelativePath`）にする。
 * 2箇所に書くと、片方だけ直された時点でその経路からだけ外へ出られるようになる ──
 * `executablePath.ts` を Terminal と Git で共有しているのと同じ理由にあたる。
 *
 * そこで済むのは次まで。
 *
 *   - 文字列でない / 桁違いに長い / NUL を含む
 *   - 絶対パス（`/foo` `C:\foo` `\\server\share`）・ドライブ相対（`C:foo`）
 *   - `..` を含む（末尾のドットや空白を落とすと `..` になる形も）
 *   - 区切りは `\` でも `/` でも受け、戻り値は `/` に揃う
 *   - 前後に空白のある名前（`notes.txt `）は**そのまま**通す（判定だけ trim する）
 *
 * ## それでも Files と同じにできない ── pathspec は path ではない
 *
 * git に渡す値は「パス」ではなく **pathspec**（対象を選ぶ式）で、同じ文字列でも
 * 意味が違う。ARCHITECTURE.md §14.10 に整理したとおり、ここが足すのは3つになる。
 *
 * **1. 空文字を受け付けない。** Files では空文字は Workspace root を指す正常な値
 * （ツリーの一番上を読む）だが、pathspec の空は git にとって
 * 「**すべて**」に近い意味を持つ。`git add -- ""` は現在のディレクトリ以下を
 * すべて対象にしうる ── 1件を Stage したつもりが全件になる、というのは
 * この操作で起こしてはいけない取り違えの筆頭にあたる。
 *
 * **2. 先頭の `:` は「魔法」の合図になる。** `:(exclude)`・`:/`・`:!` は path ではなく
 * 選び方の指定で、`--` の後ろに置いても効く。`normalizeWorkspaceRelativePath` は
 * `:` を含む要素を（Windows のドライブ相対と代替データストリームのために）既に弾くが、
 * ここでも**先頭の `:` を名指しで確かめる**。土台の関数が別の理由で持っている性質に
 * 寄りかかると、そちらの理由が無くなった日に静かに穴が空く。
 *
 * **3. `.git` の中は指させない。** git 自身も拒むが、拒み方は版によって変わる。
 * 「git が断ってくれる」を前提にせず、こちらで断る（`gitStatusOutput.ts` が
 * 読み取り側で同じ判断をしているのと対になる）。
 *
 * ## ワイルドカードは弾かない ── 意味を消す方で対処する
 *
 * `*` `?` `[` は pathspec では glob として働く。つまり `a*.txt` という**実在する
 * ファイル名**を渡すと、別のファイルまで巻き込みうる。
 *
 * ここでそれらの文字を弾く手もあるが、そうすると**その名前のファイルを
 * Fluvix Nexus からは永久に Stage できない**（一覧には出るのに、押すと断られる）。
 * 代わりに `--literal-pathspecs` を git 本体の引数として渡し、**glob と魔法の
 * 解釈そのものを止める**（main/git/gitCommands.ts）。値を疑って弾くのではなく、
 * 値が値としてしか読まれない状態を作る ── §14.2 の「渡せる欄を作らない」と
 * 同じ考え方を、渡さざるを得ない値に対して適用した形になる。
 *
 * ## 制御文字は落とす
 *
 * NUL は土台の関数が弾く。残る C0 制御文字（改行・タブなど）は POSIX の
 * ファイル名としては作れてしまうが、Windows では作れず、v1 の対象は Windows になる
 * （DESIGN.md §8）。ログにも UI にも壊れた形で出るため、**受け付けない**方へ倒す。
 * 弾いた結果はどこにも黙って消えない ── 要求は INVALID_REQUEST として返り、
 * グループ操作では操作そのものが失敗として返る（main/git/gitStage.ts）。
 */

/** C0 制御文字（NUL は土台の関数が先に弾く）。 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/**
 * pathspec として通してよい形か確かめ、`/` 区切りに揃えた値を返す。
 *
 * 受け付けられなければ null（呼び出し側が INVALID_REQUEST として扱う）。
 * **空文字は返らない** ── 上記のとおり、pathspec の空は「1件」ではない。
 */
export function normalizeGitPathspec(raw: unknown): string | null {
  const normalized = normalizeWorkspaceRelativePath(raw)

  if (normalized === null || normalized === '') {
    return null
  }

  if (CONTROL_CHARACTERS.test(normalized)) {
    return null
  }

  // pathspec の魔法（`:(exclude)` / `:/` / `:!`）は `--` の後ろでも効く。
  if (normalized.startsWith(':')) {
    return null
  }

  // `.git` の中は変更ファイルではない（読み取り側と同じ判断。gitStatusOutput.ts）。
  if (normalized === '.git' || normalized.startsWith('.git/')) {
    return null
  }

  return normalized
}

/**
 * git 1回あたりに渡す pathspec の数の上限。
 *
 * まとめて Stage するときに、変更が数千件あるリポジトリでは引数がそのまま
 * 数千個になる。Windows のコマンドラインには全体で 32767 文字という上限があり、
 * 超えると**実行そのものが失敗する** ── 「すべて Stage」が大きなリポジトリでだけ
 * 動かない、という形で表に出る。
 */
const MAX_PATHSPECS_PER_COMMAND = 256

/**
 * 引数全体のおおよその長さの上限。
 *
 * 件数だけで区切ると、深い階層の長い path が並んだときに足りない。
 * 実際の上限（32767）に対して十分な余白を取ってある ── 実行ファイルのパスや
 * サブコマンドもその中に入るうえ、余白を削って得られるものが何も無い。
 */
const MAX_PATHSPEC_BYTES_PER_COMMAND = 24_000

/**
 * pathspec の並びを、1回の git 呼び出しに渡せる大きさへ分ける。
 *
 * **分けた結果は途中で失敗しうる。** 3回に分けた2回目で失敗すれば、1回目の分だけが
 * index に載った状態になる ── これを避ける方法（1件ずつ実行する・すべてを1回で渡す）は
 * どちらも別の形で壊れるため、**操作の後に必ず状態を読み直す**方で辻褄を合わせる
 * （main/git/gitStage.ts）。画面には実際の git の状態が出る。
 */
export function chunkGitPathspecs(paths: readonly string[]): readonly (readonly string[])[] {
  const chunks: string[][] = []
  let current: string[] = []
  let length = 0

  for (const path of paths) {
    // 1つで上限を超える path は分けようが無い。そのまま単独の1回として渡す。
    if (
      current.length > 0 &&
      (current.length >= MAX_PATHSPECS_PER_COMMAND ||
        length + path.length + 1 > MAX_PATHSPEC_BYTES_PER_COMMAND)
    ) {
      chunks.push(current)
      current = []
      length = 0
    }

    current.push(path)
    length += path.length + 1
  }

  if (current.length > 0) {
    chunks.push(current)
  }

  return chunks
}
