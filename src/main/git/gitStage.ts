import type {
  GitFileChange,
  GitOperationOutcome,
  GitStageTarget,
  GitUnstageTarget
} from '@shared/git'
import { createLogger } from '../logger'
import {
  stagePaths,
  unstagePathsFromHead,
  unstagePathsWithoutHead,
  type GitCommand
} from './gitCommands'
import { classifyGitOperationFailure } from './gitFailure'
import {
  finishGitOperation,
  guardGitInProgress,
  notReadyGitOperation,
  type GitOperationResult
} from './gitOperationResult'
import { chunkGitPathspecs, normalizeGitPathspec } from './gitPathspec'
import { runGitExclusively } from './gitQueue'
import { hasGitHeadCommit, readGitRepositoryOutcome } from './gitRepository'
import { runGit } from './runGit'

/**
 * Stage / Unstage（Session 3-8-3）。
 *
 * Git 機能で、Renderer からの要求がリポジトリを**書き換える**最初の場所にあたる。
 * 部品の分担は読み取り側（gitRepository.ts）と同じで、ここが持つのは噛み合わせだけになる。
 *
 *   順番待ち   … gitQueue.ts（走るのは常に1本）
 *   引数       … gitCommands.ts（組み立てられる場所はそこだけ）
 *   値の検証   … gitPathspec.ts（純粋・テスト対象）
 *   失敗の分類 … gitFailure.ts（純粋・テスト対象）
 *   状態の読み … gitRepository.ts（操作の前後で同じ関数を使う）
 *   応答の形   … gitOperationResult.ts（Commit と共有。Session 3-8-4）
 *
 * ## 1つの仕事は「読む → 動かす → 読み直す」
 *
 * ```
 * 1. 今の状態を読む      → 操作できるか / 対象は何か
 * 2. git を動かす        → add / reset / rm --cached
 * 3. もう一度状態を読む  → 応答に載せる（成功でも失敗でも）
 * ```
 *
 * **1 と 3 で同じ関数を使う**のが要点になる。対象を決めるのに使った一覧と、
 * 操作の後に画面へ出す一覧が同じ読み取り経路から出てくるため、
 * 「画面に出ているもの」と「実際に Stage されたもの」が食い違わない。
 *
 * この3つの間に他の git が割り込まないことは、順番待ちが担保する。
 *
 * ## Renderer が持っている一覧を送り返させない
 *
 * グループの「すべて」で対象を決めるのは 1 で読んだ状態であって、
 * Renderer が持っていた一覧ではない。押すまでの間に消えたファイル・
 * 競合に変わったファイルまで対象にしないためで、同時に
 * 「Renderer から任意の複数 path を渡せる欄」を作らないためでもある
 * （shared/git/operation.ts）。
 *
 * ## 失敗しても、返すのは新しい状態
 *
 * どの結末でも 3 は必ず行う。失敗の後に古い一覧を残すと、利用者から見て
 * 「押したのに何も変わらない」ことになり、本当の状態が分からなくなる。
 * 途中まで進んで失敗した場合（分割して実行した2回目で失敗した場合）も、
 * **進んだところまでが正しく画面に出る。**
 */

const log = createLogger('git')

/* ------------------------------------------------------------------------------ Stage */

/**
 * index に載せる。
 *
 * `target` は検証済み（ハンドラが `normalizeGitPathspec` を通している）。
 * それでもここでもう一度通すのは、グループの「すべて」で対象になる path が
 * **git の出力から来る**ため ── そちらは検証を通っていない。
 * 入口を1つにしておけば、どちらの経路でも同じ規則が効く。
 */
export async function applyGitStage(target: GitStageTarget): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    // マージの途中では止めない（Stage はマージを終わらせる道の一部）。
    const guarded = guardGitInProgress(before, 'stage')

    if (guarded !== null) {
      return guarded
    }

    const paths = collectStagePaths(target, before.repository.changes)

    if (paths === null) {
      return await finishGitOperation(before.workspaceId, { status: 'failed', reason: 'unknown' })
    }

    if (paths.length === 0) {
      /*
        押すまでの間に空になっていた（端末で `git add` した後など）。
        黙って成功にすると「押したのに何も起きない」が起き、壊れていると読まれる。
      */
      return await finishGitOperation(before.workspaceId, {
        status: 'failed',
        reason: 'nothing-to-do'
      })
    }

    const outcome = await runInChunks(paths, stagePaths)

    return await finishGitOperation(before.workspaceId, outcome)
  })
}

/**
 * Stage の対象になる path を決める。
 *
 * pathspec として通せないものが混ざっていたら **null**（＝操作そのものを断る）。
 * その1件だけ飛ばして残りを Stage する形にしない ── 「すべて Stage」を押した
 * 利用者はその一覧の全部が載ったと読むため、黙って1件欠けるのがいちばん危ない
 * （一覧を部分的に返さない、という 3-8-2 の判断と同じ。gitStatusOutput.ts）。
 */
