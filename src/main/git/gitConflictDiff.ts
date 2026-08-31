import type { GitConflictFileDiff } from '@shared/git'
import {
  readConflictStages,
  toGitConflictShape,
  type GitConflictStageEntry,
  type GitConflictStages
} from './gitBlob'
import { showIndexBlob } from './gitCommands'
import {
  EMPTY_GIT_DIFF_SIDE,
  readGitBlobSide,
  toGitRunFailureReason,
  type GitDiffSideOutcome
} from './gitDiffSide'
import { normalizeGitPathspec } from './gitPathspec'
import { runGitExclusively } from './gitQueue'
import { readGitRepositoryOutcome } from './gitRepository'
import { runGit } from './runGit'

/**
 * 競合している1件を「ours の中身」と「theirs の中身」として組み立てる（Session 3-8-21）。
 *
 * ## 3-8-9 が「当てはまらない」と書いた形に、答えを出す
 *
 * `shared/git/diff.ts` は競合を対象外にした理由を、**「前」と「後」が2組
 * （ours / theirs）あり、2つの中身を並べる形そのものが当てはまらない**と
 * 書いていた。3-8-21 の答えは「器を増やす」ではなく**「組を1つに決める」**に
 * なる ── 並べるのは stage 2 と stage 3 の2つで、stage 1（merge base）は
 * 読まない。
 *
 * base を足すと面も部品も別に要る（Monaco の Diff Editor が受け取るのは
 * 2つの中身）。3-8-9 から在る2ペインの器がそのまま使える範囲に留めてあり、
 * 3-way は後続のセッションへ回してある。
 *
 * ## 左右に時間の向きが無い
 *
 * ここが `readGitFileDiff`（3-8-9）といちばん違うところになる。あちらの
 * 左右は「前」と「後」で、どちらが先かが決まっていた ── こちらの2つは
 * **同じ瞬間の、2つの枝の中身**にあたる。したがって：
 *
 *   - `group` を受け取らない（比べる相手が1組しか無い）
 *   - `kind`（`GitChangeKind`）を返さない（変更の種類という概念が無い）
 *   - 代わりに `shape` を返す（どちらの側に中身が在るかが、これで決まる）
 *
 * ## 片側が無い競合でも、失敗にしない
 *
 * `DD` / `AU` / `UA` / `UD` / `DU` では、片側または両側に中身が無い。
 * それを `not-found` として断ると、**押しても何も起きないボタン**が
 * 一覧に並ぶことになる ── 開いた先で「この側にはファイルが存在しません」と
 * 読める方が手掛かりになる（docs/ARCHITECTURE.md §14.29）。
 * 無い側は空文字で返し、どちらが無いかは `shape` から画面が決める。
 *
 * ## submodule は「出せない」として返す
 *
 * mode `160000` の段は blob ではなく commit を指す ── `cat-file blob` は
 * 失敗する。失敗として出すより `unsupported-target`（差分の対象ではない）が
 * 近い、という判断は 3-8-9 の `readHeadBlobEntry` が submodule を
 * blob として読まないのとまったく同じ線になる。
 *
 * ## 何も書き換えない
 *
 * 動かす git は `ls-files --stage` と `cat-file` だけで、`checkout --ours` /
 * `--theirs` はこのファイルのどこからも動かない。解決し終えたと伝えるのは
 * 3-8-18 の `applyGitResolveConflict` のままで、面は読み取り専用になる。
 */

/** 出せなかった理由だけを返す（この関数の外に成功の形は無い）。 */
function unavailable(
  reason: Extract<GitConflictFileDiff, { status: 'unavailable' }>['reason']
): GitConflictFileDiff {
  return { status: 'unavailable', reason }
}

export interface GitConflictFileDiffOutcome {
  readonly workspaceId: string | null
  readonly diff: GitConflictFileDiff
}

export interface GitConflictFileDiffRequest {
  readonly relativePath: string
}

