import {
  GIT_COMMIT_FILE_LIMIT,
  type GitCommitDetail,
  type GitCommitFileChange,
  type GitCommitFileDiff,
  type GitCommitSummary
} from '@shared/git'
import { createLogger } from '../logger'
import { showCommitFileChanges, showCommitSummary } from './gitCommands'
import { normalizeGitCommitHash } from './gitCommitHash'
import { EMPTY_GIT_DIFF_SIDE, readGitBlobSide, type GitDiffSideOutcome } from './gitDiffSide'
import { summarizeGitStderr } from './gitFailure'
import { readCommitFileChanges, readCommitRecord, type GitCommitFileEntry } from './gitOutput'
import { normalizeGitPathspec } from './gitPathspec'
import { runGitExclusively } from './gitQueue'
import { readGitRepositoryOutcome } from './gitRepository'
import { runGit } from './runGit'

/**
 * commit 1件の中身を読む（Session 3-8-12）。
 *
 * 部品の分担は履歴（gitHistory.ts）・差分（gitDiff.ts）とまったく同じで、
 * ここが持つのは噛み合わせだけになる。
 *
 *   順番待ち     … gitQueue.ts（走るのは常に1本）
 *   rev の形     … gitCommitHash.ts（16進 4〜40 桁だけ）
 *   位置の形     … gitPathspec.ts（3-8-3 から同じ関数）
 *   引数         … gitCommands.ts（組み立てられる場所はそこだけ）
 *   出力の読み   … gitOutput.ts（純粋・テスト対象）
 *   中身の読み   … gitDiffSide.ts（3-8-9 と同じ1本）
 *   状態の読み   … gitRepository.ts（他の操作と同じ関数）
 *
 * ## 何も書き換えない
 *
 * 動かす git は `show --no-patch` / `diff-tree` / `cat-file` の3種で、
 * どれも読み取りになる（`GitOperationResult` を返さないのは履歴と同じ理由）。
 * revert も cherry-pick も reset も、この面から動く経路は1つも無い。
 *
 * ## 「開いた行」を、Main 側で確かめ直す
 *
 * Renderer が持っている履歴の行は、開いた時点の写しにあたる。したがって
 * 見出しに出す名乗りも、変更ファイルの一覧も、**ここで読み直した1回**の
 * ものを返す（3-8-9 で「押した行が今もそのグループに居るか」を確かめ直したのと
 * 同じ構え）── 端末で `git reset --hard` した後に開いた行を押した場合、
 * その commit はもう解けず `not-found` になる。
 *
 * ## マージ commit は、失敗ではなく答えとして返す
 *
 * 親が2つ以上なら、変更ファイルの一覧を作らずに `merge` を返す
 * （理由の全文は shared/git/commitDetail.ts）。`diff-tree` を動かせば
 * **何も出力せずに 0 で終わる**ため、そのまま流すと「変更が1件も無い commit」に
 * 見える ── 動かす前に分けておく。
 */

const log = createLogger('git')

export interface GitCommitDetailOutcome {
  readonly workspaceId: string | null
  readonly detail: GitCommitDetail
}

export interface GitCommitDetailRequest {
  readonly shortHash: string
}

export interface GitCommitFileDiffOutcome {
  readonly workspaceId: string | null
  readonly diff: GitCommitFileDiff
}

export interface GitCommitFileDiffRequest {
  readonly shortHash: string
  readonly relativePath: string
}

/**
 * commit 1件の変更ファイルを読む。
 *
 * 読み取りだが `runGitExclusively` の中で走らせる ── 中で git を2回動かすため
 * （名乗りと変更ファイル）、その間に切り替えや Commit が挟まると
 * **確かめた commit と読んだ一覧が別の瞬間のもの**になる（履歴と同じ理由）。
 */
export async function readGitCommitDetail(
  request: GitCommitDetailRequest
): Promise<GitCommitDetailOutcome> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return { workspaceId: before.workspaceId, detail: unavailableDetail('not-ready') }
    }

    const hash = normalizeGitCommitHash(request.shortHash)

    if (hash === null) {
      return { workspaceId: before.workspaceId, detail: unavailableDetail('not-found') }
    }

    const commit = await readCommitSummary(hash)

    if (commit.status !== 'ok') {
      return { workspaceId: before.workspaceId, detail: unavailableDetail(commit.reason) }
    }

    /*
      マージ commit（親が2つ以上）。**ここで止める** ── 下の `diff-tree` は
      何も出力せずに 0 で終わるため、流すと「変更が1件も無い commit」に見える。
    */
    if (commit.commit.parentCount >= 2) {
      return { workspaceId: before.workspaceId, detail: unavailableDetail('merge') }
    }

    const listed = await readFileEntries(hash)

    if (listed.status !== 'ok') {
      return { workspaceId: before.workspaceId, detail: unavailableDetail(listed.reason) }
    }

    return {
      workspaceId: before.workspaceId,
      detail: {
        status: 'ready',
        commit: commit.commit,
        files: listed.files.map(toFileChange),
        truncated: listed.truncated
      }
    }
  })
}