function collectStagePaths(
  target: GitStageTarget,
  changes: {
    readonly unstaged: readonly GitFileChange[]
    readonly untracked: readonly GitFileChange[]
  }
): readonly string[] | null {
  if (target.kind === 'file') {
    const path = normalizeGitPathspec(target.relativePath)

    return path === null ? null : [path]
  }

  /*
    グループの「すべて」。競合しているファイルはどちらのグループにも入らないため、
    ここから漏れる ── `git add -u`（作業ツリー全体）にしていないのはそのためで、
    あれを使うと衝突まで「解決済み」として index に載る（shared/git/operation.ts）。
  */
  const source = target.kind === 'unstaged' ? changes.unstaged : changes.untracked

  return toPathspecs(source.map((change) => change.relativePath))
}

/* ---------------------------------------------------------------------------- Unstage */

/**
 * index から外す。**作業ツリーには触らない。**
 *
 * 経路は HEAD があるかどうかで変わる（gitCommands.ts）。
 *
 *   HEAD がある … `git reset HEAD -- <path>`（index を HEAD の中身へ戻す）
 *   まだ無い    … `git rm --cached -- <path>`（index から取り除く ＝ 未追跡へ戻る）
 */
export async function applyGitUnstage(target: GitUnstageTarget): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    // Stage と同じ線（Session 3-8-22A）。
    const guarded = guardGitInProgress(before, 'unstage')

    if (guarded !== null) {
      return guarded
    }

    const requested = normalizeGitPathspec(target.relativePath)

    if (requested === null) {
      return await finishGitOperation(before.workspaceId, { status: 'failed', reason: 'unknown' })
    }

    const staged = before.repository.changes.staged.find(
      (change) => change.relativePath === requested
    )

    if (staged === undefined) {
      /*
        押すまでの間に、他の経路（端末での `git commit` / `git reset`）で
        既に外れていた。git を動かさずに、取り直した状態だけを返す。
      */
      return await finishGitOperation(before.workspaceId, {
        status: 'failed',
        reason: 'path-not-found'
      })
    }

    const paths = collectUnstagePaths(staged)

    if (paths === null) {
      return await finishGitOperation(before.workspaceId, { status: 'failed', reason: 'unknown' })
    }

    /*
      HEAD がある側へ倒せば初回 commit 前に断られ、無い側へ倒せば
      `git rm --cached` が追跡済みのファイルを未追跡に変えてしまう
      （＝「Unstage したらファイルが Git から消えた」）。だから分からなければ進めない。
    */
    const hasHead = await hasGitHeadCommit()

    if (hasHead === null) {
      return await finishGitOperation(before.workspaceId, { status: 'failed', reason: 'unknown' })
    }

    const outcome = await runInChunks(
      paths,
      hasHead ? unstagePathsFromHead : unstagePathsWithoutHead
    )

    return await finishGitOperation(before.workspaceId, outcome)
  })
}

/**
 * Unstage の対象になる path を決める。
 *
 * **rename では元の位置も一緒に戻す。** index の上では rename は
 * 「元の位置の削除」と「新しい位置の追加」の2つで、新しい位置だけを戻すと
 * *元の位置の削除だけが Stage に残る* ── 画面では1行だったものを戻したのに、
 * 別の1行（削除）が残ることになり、利用者から見て何が起きたのか分からない。
 *
 * copy（`C`）では元の位置に触らない。あちらは元が変わっていないため、
 * 戻す対象は新しい位置だけになる。
 */
function collectUnstagePaths(staged: GitFileChange): readonly string[] | null {
  if (staged.kind === 'renamed' && staged.originalPath !== null) {
    return toPathspecs([staged.relativePath, staged.originalPath])
  }

  return toPathspecs([staged.relativePath])
}

/* ------------------------------------------------------------------------------ 共通 */

/** 検証を通した pathspec の並び。1つでも通せなければ null。 */
function toPathspecs(paths: readonly string[]): readonly string[] | null {
  const pathspecs: string[] = []

  for (const path of paths) {
    const pathspec = normalizeGitPathspec(path)

    if (pathspec === null) {
      log.warn('a path from git status could not be used as a pathspec.')
      return null
    }

    pathspecs.push(pathspec)
  }

  return pathspecs
}

/**
 * pathspec を分けて渡し、1回でも失敗したらそこで止める。
 *
 * 分けるのは Windows のコマンドラインの長さの上限のため（gitPathspec.ts）。
 * 止めた時点までの分は index に載っているが、**その姿はこの後の読み直しで
 * そのまま画面に出る** ── 進んだところまでを無かったことにする（戻す）方が、
 * 利用者にとっては予測しにくい。
 */
async function runInChunks(
  paths: readonly string[],
  toCommand: (paths: readonly string[]) => GitCommand
): Promise<GitOperationOutcome> {
  for (const chunk of chunkGitPathspecs(paths)) {
    const outcome = await runGit(toCommand(chunk))

    switch (outcome.status) {
      case 'completed':
        break

      case 'no-workspace':
      case 'git-unavailable':
        return { status: 'failed', reason: 'not-ready' }

      case 'failed':
        return {
          status: 'failed',
          reason: outcome.reason === 'timeout' ? 'timeout' : 'unknown'
        }
    }

    if (outcome.exitCode !== 0) {
      return { status: 'failed', reason: classifyGitOperationFailure(outcome.stderr) }
    }
  }

  return { status: 'applied' }
}
