import type { GitDiffGroup, GitFileDiff, GitFileChange } from '@shared/git'
import { readWorkspaceFile } from '../files/readWorkspaceFile'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import { readHeadBlobEntry, readIndexBlobEntry } from './gitBlob'
import { showHeadBlob, showIndexBlob } from './gitCommands'
import {
  EMPTY_GIT_DIFF_SIDE,
  normalizeGitLineEndings,
  readGitBlobSide,
  toGitRunFailureReason,
  type GitDiffSideOutcome
} from './gitDiffSide'
import { normalizeGitPathspec } from './gitPathspec'
import { runGitExclusively } from './gitQueue'
import { hasGitHeadCommit, readGitRepositoryOutcome } from './gitRepository'
import { runGit } from './runGit'

/**
 * 1行の差分を「左に出す中身」と「右に出す中身」として組み立てる（Session 3-8-9）。
 *
 * ## 何と何を比べるかは、押した行が決める
 *
 * 一覧は同じファイルを2つのグループに並べることがある（`git add` した後に
 * もう一度書き換えた状態）。押したのがどちらの行かで、比べる相手が変わる。
 *
 * | グループ  | 左（前）             | 右（後）           |
 * | --------- | -------------------- | ------------------ |
 * | staged    | HEAD の中身          | index の中身       |
 * | unstaged  | index の中身         | 作業ツリーの中身   |
 * | untracked | （空。まだ Git に無い） | 作業ツリーの中身 |
 *
 * 種類による例外が3つある。
 *
 *   追加（staged の `added`）… 左は空（HEAD に相手が居ない）
 *   削除                      … 右は空（作業ツリー / index に相手が居ない）
 *   rename / copy             … 左は **`originalPath`** の HEAD の中身
 *
 * さらに**初回 commit 前**（HEAD がまだ無い）では、staged の左は常に空になる ──
 * git が答えられないものを「読めなかった」として失敗に倒すと、
 * `git init` した直後のリポジトリで差分が1件も出せない。
 *
 * ## 押してから読むまでの間を、Main 側で確かめ直す
 *
 * 受け取った位置とグループは、**その場で読み直した status に照らして確かめる。**
 * Renderer が抱えていた古い一覧を信じないのは Stage / Unstage と同じ判断で
 * （shared/git/operation.ts）、こちらでは「端末で `git add` した後に
 * 変更の行を押した」場合に、**もう存在しない組み合わせの差分**を
 * 作らないために効く。
 *
 * ## 出せないものは、出せない理由として返す
 *
 * バイナリ・2MB 超・見つからない。どれも `IpcResult` の失敗にしない
 * （shared/git/diff.ts）── 利用者の次の一手がそれぞれ違い、
 * 汎用のエラー文言に丸めると「なぜ出ないのか」を出せなくなる。
 *
 * 大きさの上限は **Editor で開ける上限と同じ値**にしてある。差分の側だけが
 * 大きいものを開けると、「Git パネルからは見えるのに、Editor では開けない」が
 * 起きる ── そのファイルを直しに行く先が無い。
 */

/** 出せなかった理由だけを返す（この関数の外に成功の形は無い）。 */
function unavailable(
  reason: Extract<GitFileDiff, { status: 'unavailable' }>['reason']
): GitFileDiff {
  return { status: 'unavailable', reason }
}

export interface GitFileDiffOutcome {
  readonly workspaceId: string | null
  readonly diff: GitFileDiff
}

export interface GitFileDiffRequest {
  readonly group: GitDiffGroup
  readonly relativePath: string
}

/**
 * 差分を読む。
 *
 * 読み取りだが `runGitExclusively` の中で走らせる ── 中で git を最大4回
 * 動かすため、その間に別の操作（Stage / Commit / 切り替え）が挟まると、
 * **左と右が別の瞬間の写し**になる。順番待ちの枠を取る点は他の操作と同じで、
 * 走る git が常に1本であることは 3-8-3 のまま変わらない。
 */
export async function readGitFileDiff(request: GitFileDiffRequest): Promise<GitFileDiffOutcome> {
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
      押した行が、今もそのグループに居るか。

      **他のグループへ移っていても not-found** にする ── 押したのは
      「この行の差分」であって「このファイルのどこかの差分」ではない。
    */
    const change = before.repository.changes[request.group].find(
      (candidate) => candidate.relativePath === path
    )

    if (change === undefined) {
      return { workspaceId: before.workspaceId, diff: unavailable('not-found') }
    }

    // 未追跡のフォルダ1件（`node_modules/`）。開くファイルが決まらない。
    if (change.directory) {
      return { workspaceId: before.workspaceId, diff: unavailable('unsupported-target') }
    }

    const diff = await buildDiff(request.group, change, path)

    return { workspaceId: before.workspaceId, diff }
  })
}

async function buildDiff(
  group: GitDiffGroup,
  change: GitFileChange,
  path: string
): Promise<GitFileDiff> {
  const original = await readOriginalSide(group, change, path)

  if (original.status !== 'ok') {
    return unavailable(original.reason)
  }

  const modified = await readModifiedSide(group, change, path)

  if (modified.status !== 'ok') {
    return unavailable(modified.reason)
  }

  return {
    status: 'ready',
    relativePath: path,
    originalPath: change.originalPath,
    group,
    kind: change.kind,
    original: original.content,
    modified: modified.content
  }
}

/* ------------------------------------------------------------------ 左（変更の前） */

/*
  片側を object から読む処理は gitDiffSide.ts に切り出してある（Session 3-8-12）。

  commit の中の tree が**4つめの相手**として増えたため、上限・バイナリの判定・
  改行の均しを2箇所に置かない形にした ── ここに残るのは
  「**どちらの側に何を出すか**」という、作業ツリーと index に固有の判断だけになる。
*/
type SideOutcome = GitDiffSideOutcome

