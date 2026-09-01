import type { GitDiscardTarget, GitOperationFailureReason, GitOperationOutcome } from '@shared/git'
import { deleteWorkspaceEntry, type WorkspaceMutationFailure } from '../files/mutateWorkspaceEntry'
import { createLogger } from '../logger'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import { restoreWorktreePaths } from './gitCommands'
import { classifyGitOperationFailure } from './gitFailure'
import {
  finishGitOperation,
  guardGitInProgress,
  notReadyGitOperation,
  type GitOperationResult
} from './gitOperationResult'
import { normalizeGitPathspec } from './gitPathspec'
import { runGitExclusively } from './gitQueue'
import { readGitRepositoryOutcome } from './gitRepository'
import { runGit } from './runGit'

/**
 * 作業ツリーの変更を破棄する（Session 3-8-9）。
 *
 * ## Git 機能で、初めて「利用者の書いたものが消える」操作になる
 *
 * Stage / Unstage は index を動かすだけ、Commit は履歴に足すだけ、
 * Push / Pull / 切り替えは**失われるなら git が断る**。破棄だけが、
 * 消すことそのものを目的にしている。したがってこの1本で守るのは、
 * 足す機能より先に「**押した行1つより広いものを消さない**」になる。
 *
 * ## 1行ごとに、行うことがまるごと違う
 *
 * | グループ  | 何をするか                          | 戻せるか            |
 * | --------- | ----------------------------------- | ------------------- |
 * | unstaged  | `git restore --worktree`（index は動かさない） | 戻せない  |
 * | untracked | OS のごみ箱へ送る（files ドメイン） | ごみ箱から戻せる    |
 *
 * 未追跡に `git clean` を使わないのは、**ごみ箱を経由しない**ため ── まだ
 * 一度も Git に入っていないファイルは、消してしまうと**どこにも写しが無い。**
 * Files パネルの削除がごみ箱へ送っている（設計上、完全削除の経路を持たない）のに、
 * Git パネルの破棄だけが取り返しのつかない消し方をするのは筋が通らない。
 *
 * `reset --hard` を使わないのも同じ線で、あれは指した1件ではなく
 * **作業ツリー全体**を戻す。
 *
 * ## `staged` と `conflicted` は受け取らない
 *
 * 型の上で渡せない（shared/git/operation.ts）が、Main も届いた値を確かめ直す。
 * ステージ済みは先に Unstage してもらう ── そうすれば「index を戻した」と
 * 「作業ツリーを戻した」が別々の1回として画面に出る。
 *
 * ## 動かす前に、対象が今もそのグループに居るか確かめる
 *
 * Stage / Unstage と同じく、**Renderer が抱えていた一覧は信じない**
 * （shared/git/operation.ts）。押すまでの間に端末で `git add` されていれば、
 * その行はもう「変更」ではない ── 古い一覧のまま走らせると、
 * ステージ済みの内容を作業ツリーごと巻き添えにする。
 *
 * 未保存の Editor タブがあるファイルを破棄させない判断は、ここには無い ──
 * タブを知っているのは Renderer だけで、Main は「どのファイルが開かれているか」を
 * 持たない（renderer/src/git/GitDiscardConfirm.tsx）。境界を越えて
 * タブの一覧を Main へ配るより、押せる場所の側で止める方が層が増えない。
 */

const log = createLogger('git')

export async function applyGitDiscard(target: GitDiscardTarget): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    // マージの途中では止めない（1件ずつの破棄は MERGE_HEAD に触らない）。
    const guarded = guardGitInProgress(before, 'discard')

    if (guarded !== null) {
      return guarded
    }

    const path = normalizeGitPathspec(target.relativePath)

    if (path === null) {
      return await finishGitOperation(before.workspaceId, { status: 'failed', reason: 'unknown' })
    }

    const change = before.repository.changes[target.group].find(
      (candidate) => candidate.relativePath === path
    )

    /*
      押すまでの間に、他の経路（端末での `git add` / `git restore`）で
      その行がそのグループから消えていた。git を動かさずに、
      取り直した状態だけを返す。
    */
    if (change === undefined) {
      return await finishGitOperation(before.workspaceId, {
        status: 'failed',
        reason: 'path-not-found'
      })
    }

    /*
      未追跡の**フォルダ1件**（`node_modules/` のように中身ごと1行で出るもの）。

      行の側に破棄を出していないため利用者には起こらないが、ここで止める。
      通すと、押した人から見て1行だったものが**数万件の削除**になる ──
      一括の破棄を置いていない（shared/git/operation.ts）のに、
      未追跡のフォルダだけがその抜け道になってしまう。
    */
    if (change.directory) {
      return await finishGitOperation(before.workspaceId, {
        status: 'failed',
        reason: 'unsupported-target'
      })
    }

    const outcome =
      target.group === 'unstaged' ? await restoreFromIndex(path) : await trashUntracked(path)

    return await finishGitOperation(before.workspaceId, outcome)
  })
}