/**
 * 競合の中身2つを読む。
 *
 * `readGitFileDiff`（3-8-9）と同じく `runGitExclusively` の中で走らせる ──
 * 中で git を最大5回動かすため、その間に別の操作（解決済みにする・
 * マージの中止・切り替え）が挟まると、**左と右が別の瞬間の写し**になる。
 * とくにこの面では、途中で `merge --abort` が走ると段そのものが消える。
 */
export async function readGitConflictFileDiff(
  request: GitConflictFileDiffRequest
): Promise<GitConflictFileDiffOutcome> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return { workspaceId: before.workspaceId, diff: unavailable('not-ready') }
    }

    const path = normalizeGitPathspec(request.relativePath)

    if (path === null) {
      return { workspaceId: before.workspaceId, diff: unavailable('not-found') }
    }

    /*
      押してから読むまでの間に、その行が競合のグループから消えていた
      （端末での `git add` / `git merge --abort` / 「解決済みにする」）。

      3-8-9 の差分・3-8-18 の解決とまったく同じ確かめ方になる ── Main は
      届いた対象を、自分がその場で読み直した状態に照らして確かめる。
    */
    const conflicted = before.repository.changes.conflicted.some(
      (candidate) => candidate.relativePath === path
    )

    if (!conflicted) {
      return { workspaceId: before.workspaceId, diff: unavailable('not-found') }
    }

    return { workspaceId: before.workspaceId, diff: await buildConflictDiff(path) }
  })
}

async function buildConflictDiff(path: string): Promise<GitConflictFileDiff> {
  const listed = await runGit(showIndexBlob([path]))

  if (listed.status !== 'completed') {
    return unavailable(toGitRunFailureReason(listed.status))
  }

  if (listed.exitCode !== 0) {
    return unavailable('failed')
  }

  const stages = readConflictStages(listed.stdout, path)
  const shape = toGitConflictShape(stages)

  /*
    段が1つも無い。一覧では競合として出ていたのに、index にはもう
    段が残っていない ── 読み直した status と `ls-files` の間で外れた。

    **形を推測して返さない** ── 返すと「中身が両側とも空の競合」として
    面が開き、`DD`（両方で削除）と見分けが付かなくなる。
  */
  if (shape === null) {
    return unavailable('not-found')
  }

  /*
    submodule（mode 160000）は中身を持たない ── どちらかの段が submodule なら
    その時点で断る。片側だけを出すこともしない（残った側だけを並べると、
    もう片方が「空のファイル」に見える）。
  */
  if (hasSubmoduleStage(stages)) {
    return unavailable('unsupported-target')
  }

  const original = await readStageSide(stages.ours)

  if (original.status !== 'ok') {
    return unavailable(original.reason)
  }

  const modified = await readStageSide(stages.theirs)

  if (modified.status !== 'ok') {
    return unavailable(modified.reason)
  }

  return {
    status: 'ready',
    relativePath: path,
    shape,
    original: original.content,
    modified: modified.content
  }
}

/**
 * その段の中身。段が無ければ空（比べる相手が居ない側）。
 *
 * 読み方は 3-8-9 とまったく同じ1本を通る（gitDiffSide.ts の
 * `readGitBlobSide`）── 大きさを先に訊く・上限は Editor と同じ値・
 * バイナリの判定は files ドメインと同じ基準・改行は LF に均す、の4つが
 * **どの差分でも必ず同じ**になる。競合のためだけの読み方は作らない。
 */
async function readStageSide(stage: GitConflictStageEntry | null): Promise<GitDiffSideOutcome> {
  return stage === null ? EMPTY_GIT_DIFF_SIDE : await readGitBlobSide(stage.object)
}

/** どれか1つでも submodule の段があるか（base も見る）。 */
function hasSubmoduleStage(stages: GitConflictStages): boolean {
  return (
    stages.base?.submodule === true ||
    stages.ours?.submodule === true ||
    stages.theirs?.submodule === true
  )
}
