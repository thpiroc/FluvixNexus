/**
 * `git ls-files --stage` / `git ls-tree` の出力の読み取り（Session 3-8-9）。
 *
 * gitStatusOutput.ts / gitOutput.ts と同じ立ち位置で、**git の記法をここに閉じる。**
 * 呼ぶ側（gitDiff.ts）が受け取るのは object 名1つだけで、モードも stage 番号も
 * レコードの区切り方も渡らない ── Renderer どころか、Main の中でも
 * この2つの出力の形を知っているのはこのファイルだけになる。
 *
 * fs にも child_process にも触れない（テストできる形にしておく）。
 *
 * ## なぜ object 名を経由するのか
 *
 * 位置（Workspace root からの相対位置）を `HEAD:<path>` のような**1つの引数**に
 * 組み立てないため（main/git/gitCommands.ts）。位置は最後まで pathspec のまま渡し、
 * 中身を取りに行く2段目の引数には **git 自身が答えた object 名**だけが載る。
 *
 * その object 名は、この層を通ってから使われる ── `isGitObjectName` を通らない
 * 文字列が引数になることは無い。git が壊れた出力を返す状況を想定しているのでは
 * なく、「**外から来た値が引数に入る経路が形の上で存在しない**」と言い切れる
 * ようにするための1枚になる（3-8-3 の pathspec と同じ二重の備え）。
 */

/**
 * object 名（SHA-1 は 40 桁、SHA-256 のリポジトリでは 64 桁）。
 *
 * 桁数を2つに決め打たず幅で見ているのは、git の hash 方式が増えたときに
 * ここだけが理由で差分が出せなくなるのを避けるため。**16進以外を通さない**
 * ことがこの検査の本体で、桁数はその補助にあたる。
 */
const OBJECT_NAME = /^[0-9a-f]{40,64}$/

export function isGitObjectName(value: string): boolean {
  return OBJECT_NAME.test(value)
}

/** 1件の blob。位置は git が返したものをそのまま持つ（突き合わせに使う）。 */
export interface GitBlobEntry {
  readonly object: string
  readonly relativePath: string
}

/**
 * `-z` の出力を1件ずつに切る。
 *
 * 区切りが NUL なので、**位置に改行が入っていても1件を取り違えない**
 * （`git status` を `-z` で読んでいるのと同じ理由。gitStatusOutput.ts）。
 * 末尾の空の要素は落とす。
 */
function splitRecords(stdout: string): readonly string[] {
  return stdout.split('\0').filter((record) => record.length > 0)
}

/**
 * `git ls-files --stage -z` の1行。
 *
 * ```
 * <mode> <object> <stage>\t<path>
 * ```
 *
 * `stage` は 0（通常）か 1 / 2 / 3（衝突中の base / ours / theirs）になる。
 * 差分も破棄も衝突を対象にしていないため、**0 以外は採らない** ── 採ると、
 * 衝突している位置に対して「ours の中身」を黙って選んだことになる。
 */
const INDEX_RECORD = /^\d{6} ([0-9a-f]{40,64}) 0\t([\s\S]+)$/

/**
 * `git ls-tree -r -z HEAD` の1行。
 *
 * ```
 * <mode> <type> <object>\t<path>
 * ```
 *
 * `type` を `blob` に限るのは、**submodule（`commit`）を中身として読まない**ため。
 * submodule の object は tree でも blob でもなく、`cat-file blob` は失敗する ──
 * 失敗として出すより「差分の対象ではない」として扱う方が近い。
 */
const TREE_RECORD = /^\d{6} blob ([0-9a-f]{40,64})\t([\s\S]+)$/

function readEntries(stdout: string, pattern: RegExp): readonly GitBlobEntry[] {
  const entries: GitBlobEntry[] = []

  for (const record of splitRecords(stdout)) {
    const matched = pattern.exec(record)

    if (matched === null) {
      continue
    }

    entries.push({ object: matched[1], relativePath: matched[2] })
  }

  return entries
}

/**
 * 求めた位置の1件を選ぶ。
 *
 * **位置で突き合わせる。** 1件しか返っていなくてもそれをそのまま採らないのは、
 * pathspec が（`--literal-pathspecs` を通してなお）フォルダを指しうるため ──
 * `a/b` という位置が実在せず `a/b/c.txt` だけが返る、という組み合わせで
 * 「別のファイルの中身を、そのファイルの差分として」出すことになる。
 */
function selectEntry(entries: readonly GitBlobEntry[], relativePath: string): GitBlobEntry | null {
  return entries.find((entry) => entry.relativePath === relativePath) ?? null
}

/** index に載っている blob（stage 0）。無ければ null。 */
export function readIndexBlobEntry(stdout: string, relativePath: string): GitBlobEntry | null {
  return selectEntry(readEntries(stdout, INDEX_RECORD), relativePath)
}

/** HEAD の tree に載っている blob。無ければ null。 */
export function readHeadBlobEntry(stdout: string, relativePath: string): GitBlobEntry | null {
  return selectEntry(readEntries(stdout, TREE_RECORD), relativePath)
}

/**
 * `git cat-file -s` の出力（バイト数）。
 *
 * 読めない・負・桁があふれる、はすべて null にする ── 「大きさが分からない」を
 * 0 に倒すと、上限の検査をすり抜けたものが中身の読み取りへ進む。
 */
export function readBlobByteLength(stdout: string): number | null {
  const value = Number.parseInt(stdout.trim(), 10)

  return Number.isSafeInteger(value) && value >= 0 ? value : null
}