/** 比べる相手が居ない側（追加 / 未追跡 / 初回 commit 前 / 削除の右）。 */
const EMPTY_SIDE = EMPTY_GIT_DIFF_SIDE

async function readOriginalSide(
  group: GitDiffGroup,
  change: GitFileChange,
  path: string
): Promise<SideOutcome> {
  // まだ Git が知らないファイル。比べる相手そのものが無い。
  if (group === 'untracked') {
    return EMPTY_SIDE
  }

  /*
    unstaged の左は index。ここは HEAD の有無に関係なく在る
    （作業ツリーに変更があるということは、index に載っているということ）。
  */
  if (group === 'unstaged') {
    return await readIndexSide(path)
  }

  // staged の左は HEAD。追加されたものには、HEAD 側の相手が居ない。
  if (change.kind === 'added') {
    return EMPTY_SIDE
  }

  /*
    初回 commit 前は HEAD そのものが無い。

    「読めなかった」ではなく「比べる相手がまだ無い」なので、空に倒す ──
    `git init` した直後のリポジトリで、ステージ済みの差分が
    1件も出せなくなるのを避ける。
  */
  const hasHead = await hasGitHeadCommit()

  if (hasHead === null) {
    return { status: 'unavailable', reason: 'failed' }
  }

  if (!hasHead) {
    return EMPTY_SIDE
  }

  /*
    rename / copy では、HEAD 側に居るのは**元の位置**になる。
    変更後の位置で訊くと HEAD に見つからず、「全部が追加された」差分になる。
  */
  const headPath = change.originalPath ?? path

  return await readHeadSide(headPath)
}

/* ------------------------------------------------------------------ 右（変更の後） */

async function readModifiedSide(
  group: GitDiffGroup,
  change: GitFileChange,
  path: string
): Promise<SideOutcome> {
  // 消えたものには、後の中身が無い（unstaged の削除 / staged の削除）。
  if (change.kind === 'deleted') {
    return EMPTY_SIDE
  }

  // staged の右は index の中身（作業ツリーではない）。
  if (group === 'staged') {
    return await readIndexSide(path)
  }

  return await readWorktreeSide(path)
}

/* ------------------------------------------------------------------ それぞれの読み方 */

async function readIndexSide(path: string): Promise<SideOutcome> {
  const listed = await runGit(showIndexBlob([path]))

  if (listed.status !== 'completed') {
    return { status: 'unavailable', reason: toGitRunFailureReason(listed.status) }
  }

  if (listed.exitCode !== 0) {
    return { status: 'unavailable', reason: 'failed' }
  }

  const entry = readIndexBlobEntry(listed.stdout, path)

  /*
    index に載っていない。押してから読むまでの間に外れた（端末での `git reset`）。
    一覧の側は既に読み直した後のものを見ているため、ここは「見つからない」で足りる。
  */
  if (entry === null) {
    return { status: 'unavailable', reason: 'not-found' }
  }

  return await readGitBlobSide(entry.object)
}

async function readHeadSide(path: string): Promise<SideOutcome> {
  const listed = await runGit(showHeadBlob([path]))

  if (listed.status !== 'completed') {
    return { status: 'unavailable', reason: toGitRunFailureReason(listed.status) }
  }

  if (listed.exitCode !== 0) {
    return { status: 'unavailable', reason: 'failed' }
  }

  const entry = readHeadBlobEntry(listed.stdout, path)

  /*
    HEAD に居ない。追加として index に載ったものの、`kind` が `modified` で
    返ってきた場合など（他の経路で HEAD が動いた）にここへ来る。
    **失敗にせず空に倒す** ── 「HEAD には無かった」は差分として正しく出せる。
  */
  return entry === null ? EMPTY_SIDE : await readGitBlobSide(entry.object)
}

/**
 * 作業ツリーの中身。
 *
 * **files ドメインの読み取りをそのまま通る**（main/files/readWorkspaceFile.ts）──
 * Workspace の境界の確認・symlink の追跡・大きさの上限・バイナリの判定・
 * BOM の扱いが、Editor でそのファイルを開いたときとまったく同じになる。
 * git 側に2つ目の「ファイルの読み方」を作ると、
 * **Editor では開けるのに差分では出ない**（あるいはその逆）が生まれる。
 */
async function readWorktreeSide(path: string): Promise<SideOutcome> {
  const workspace = getCurrentWorkspaceFolder()

  // 読んでいる間に閉じられた。
  if (workspace === null) {
    return { status: 'unavailable', reason: 'not-ready' }
  }

  const outcome = await readWorkspaceFile(workspace.rootPath, path)

  switch (outcome.status) {
    case 'ok':
      break

    case 'not-found':
      return { status: 'unavailable', reason: 'not-found' }

    // フォルダ・Workspace の外・形が通らない。差分の対象にならない。
    case 'not-a-file':
    case 'outside-workspace':
    case 'invalid-path':
      return { status: 'unavailable', reason: 'unsupported-target' }

    default:
      return { status: 'unavailable', reason: 'failed' }
  }

  switch (outcome.fileStatus) {
    case 'binary':
      return { status: 'unavailable', reason: 'binary' }

    case 'too-large':
      return { status: 'unavailable', reason: 'too-large' }

    case 'ok':
      break
  }

  // fileStatus が 'ok' なら中身は必ず在る。型の上で残る null は落としておく。
  return outcome.content === null
    ? { status: 'unavailable', reason: 'unreadable' }
    : { status: 'ok', content: normalizeGitLineEndings(outcome.content) }
}
