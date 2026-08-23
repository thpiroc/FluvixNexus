/**
 * `.git` の中から届いたパスの扱い（fs にも Electron にも依存しない）。
 *
 * `main/files/watchPaths.ts` と向きは同じ（OS から来たパス → 判断）だが、
 * **判断の基準がまったく違う**ので分けてある。
 *
 *   files/watchPaths.ts … Workspace の中か / 除外フォルダの中か（境界の話）
 *   ここ               … リポジトリの状態が変わったと言えるか（意味の話）
 *
 * ここへ届くパスは `.git` の中を指すので、Renderer へ渡ることは無い
 * （`git:changed` が運ぶのは `workspaceId` だけ ── shared/ipc/events/git.ts）。
 * そのぶん境界の判断は要らず、**残っているのは「拾うか捨てるか」だけ**になる。
 *
 * ## なぜ許可制にするか
 *
 * `.git` の中は、1回の `git commit` でも `git fetch` でも**数百から数万の
 * 書き込みが起きる**場所にあたる（`objects/` の中身がそのまま件数になる）。
 * 「ノイズを列挙して外す」形にすると、知らない名前が増えるたびに漏れ、
 * その1つが `git status` の連射に化ける。
 *
 * そこで**拾う名前を数え上げる**形にしてある。知らない名前は捨てる ──
 * 捨てて困るのは「その変化に気づくのが手動更新まで遅れる」ことだけで、
 * これは Session 3-8-7 までの状態と同じにしかならない。
 */

/** Workspace root の直下にある、リポジトリの入れ物の名前。 */
export const GIT_DIRECTORY_NAME = '.git'

/**
 * 監視から届いたパスの長さの上限。
 *
 * `.git` の中の名前は git が作るもので、桁違いに長いものは来ない。
 * それでも線を引いておくのは、監視から届く値を「git が作ったもの」と
 * 決めてかからないため（clone してきたリポジトリの中身は、この時点では
 * ただのデータでしかない ── §14.8 と同じ立ち位置）。
 */
const GIT_WATCH_PATH_MAX_LENGTH = 1024

/**
 * それ1つで「リポジトリの状態が変わった」と言えるファイル。
 *
 * | 名前                                  | 何が変わったか                              |
 * | ------------------------------------- | ------------------------------------------- |
 * | `HEAD`                                | どのブランチの上に居るか（checkout / switch）|
 * | `index`                               | ステージの中身（add / reset / commit）      |
 * | `packed-refs`                         | ref がまとめられた（fetch / gc の後）       |
 * | `config`                              | 追跡先（`branch.*.remote`）などの設定       |
 * | `MERGE_HEAD` `CHERRY_PICK_HEAD` `REVERT_HEAD` `REBASE_HEAD` | 途中で止まっている操作 |
 * | `BISECT_LOG`                          | bisect の最中                                |
 *
 * **`ORIG_HEAD` / `FETCH_HEAD` / `COMMIT_EDITMSG` は入れていない。**
 * どれも「状態が変わった瞬間に一緒に書かれるが、それ自体は状態ではない」もので、
 * 拾っても同じ変化を二重に数えるだけになる（本体は `HEAD` / `refs/` が持つ）。
 */
const WATCHED_GIT_FILES: ReadonlySet<string> = new Set([
  'HEAD',
  'index',
  'packed-refs',
  'config',
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'REBASE_HEAD',
  'BISECT_LOG'
])

/**
 * 中で何かが起きたら状態が変わったと言えるフォルダ。
 *
 * | 名前                            | 何が変わったか                                  |
 * | ------------------------------- | ----------------------------------------------- |
 * | `refs`                          | ブランチ / タグ / remote-tracking の指す先      |
 * | `rebase-merge` `rebase-apply`   | rebase が途中で止まっている                     |
 * | `sequencer`                     | cherry-pick / revert の続き                      |
 *
 * **`objects` `logs` `hooks` `info` `modules` `lfs` `worktrees` は入れていない。**
 * `objects` は1回の操作で数千件、`logs`（reflog）は `HEAD` / `refs` と必ず
 * 一緒に動くため二重、残りは「状態」ではなく設定・道具の置き場になる。
 */
const WATCHED_GIT_DIRECTORIES: ReadonlySet<string> = new Set([
  'refs',
  'rebase-merge',
  'rebase-apply',
  'sequencer'
])

/**
 * 監視から届いた生の名前を、比較できる相対位置へ落とす（区切りは `/`）。
 *
 * 落とせない形（空・上へ抜ける・長すぎる）は null。`.git` の中を指す値なので
 * Renderer へは出ないが、**そこへ通す前に形を確かめる線はここでも引く**
 * ── 通ってしまうと、この後の判断が「git は変な名前を作らない」という
 * 前提に預けられることになる。
 */
export function toGitWatchPath(rawPath: string): string | null {
  const normalized = rawPath.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')

  if (normalized.length === 0 || normalized.length > GIT_WATCH_PATH_MAX_LENGTH) {
    return null
  }

  const segments = normalized.split('/')

  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null
  }

  return segments.join('/')
}

/**
 * その位置の変化を「リポジトリの状態が変わった」として扱うか。
 *
 * 渡すのは `.git` からの相対位置（`toGitWatchPath` を通したもの）。
 *
 * ## ロックと途中のファイルは、必ず先に捨てる
 *
 * git はどの書き込みでも「`x.lock` を作る → 書く → `x` へ rename する」を通る。
 * `.lock` の側を拾うと、**1回の書き込みが2回の変化として届く**うえ、
 * ロックを取った時点（＝まだ何も変わっていない時点）で読みに行くことになる。
 * 本体（rename 先）は必ず別のイベントとして届くので、捨てて落ちるものは無い。
 *
 * `tmp_` で始まるものも同じ（`objects/` へ書く前の一時ファイル）。
 */
export function isMeaningfulGitChange(relativePath: string): boolean {
  const segments = relativePath.split('/')

  if (segments.some((segment) => segment.endsWith('.lock') || segment.startsWith('tmp_'))) {
    return false
  }

  const [head, ...rest] = segments

  if (head === undefined) {
    return false
  }

  /*
    ファイルは「それ自身」のときだけ。`config/` のような同名のフォルダが
    現れても、その中身までは拾わない（git が作る形ではない）。
  */
  if (rest.length === 0) {
    return WATCHED_GIT_FILES.has(head)
  }

  return WATCHED_GIT_DIRECTORIES.has(head)
}