/**
 * commit の中の1ファイルの差分を読む。
 *
 * ## 一覧をもう一度読み直してから中身を取りに行く
 *
 * 詳細の応答に object 名を載せて往復させない（shared/git/commitDetail.ts）。
 * 代わりに、押された位置でここが `diff-tree` を1回動かし直し、**その1回が
 * 答えた object 名**で中身を読む ── 3-8-9 で `ls-files` / `ls-tree` を
 * 挟んだのと同じ2段で、位置は最後まで pathspec のまま、中身の引数には
 * git 自身が作った文字列だけが載る。
 *
 * commit は書き換わらないので、読み直しても答えは同じになる（作業ツリーの
 * 差分と違い、ここでの読み直しは「古い一覧を信じない」ためではなく
 * **object 名を運ばないため**にある）。
 *
 * ## マージ commit ではここも断る
 *
 * 詳細の側で `merge` を返しているので画面から押せる行はそもそも無いが、
 * 入口では確かめ直す（届いた要求が Renderer の写しどおりとは限らない）。
 * 断り方は `not-found` にする ── 差分の理由の表（`GitDiffUnavailableReason`）に
 * マージ専用の語を足さない。理由が画面に出るのは詳細の側で、そこには
 * 専用の語がある。
 */
export async function readGitCommitFileDiff(
  request: GitCommitFileDiffRequest
): Promise<GitCommitFileDiffOutcome> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return { workspaceId: before.workspaceId, diff: unavailableDiff('not-ready') }
    }

    const hash = normalizeGitCommitHash(request.shortHash)
    const path = normalizeGitPathspec(request.relativePath)

    if (hash === null || path === null) {
      return { workspaceId: before.workspaceId, diff: unavailableDiff('not-found') }
    }

    const commit = await readCommitSummary(hash)

    if (commit.status !== 'ok') {
      return {
        workspaceId: before.workspaceId,
        diff: unavailableDiff(commit.reason === 'failed' ? 'failed' : 'not-found')
      }
    }

    if (commit.commit.parentCount >= 2) {
      return { workspaceId: before.workspaceId, diff: unavailableDiff('not-found') }
    }

    /*
      上限を渡さない。押せるのは上限の内側の行だけだが、**探す側で切ると
      「一覧には出たのに差分では見つからない」が起こりうる**（切る位置が
      2箇所にあると、片方だけ直された日に食い違う）。
    */
    const listed = await readFileEntries(hash, Number.POSITIVE_INFINITY)

    if (listed.status !== 'ok') {
      return { workspaceId: before.workspaceId, diff: unavailableDiff(listed.reason) }
    }

    /*
      押した行が、この commit の中に在るか。**位置で突き合わせる** ──
      rename / copy では「先の位置」で押されるので、そちらで探す
      （元の位置は左側を読むときに使う）。
    */
    const entry = listed.files.find((candidate) => candidate.relativePath === path)

    if (entry === undefined) {
      return { workspaceId: before.workspaceId, diff: unavailableDiff('not-found') }
    }

    return { workspaceId: before.workspaceId, diff: await buildDiff(entry) }
  })
}

/* ------------------------------------------------------------------ commit の名乗り */

type CommitOutcome =
  | { readonly status: 'ok'; readonly commit: GitCommitSummary }
  | {
      readonly status: 'unavailable'
      readonly reason: Extract<GitCommitDetail, { status: 'unavailable' }>['reason']
    }

/**
 * `show --no-patch` を1回動かして、commit 1件の名乗りを読む。
 *
 * 読み方は履歴とまったく同じ関数を通る（`readCommitRecord`）── 書式が同じなら
 * 読み方も1つでよく、2つ置くと同じ commit が「一覧では読めるのに詳細では
 * 読めない」形が生まれる。
 *
 * ## 解けなかったことを `failed` に落とさない
 *
 * `git show` が非0で終わるのは、その hash が解けなかったとき（消えた・
 * 曖昧・そもそも無い）になる。どれも利用者の次の一手は同じ（履歴を開き直す）で、
 * 分類を増やしても選べる手が増えない ── `not-found` の1つに寄せる。
 *
 * ## 0 で終わっても、読めなければ `not-found`
 *
 * 16進の並びは blob にも当たりうる。その場合 `git show` は **`--format` を
 * 効かせずに中身をそのまま出して 0 で終わる**（実際に確かめた）── 欄も
 * hash の形も揃わないので `readCommitRecord` が null を返し、ここへ来る。
 */
