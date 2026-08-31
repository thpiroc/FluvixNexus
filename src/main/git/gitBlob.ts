/**
 * `git ls-files --stage` / `git ls-tree` の出力の読み取り（Session 3-8-9 / 3-8-21）。
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
 *
 * ## Session 3-8-21 で「段」を読む口が増えた
 *
 * 3-8-9 は衝突している位置（stage 1 / 2 / 3）を**読まない**ことで安全側に
 * 倒していた。3-8-21 の競合の差分はまさにその段を見せるものなので、
 * 段を段として読む関数（`readConflictStages`）と、段の在り方から競合の形を
 * 決める関数（`toGitConflictShape`）をここへ足してある。
 *
 * 置き場所を変えていないのは、**どちらも「git の出力の読み替え」そのもの**
 * だからになる ── 呼ぶ側へ渡るのは `ours` / `theirs` という名前と分類だけで、
 * 段の番号も mode の数字もこのファイルの外へ出ない。
 */

import type { GitConflictShape } from '@shared/git'

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
 * ここは**0 以外を採らない** ── 採ると、衝突している位置に対して
 * 「ours の中身」を黙って選んだことになる。3-8-21 で段を読む口が増えても
 * この関数は動かない（`readConflictStages` が別に読む）── 段が要るのは
 * 競合の差分だけで、3-8-9 の差分と 3-8-9 の破棄は今も stage 0 しか見ない。
 */
const INDEX_RECORD = /^\d{6} ([0-9a-f]{40,64}) 0\t([\s\S]+)$/

/**
 * `git ls-files --stage -z` の、**衝突している位置**の1行（Session 3-8-21）。
 *
 * ```
 * <mode> <object> <stage>\t<path>
 * ```
 *
 * 上の `INDEX_RECORD` が捨てている 1 / 2 / 3 を、こちらが拾う ── 3-8-9 が
 * 「0 以外は採らない」としたのは**差分が衝突を対象にしていなかった**ためで、
 * その判断はそのまま残っている（`readIndexBlobEntry` は今も stage 0 だけを
 * 返す）。3-8-21 は**段を段として読む**別の入口を足しただけになる。
 *
 * mode も持つのは、**submodule（`160000`）を中身として読まない**ため。
 * `ls-tree` の側は `type` が `blob` かで見分けられるが（`TREE_RECORD`）、
 * `ls-files --stage` の出力に type は無い ── 見分けが付くのは mode だけに
 * なる。
 */
const UNMERGED_RECORD = /^(\d{6}) ([0-9a-f]{40,64}) ([123])\t([\s\S]+)$/

/** submodule（gitlink）の mode。中身は blob ではなく commit を指す。 */
const SUBMODULE_MODE = '160000'

/** 競合している index の1段。 */
export interface GitConflictStageEntry {
  readonly object: string
  /** その段が submodule（`160000`）を指しているか。 */
  readonly submodule: boolean
}

/**
 * 競合している位置の3段。無い段は null。
 *
 * 段の番号（1 / 2 / 3）はここで名前に変わる ── これがこのファイルの役目
 * そのもので、呼ぶ側（gitConflictDiff.ts）には数字が1つも渡らない。
 */
export interface GitConflictStages {
  /** stage 1（merge base）。**3-8-21 では中身を読まない**が、形の判定に要る。 */
  readonly base: GitConflictStageEntry | null
  /** stage 2（ours ＝ 取り込み先の側）。 */
  readonly ours: GitConflictStageEntry | null
  /** stage 3（theirs ＝ 取り込む側）。 */
  readonly theirs: GitConflictStageEntry | null
}

/**
 * 求めた位置の段を読む（Session 3-8-21）。
 *
 * `ls-files --stage` は衝突している位置に対して 1 / 2 / 3 の**在る段だけ**を
 * 返す ── どれが返らなかったかが、そのまま競合の形になる
 * （`toGitConflictShape`）。
 *
 * 位置で突き合わせるのは stage 0 のときと同じ理由になる（pathspec が
 * フォルダを指しうる。`selectEntry`）── 1件しか返っていなくてもそのまま
 * 採らない。
 */
export function readConflictStages(stdout: string, relativePath: string): GitConflictStages {
  let base: GitConflictStageEntry | null = null
  let ours: GitConflictStageEntry | null = null
  let theirs: GitConflictStageEntry | null = null

  for (const record of splitRecords(stdout)) {
    const matched = UNMERGED_RECORD.exec(record)

    if (matched === null || matched[4] !== relativePath) {
      continue
    }

    const entry: GitConflictStageEntry = {
      object: matched[2],
      submodule: matched[1] === SUBMODULE_MODE
    }

    switch (matched[3]) {
      case '1':
        base = entry
        break

      case '2':
        ours = entry
        break

      default:
        theirs = entry
        break
    }
  }

  return { base, ours, theirs }
}

/**
 * 段の在り方から、競合の形を決める（Session 3-8-21）。
 *
 * `git status --short` の `XY` と1対1に対応する ── つまり**同じことを
 * 2つの出力から読まない。** 中身を取るのにどのみち `ls-files --stage` を
 * 通るため、形のために git を1回も増やしていない。
 *
 * | 在る段  | 形                | `XY` |
 * | ------- | ----------------- | ---- |
 * | 1・2・3 | `both-modified`   | `UU` |
 * | 2・3    | `both-added`      | `AA` |
 * | 1・2    | `deleted-by-them` | `UD` |
 * | 1・3    | `deleted-by-us`   | `DU` |
 * | 1 だけ  | `both-deleted`    | `DD` |
 * | 2 だけ  | `added-by-us`     | `AU` |
 * | 3 だけ  | `added-by-them`   | `UA` |
 *
 * 段が1つも無ければ null ── その位置はもう競合していない（押してから
 * 読むまでの間に端末で `git add` された、など）。**形を推測して返さない**の
 * が肝で、返してしまうと「中身が両側とも空の競合」として面が開く。
 */
export function toGitConflictShape(stages: GitConflictStages): GitConflictShape | null {
  const { base, ours, theirs } = stages

  if (ours !== null && theirs !== null) {
    return base === null ? 'both-added' : 'both-modified'
  }

  if (ours !== null) {
    return base === null ? 'added-by-us' : 'deleted-by-them'
  }

  if (theirs !== null) {
    return base === null ? 'added-by-them' : 'deleted-by-us'
  }

  return base === null ? null : 'both-deleted'
}

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