/* ------------------------------------------------------- 変更（index の中身へ戻す） */

/**
 * `git restore --worktree`。
 *
 * 渡すのは常に1件。Stage のような分割送り（chunkGitPathspecs）が要らないのは、
 * **グループの「すべて」を受け取らない**ため ── 引数の長さの上限に
 * 届きようが無い。
 *
 * rename の元の位置を一緒に渡すこともしない（Unstage はそうしている）。
 * rename は index 側の話で、作業ツリーの「変更」グループには出てこない。
 */
async function restoreFromIndex(path: string): Promise<GitOperationOutcome> {
  const outcome = await runGit(restoreWorktreePaths([path]))

  switch (outcome.status) {
    case 'completed':
      break

    case 'no-workspace':
    case 'git-unavailable':
      return { status: 'failed', reason: 'not-ready' }

    case 'failed':
      return { status: 'failed', reason: outcome.reason === 'timeout' ? 'timeout' : 'unknown' }
  }

  if (outcome.exitCode !== 0) {
    return { status: 'failed', reason: classifyGitOperationFailure(outcome.stderr) }
  }

  return { status: 'applied' }
}

/* --------------------------------------------------------- 未追跡（ごみ箱へ送る） */

/**
 * OS のごみ箱へ送る。
 *
 * **files ドメインの削除をそのまま通る**（main/files/mutateWorkspaceEntry.ts）──
 * Workspace の境界の確認・symlink の扱い・シェルに宛先を伝えられない名前の
 * 断り方・失敗の分類が、Files パネルから消したときとまったく同じになる。
 * git 側に2つ目の「消し方」を作ると、**Files から消せるのに Git からは消せない**
 * （あるいはその逆）が生まれる。
 *
 * 変化を `files:changed` として自分で配ることはしない。作業ツリーの監視が
 * 拾って配る（main/files/workspaceWatcher.ts）── ブランチの切り替えで
 * Files と Editor が追いつくのとまったく同じ経路にあたる（§14.14）。
 */
async function trashUntracked(path: string): Promise<GitOperationOutcome> {
  const workspace = getCurrentWorkspaceFolder()

  // 読み直してから消すまでの間に閉じられた。
  if (workspace === null) {
    return { status: 'failed', reason: 'not-ready' }
  }

  const outcome = await deleteWorkspaceEntry(workspace.rootPath, path)

  if (outcome.status === 'ok') {
    return { status: 'applied' }
  }

  return { status: 'failed', reason: toDiscardFailureReason(outcome) }
}

/**
 * files ドメインの失敗を、Git 操作の失敗へ翻訳する。
 *
 * **文言のためではなく、次の一手のために分ける**（shared/git/operation.ts）。
 * `busy` を `permission-denied` に丸めないのは、片方が「使っているアプリを
 * 閉じれば通る」で、もう片方が「フォルダのアクセス許可を見る」だから。
 */
function toDiscardFailureReason(failure: WorkspaceMutationFailure): GitOperationFailureReason {
  switch (failure.status) {
    /*
      消そうとしたら既に無かった。押すまでの間に外で消された場合で、
      利用者の見たいもの（その行が消えていること）は既に叶っている。
    */
    case 'not-found':
      return 'path-not-found'

    case 'permission-denied':
      return 'permission-denied'

    case 'busy':
      return 'target-busy'

    /*
      Workspace の外・相対位置や名前として通らない。どれも「その行は破棄の
      対象にならない」で、待っても・やり直しても変わらない。

      `invalid-destination` / `link-source` / `already-exists` は移動・コピー・
      作成にしか起きないが、**分類の網は塞いでおく** ── 型が増えたときに
      `unknown`（「Git 操作に失敗しました」）へ黙って落ちるより、
      ここでコンパイルが止まる方がよい。
    */
    case 'invalid-path':
    case 'invalid-name':
    case 'outside-workspace':
    case 'invalid-destination':
    case 'link-source':
    case 'already-exists':
      return 'unsupported-target'

    case 'failed':
      log.warn(`an untracked file could not be moved to the recycle bin: ${failure.detail}`)
      return 'unknown'
  }
}
