import type { GitOperationOutcome } from '@shared/git'
import { createLogger } from '../logger'
import { checkConflictMarkers, markConflictResolved } from './gitCommands'
import { classifyGitResolveConflictFailure, summarizeGitStderr } from './gitFailure'
import { countLeftoverConflictMarkers } from './gitOutput'
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
 * 競合の解決（Session 3-8-18）。
 *
 * ## 3-8-2 から在った競合のグループに、初めて操作が付く
 *
 * 競合を**別のグループとして出す**ところまでは 3-8-2 で済んでいた。
 * それから 3-8-17 まで、その行にできたのは**エディタで開くこと**だけになる
 * （renderer/src/git/gitChanges.ts の `canOpenGitChange` は競合を通す）──
 * つまり利用者はアプリの中で競合を直せるのに、**直したと Git へ伝える手段が
 * 無かった。**
 *
 * その間、アプリ自身は3箇所で「解決してください」と言っていた。
 *
 *   Commit の失敗          … 「競合が解決されていないため Commit できません。」
 *   退避が押せない理由      … 「…先に解決してからお試しください。」
 *   退避を戻した結末        … 「…競合しました」
 *
 * 3つとも行き先が無いまま案内していたことになる ── 3-8-15（「Commit するか
 * 退避してから」と書いていたのに退避が無かった）・3-8-16（「公開」は在るのに
 * 「接続」が無かった）とまったく同じ形で、3-8-18 で埋めるのはそこになる。
 *
 * ## アプリ自身が作れる状態でもある
 *
 * Pull は `--ff-only` 固定なので競合しない（main/git/gitCommands.ts）。
 * 切り替えは、競合しそうなら git が断る。**アプリが競合を生む唯一の経路が
 * `stash pop`** にあたる（3-8-15。実物で確かめてある）── 押した結果として
 * 入った状態から出られない、という形を残さない。
 *
 * ## 足りなかったのは1手だけ
 *
 * その先は 3-8-4 で既に出来上がっている ── 本番と同じ引数
 * （`commit --quiet --cleanup=whitespace --file=-`）は、マージの途中でも
 * そのまま**マージ commit を作って MERGE_HEAD を消す**（実物で確かめてある。
 * gitConflictRepository.test.ts）。したがって 3-8-18 が足すのは
 * 「解決済みだと Git に伝える」1手で、3方向マージのエディタは要らない
 * （エディタは既にある）。
 *
 * ## Stage とは別の操作にしてある
 *
 * 動かす git は同じ `git add` だが、意味が違う。
 *
 *   Stage  … 作業ツリーの姿を、次の Commit の中身へ写す
 *   解決   … index の3段（base / ours / theirs）を1段に畳む
 *
 * 1本にまとめると、競合の行に出したボタンが「Stage」と名乗ることになり、
 * **押した後に何が起きたのかが説明できない** ── `git remote add` を動かす口を
 * `github:publish` と `git:add-remote` に分けたのと同じ判断で、
 * 引数・チャンネル・失敗の表・画面の文言のすべてを分けてある。
 *
 * ## 取り消す口は持たない（3-8-18 の範囲外）
 *
 * 実物で確かめたことが2つあり、どちらも「取り消し」として出せない。
 *
 *   `git reset HEAD -- <path>`      … 競合を**復元しない**（3段が畳まれた
 *                                     ただの変更として残る）
 *   `git checkout --merge -- <path>` … 復元できるが、**利用者が書いた解決内容を
 *                                     上書きする**
 *
 * 前者を「取り消し」として出すと、押した人は戻ったつもりで3段を失う。
 * 後者は書いたものが消える。したがって口そのものを作らず、
 * 解決した行に `−`（Unstage）も出さない（renderer/src/git/gitChanges.ts）。
 *
 * ## 部品の分担は他の書き込み操作と同じ
 *
 *   順番待ち   … gitQueue.ts（走るのは常に1本）
 *   引数       … gitCommands.ts（組み立てられる場所はそこだけ）
 *   位置の検証 … gitPathspec.ts（`--` の後ろに置ける形か）
 *   出力の読み … gitOutput.ts（純粋・テスト対象）
 *   失敗の分類 … gitFailure.ts（純粋・テスト対象）
 *   状態の読み … gitRepository.ts（操作の前後で同じ関数を使う）
 *   応答の形   … gitOperationResult.ts（Stage / Commit / 破棄と共有）
 */

const log = createLogger('git')