async function readCommitSummary(hash: string): Promise<CommitOutcome> {
  const outcome = await runGit(showCommitSummary(hash))

  switch (outcome.status) {
    case 'no-workspace':
    case 'git-unavailable':
      // 問い合わせている間に閉じられた／git が消えた（履歴と同じ扱い）。
      return { status: 'unavailable', reason: 'not-ready' }

    case 'failed':
      return { status: 'unavailable', reason: 'failed' }

    case 'completed':
      break
  }

  if (outcome.exitCode !== 0) {
    log.info(`git show exited ${outcome.exitCode}: ${summarizeGitStderr(outcome.stderr)}`)
    return { status: 'unavailable', reason: 'not-found' }
  }

  /*
    `%s` に改行は入らない（要約は1行目だけ）ので、出力は1行になる。
    それでも最初の行だけを渡すのは、`git show` が警告を先に出す場合に
    その行を commit として読まないため。
  */
  const commit = readCommitRecord(outcome.stdout.split('\n')[0])

  return commit === null ? { status: 'unavailable', reason: 'not-found' } : { status: 'ok', commit }
}

/* ------------------------------------------------------ commit の中の変更ファイル */

type FileEntriesOutcome =
  | {
      readonly status: 'ok'
      readonly files: readonly GitCommitFileEntry[]
      readonly truncated: boolean
    }
  /**
   * `merge` も `not-found` もここには現れない。
   *
   * どちらの commit かは**この関数へ来る前に解けている**（`readCommitSummary`）ため、
   * ここから返る断り方は2つだけになる ── 型で絞ってあるので、
   * 差分の側（`GitDiffUnavailableReason`）へそのまま渡せる。
   */
  | { readonly status: 'unavailable'; readonly reason: 'not-ready' | 'failed' }

/** `diff-tree --raw` を1回動かして、変わったファイルを読む。 */
async function readFileEntries(
  hash: string,
  limit: number = GIT_COMMIT_FILE_LIMIT
): Promise<FileEntriesOutcome> {
  const outcome = await runGit(showCommitFileChanges(hash))

  switch (outcome.status) {
    case 'no-workspace':
    case 'git-unavailable':
      return { status: 'unavailable', reason: 'not-ready' }

    case 'failed':
      return { status: 'unavailable', reason: 'failed' }

    case 'completed':
      break
  }

  if (outcome.exitCode !== 0) {
    log.info(`git diff-tree exited ${outcome.exitCode}: ${summarizeGitStderr(outcome.stderr)}`)
    return { status: 'unavailable', reason: 'failed' }
  }

  const reading = readCommitFileChanges(outcome.stdout, limit)

  return { status: 'ok', files: reading.files, truncated: reading.truncated }
}

/** Main の中でだけ使う4つ（mode 2つ・object 名2つ）を落として境界へ渡す。 */
function toFileChange(entry: GitCommitFileEntry): GitCommitFileChange {
  return {
    relativePath: entry.relativePath,
    kind: entry.kind,
    originalPath: entry.originalPath
  }
}

/* ------------------------------------------------------------------------ 中身2つ */

/**
 * 1件を「左に出す中身」と「右に出す中身」にする。
 *
 * 相手は常に1組（親の tree と、この commit の tree）なので、3-8-9 のような
 * グループごとの分岐が無い ── 決まるのは `diff-tree` が返した object 名2つで、
 * **無い側は 40 桁の 0 として返り、読む側で null になっている**
 * （main/git/gitOutput.ts）。
 */
async function buildDiff(entry: GitCommitFileEntry): Promise<GitCommitFileDiff> {
  /*
    submodule（mode 160000）。中身は blob ではないため `cat-file blob` は失敗する ──
    失敗として出すより「差分の対象ではない」として扱う方が近い
    （未追跡のフォルダ1件を `unsupported-target` にしているのと同じ判断）。
  */
  if (entry.originalMode === GITLINK_MODE || entry.modifiedMode === GITLINK_MODE) {
    return { status: 'unavailable', reason: 'unsupported-target' }
  }

  const original = await readSide(entry.originalObject)

  if (original.status !== 'ok') {
    return { status: 'unavailable', reason: original.reason }
  }

  const modified = await readSide(entry.modifiedObject)

  if (modified.status !== 'ok') {
    return { status: 'unavailable', reason: modified.reason }
  }

  return {
    status: 'ready',
    relativePath: entry.relativePath,
    originalPath: entry.originalPath,
    kind: entry.kind,
    original: original.content,
    modified: modified.content
  }
}

/** submodule の mode（`git ls-tree` の `commit` 型）。 */
const GITLINK_MODE = '160000'

/** object 名が無い側（追加の左・削除の右）は空に倒す。 */
async function readSide(object: string | null): Promise<GitDiffSideOutcome> {
  return object === null ? EMPTY_GIT_DIFF_SIDE : await readGitBlobSide(object)
}

/* -------------------------------------------------------------------------- 断り方 */

function unavailableDetail(
  reason: Extract<GitCommitDetail, { status: 'unavailable' }>['reason']
): GitCommitDetail {
  return { status: 'unavailable', reason }
}

function unavailableDiff(
  reason: Extract<GitCommitFileDiff, { status: 'unavailable' }>['reason']
): GitCommitFileDiff {
  return { status: 'unavailable', reason }
}