/**
 * 競合している1件を「解決済み」として記録する。
 *
 * ## git を動かす前に、2つ確かめる
 *
 * 3-8-9 の破棄と同じ構えで、**Main は届いた対象を自分が読み直した状態で
 * 確かめ直す**（画面が古いまま押されうるため）。
 *
 *   1. その位置が、今も**競合のグループに居る**か（`path-not-found`）
 *   2. 競合マーカーが残っていないか（`conflict-markers-present`）
 *
 * 1つめが要るのは、競合していないファイルに `git add` を当てると
 * **ただの Stage になってしまう**ため ── 別の口として分けた意味が、
 * そこで消える。端末で先に解決された・退避を捨てた、で普通に起こる。
 *
 * 2つめが 3-8-18 の中心にあたる（下記）。
 *
 * ## マーカーが残っていたら、git を1回も動かさない
 *
 * git は**マーカーが残ったままの `git add` を通し、その後の Commit も通す**
 * （実物で確かめてある）── `<<<<<<< HEAD` の行がそのまま履歴に残る。
 * 履歴に永久に残るものを押し間違いで作らせないので、ここは確かめてから通す。
 *
 * 確かめるのに git を1回増やしているが、これは 3-8-14 の
 * `needsForceForCaseOnlyRename`（大文字小文字だけの改名を確かめる1回）と
 * 同じ性質にあたる ── **押す前に分かることは、押す前に確かめる。**
 *
 * 確かめられなかったとき（git が動かなかった・読めなかった）は
 * **通さない側に倒す** ── 分からないまま通すと、確かめられなかった一回だけ
 * マーカーが履歴へ入りうる。倒しておけば、最悪でも「もう一度押す」で済む。
 */
export async function applyGitResolveConflict(relativePath: string): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    /*
      マージの途中では**止めない**（Session 3-8-22A）── 解決はマージを
      終わらせるための手そのものになる。rebase / cherry-pick / revert では
      止める（解決しても、その先の `--continue` がアプリに無い）。
    */
    const guarded = guardGitInProgress(before, 'resolve-conflict')

    if (guarded !== null) {
      return guarded
    }

    const path = normalizeGitPathspec(relativePath)

    if (path === null) {
      return await finishGitOperation(before.workspaceId, { status: 'failed', reason: 'unknown' })
    }

    /*
      押すまでの間に、他の経路（端末での `git add` / `git merge --abort`）で
      その行が競合のグループから消えていた。git を動かさずに、
      取り直した状態だけを返す（3-8-9 の破棄と同じ形）。
    */
    const conflicted = before.repository.changes.conflicted.some(
      (candidate) => candidate.relativePath === path
    )

    if (!conflicted) {
      return await finishGitOperation(before.workspaceId, {
        status: 'failed',
        reason: 'path-not-found'
      })
    }

    const markers = await countRemainingMarkers(path)

    if (markers === null || markers > 0) {
      return await finishGitOperation(before.workspaceId, {
        status: 'failed',
        reason: 'conflict-markers-present'
      })
    }

    return await finishGitOperation(before.workspaceId, await resolve(path))
  })
}

/**
 * その1件に競合マーカーが何行残っているか。確かめられなければ null。
 *
 * ## 終了コードでは決められない
 *
 * `git diff --check` は競合マーカーと**空白の誤り**を同じ終了コード（2）で
 * 報告する（実物で確かめてある）── 終了コードだけを見ると、解決し終えた
 * のに行末に空白があるだけのファイルが断られる。読むのは出力の行になる
 * （main/git/gitOutput.ts の `countLeftoverConflictMarkers`）。
 *
 * ## 0 と 2 以外も「読めた」として扱わない
 *
 * `--check` は 0（何も無い）か 1 / 2（見つかった）で終わる。それ以外は
 * 想定していない終わり方なので、**確かめられなかった側**（null）へ倒す ──
 * 分からないまま通すと、その一回だけマーカーが履歴へ入りうる。
 *
 * バイナリのファイルや、片方が削除された競合（`UD` / `DU`）では
 * マーカーそのものが無く、0 が返る（実物で確かめてある）── どちらも
 * 「そのまま記録してよい」が正しい答えになるので、断らない。
 */
async function countRemainingMarkers(path: string): Promise<number | null> {
  const outcome = await runGit(checkConflictMarkers(path))

  if (outcome.status !== 'completed') {
    return null
  }

  if (outcome.exitCode !== 0 && outcome.exitCode !== 1 && outcome.exitCode !== 2) {
    log.info(`git diff --check exited ${outcome.exitCode}: ${summarizeGitStderr(outcome.stderr)}`)
    return null
  }

  return countLeftoverConflictMarkers(outcome.stdout)
}

/**
 * `git add` を1回動かして、結末に翻訳する。
 *
 * ## 待ち時間の上限は既定のまま
 *
 * 書き換えるのは index の1件だけで、作業ツリーにもネットワークにも触らない ──
 * Stage（`applyGitStage`）とまったく同じ性質にあたる。
 */
async function resolve(path: string): Promise<GitOperationOutcome> {
  const outcome = await runGit(markConflictResolved(path))

  switch (outcome.status) {
    case 'no-workspace':
    case 'git-unavailable':
      return { status: 'failed', reason: 'not-ready' }

    case 'failed':
      return { status: 'failed', reason: outcome.reason === 'timeout' ? 'timeout' : 'unknown' }

    case 'completed':
      break
  }

  if (outcome.exitCode !== 0) {
    return { status: 'failed', reason: classifyGitResolveConflictFailure(outcome.stderr) }
  }

  return { status: 'applied' }
}
