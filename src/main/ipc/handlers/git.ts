import {
  normalizeGitBranchName,
  normalizeGitCommitMessage,
  type GitDiffGroup,
  type GitDiscardTarget,
  type GitStageTarget
} from '@shared/git'
import {
  IPC_CHANNELS,
  type GetGitFileDiffResponse,
  type GetGitRepositoryResponse,
  type GitOperationResponse,
  type ListGitBranchesResponse
} from '@shared/ipc'
import { applyGitCreateBranch, applyGitSwitchBranch, listGitBranches } from '../../git/gitBranches'
import { applyGitCommit } from '../../git/gitCommit'
import { readGitFileDiff } from '../../git/gitDiff'
import { applyGitDiscard } from '../../git/gitDiscard'
import { normalizeGitPathspec } from '../../git/gitPathspec'
import { describeGitRepository } from '../../git/gitRepository'
import { applyGitStage, applyGitUnstage } from '../../git/gitStage'
import { applyGitCommitAndPush, applyGitPull, applyGitPush } from '../../git/gitSync'
import { invalidRequest } from '../errors'
import { handleIpc } from '../registry'

/**
 * git ドメインのハンドラ（Session 3-8-1 / 3-8-3 / 3-8-4 / 3-8-5）。
 *
 * ## 3-8-1 では確かめる値が無かった
 *
 * `git:get-repository` の要求は `void` で、確かめるべき値そのものが届かない。
 * 実行するコマンドも、その引数も、作業ディレクトリも Renderer からは渡せず、
 * Main が自分の持っている正本と表から決める（main/git/）。
 *
 * ## 3-8-3 で初めて値が届く
 *
 * Stage / Unstage の対象は Renderer から来る。ここが**その値を確かめる場所**になり、
 * 通すのは次の2つだけになる。
 *
 *   相対位置1つ … `normalizeGitPathspec` を通った形（main/git/gitPathspec.ts）
 *   グループ    … `unstaged` / `untracked` という閉じた集合の値
 *
 * ## 3-8-4 で増えたのはメッセージ1つ
 *
 * Commit の要求に載るのは利用者が書いた文章だけで、**何を Commit するかは
 * 載らない**（対象は index の中身そのもの）。文章は `normalizeGitCommitMessage` を
 * 通してから Main の domain へ渡り、git へは引数ではなく標準入力から渡る
 * （main/git/gitCommands.ts）── つまりこの値も、git の引数になる経路が無い。
 *
 * ## 3-8-6 で確かめるのは、名前の**形**だけ
 *
 * ブランチの切り替え / 作成で届くのは名前1つで、通すのは
 * `normalizeGitBranchName`（Renderer が入力中に使うのと同じ関数）になる。
 * ここを通った値だけが、`--end-of-options` の後ろの引数として git へ渡る
 * （main/git/gitCommands.ts）。
 *
 * **形しか見ない**のが要点にあたる ── 「そのブランチが実在するか」も
 * 「同じ名前が既にあるか」も確かめない。どちらもリポジトリの中身を見ないと
 * 決まらないことで、答えるのは git になる（応答の `outcome` に載る）。
 *
 * ## 3-8-5 では、確かめる値がまた減る
 *
 * Push / Pull の要求は **`void`** にしてある ── remote 名もブランチ名も
 * refspec も渡す欄が無く、3-8-1 の `git:get-repository` と同じく
 * 確かめるべき値そのものが届かない。Commit & Push で届くのは
 * Commit と同じメッセージ1つだけで、Push の側に足した欄は無い。
 *
 * git のコマンド名・引数・作業ディレクトリ・実行ファイル・シェルは、
 * 3-8-1 のときと同じく**要求に欄そのものが無い**（shared/ipc/contracts/git.ts）。
 * チャンネルも操作ごとに1本ずつで、汎用の実行 API は作らない。
 *
 * ## 値が通せないことだけを IpcError にする
 *
 * 契約の上では `target` は必ず正しい形で届くが、境界の外から来た値として
 * 素直に信じない（files ドメインのハンドラと同じ構え）。通せない値は
 * **INVALID_REQUEST**、つまり「Renderer 側の不具合」として返す ──
 * 利用者に起こることではないため、Git パネルの案内には出さない。
 *
 * 逆に、**利用者に起こること**（ファイルが消えていた・index が握られていた・
 * リポジトリでなくなった）は失敗として返さず、応答の中の `outcome` に載せる。
 * 汎用のエラー文言に丸めると「次に何をすればよいか」を出せなくなるのは
 * 3-8-1 と同じ理由になる（shared/git/repository.ts）。
 */

/** 契約上は必ず入っているが、境界の外から来た値として素直に信じない。 */
function field(request: unknown, key: string): unknown {
  return typeof request === 'object' && request !== null
    ? (request as Record<string, unknown>)[key]
    : undefined
}

/**
 * Stage の対象を読み取る。
 *
 * `kind` を先に見て、その形に必要な欄だけを確かめる。**`relativePath` が
 * 付いていても、グループの指定なら使わない** ── 使う形にすると
 * 「グループのつもりで送った要求に、無視されるはずの path が効く」余地ができる。
 */
function stageTargetField(request: unknown): GitStageTarget {
  const target = field(request, 'target')
  const kind = field(target, 'kind')

  if (kind === 'unstaged' || kind === 'untracked') {
    return { kind }
  }

  if (kind !== 'file') {
    throw invalidRequest('the stage target is missing or not a known kind.')
  }

  return { kind: 'file', relativePath: pathspecField(target) }
}

/** Unstage の対象（ファイル単位だけ。shared/git/operation.ts）。 */
function unstageTargetField(request: unknown): string {
  return pathspecField(field(request, 'target'))
}

/**
 * pathspec として通してよい相対位置。
 *
 * ここを通らない値が git の引数になることは無い。**正規化した値を使う**
 * （受け取った生の文字列ではなく）── 区切りが `\` の形で届いても、
 * git へ渡るのは `/` に揃った1つの形だけになる。
 */
function pathspecField(target: unknown): string {
  const pathspec = normalizeGitPathspec(field(target, 'relativePath'))

  if (pathspec === null) {
    throw invalidRequest('the requested path is not usable as a git pathspec.')
  }

  return pathspec
}

/**
 * Commit メッセージ（Session 3-8-4）。
 *
 * 通すのは `normalizeGitCommitMessage`（shared/git/commitMessage.ts）で、
 * **Renderer が入力中に使うのと同じ関数**になる。同じ規則を2箇所に書くと、
 * 片方だけ直された日に「ボタンは押せるのに Main が弾く」が生まれる。
 *
 * 同じ関数を使うことと、検証を Renderer へ委譲することは別の話にあたる ──
 * ここを通らない文字列が git へ渡ることは無い。
 *
 * **通せない値を INVALID_REQUEST にする**のは pathspec と同じ扱いで、
 * 空・空白だけ・長すぎ・NUL 入りのメッセージでは Renderer 側がそもそも
 * ボタンを押せなくしてある（renderer/src/git/GitView.tsx）。つまりここへ
 * 届くのは Renderer 側の不具合であって、利用者に起こることではない ──
 * 利用者に起こること（名乗りが無い・hook が止めた・競合が残っている）の方は
 * 失敗にせず、応答の `outcome` に分類として載る。
 */
function commitMessageField(request: unknown): string {
  const message = normalizeGitCommitMessage(field(request, 'message'))

  if (message === null) {
    throw invalidRequest('the commit message is empty, too long, or contains control characters.')
  }

  return message
}

/**
 * ブランチ名（Session 3-8-6）。
 *
 * 通すのは `normalizeGitBranchName`（shared/git/branchName.ts）で、
 * **Renderer が入力中に使うのと同じ関数**になる ── Commit メッセージと
 * まったく同じ分担で、同じ規則を2箇所に書くと、片方だけ直された日に
 * 「ボタンは押せるのに Main が弾く」が生まれる。
 *
 * **ここを通らない文字列が git の引数になることは無い。** ブランチ名は
 * pathspec と違い、`--` ではなく `--end-of-options` の後ろに置かれる
 * （main/git/gitCommands.ts）── 置き方と形の検証の両方でようやく
 * 「値は値でしかない」と言える。
 *
 * 通せない値を INVALID_REQUEST にするのは pathspec / Commit メッセージと同じ扱いで、
 * 空・長すぎ・使えない文字・使えない形の名前では Renderer 側がそもそもボタンを
 * 押せなくしてある（renderer/src/git/GitBranchMenu.tsx）。切り替えの側では、
 * そもそも**一覧から選んだ名前**しか送られない。
 *
 * 逆に、**利用者に起こること**（同じ名前が既にある・切り替え先が消えていた・
 * 書きかけが邪魔をした）は失敗にせず、応答の `outcome` に分類として載る。
 */
/**
 * 差分の対象（Session 3-8-9）。
 *
 * 確かめるのは2つだけ ── グループが**知っている値か**（閉じた集合）と、
 * 位置が pathspec として通せる形か。どちらも Stage の対象を確かめているのと
 * 同じ形で、rev も diff のオプションも要求に欄そのものが無い。
 *
 * `conflicted` を通さないのは型の上でも同じだが、**ここでも弾く** ──
 * 届いた文字列が型どおりであることは、Main の側では何も保証されていない。
 */
function diffGroupField(request: unknown): GitDiffGroup {
  const group = field(request, 'group')

  if (group !== 'staged' && group !== 'unstaged' && group !== 'untracked') {
    throw invalidRequest('the diff group is missing or not a known group.')
  }

  return group
}

/**
 * 破棄の対象（Session 3-8-9）。
 *
 * 通すグループは `unstaged` / `untracked` の2つだけ。**`staged` と
 * `conflicted` はここで断る** ── 型の上で渡せないものが、実際にも
 * 通らないことを入口で確かめておく（shared/git/operation.ts）。
 *
 * 断るのは `IpcResult` の失敗（INVALID_REQUEST）にあたる。利用者に起こる
 * ことではなく、Renderer 側の不具合になる（`GitOperationResponse` に載る
 * 失敗は「リポジトリは見えているのに通らなかった」の側だけ）。
 */
function discardTargetField(request: unknown): GitDiscardTarget {
  const target = field(request, 'target')
  const group = field(target, 'group')

  if (group !== 'unstaged' && group !== 'untracked') {
    throw invalidRequest('the discard target is missing or not a discardable group.')
  }

  return { group, relativePath: pathspecField(target) }
}

function branchNameField(request: unknown): string {
  const name = normalizeGitBranchName(field(request, 'name'))

  if (name === null) {
    throw invalidRequest('the branch name is empty, too long, or not usable as a git branch name.')
  }

  return name
}

export function registerGitHandlers(): void {
  handleIpc(IPC_CHANNELS.GIT_GET_REPOSITORY, async (): Promise<GetGitRepositoryResponse> => {
    return await describeGitRepository()
  })

  handleIpc(IPC_CHANNELS.GIT_STAGE, async (request): Promise<GitOperationResponse> => {
    return await applyGitStage(stageTargetField(request))
  })

  handleIpc(IPC_CHANNELS.GIT_UNSTAGE, async (request): Promise<GitOperationResponse> => {
    return await applyGitUnstage({ relativePath: unstageTargetField(request) })
  })

  handleIpc(IPC_CHANNELS.GIT_COMMIT, async (request): Promise<GitOperationResponse> => {
    return await applyGitCommit(commitMessageField(request))
  })

  /*
    Push / Pull（Session 3-8-5）。

    **要求が `void` に戻る。** remote 名・ブランチ名・refspec のどれも
    渡す欄が無いため、ここで確かめるべき値そのものが届かない
    （3-8-1 の `git:get-repository` と同じ形）。送り先を決めるのは
    リポジトリの設定で、それを読むのは Main になる（main/git/gitSync.ts）。
  */
  handleIpc(IPC_CHANNELS.GIT_PUSH, async (): Promise<GitOperationResponse> => {
    return await applyGitPush()
  })

  handleIpc(IPC_CHANNELS.GIT_PULL, async (): Promise<GitOperationResponse> => {
    return await applyGitPull()
  })

  /*
    Commit & Push（Session 3-8-5）。

    確かめるのは Commit と同じメッセージ1つだけで、**Push の側に足す値は無い。**
    通す関数も `git:commit` とまったく同じ（`normalizeGitCommitMessage`）──
    2つの入口で違う規則が効くと、片方からだけ通るメッセージが生まれる。
  */
  handleIpc(IPC_CHANNELS.GIT_COMMIT_AND_PUSH, async (request): Promise<GitOperationResponse> => {
    return await applyGitCommitAndPush(commitMessageField(request))
  })

  /*
    ブランチの一覧（Session 3-8-6）。

    要求は `void`。どの ref を、どう並べて、いくつ、という指定は1つも無く、
    答えるのは常に「今の Workspace のローカルブランチ」だけになる
    （shared/git/branch.ts）。読み取りだが `git:get-repository` と別の1本なのは、
    見られている時間が違うため（shared/ipc/contracts/git.ts）。
  */
  handleIpc(IPC_CHANNELS.GIT_LIST_BRANCHES, async (): Promise<ListGitBranchesResponse> => {
    return await listGitBranches()
  })

  /*
    ブランチの切り替え / 作成（Session 3-8-6）。

    確かめるのは名前1つだけで、**2本とも同じ関数**を通す（`branchNameField`）──
    2つの入口で違う規則が効くと、片方からだけ通る名前が生まれる
    （`git:commit` と `git:commit-and-push` で同じ判断をしている）。

    チャンネルを分けてあるのは「無ければ作る」を作らないため。1本にすると、
    名前を打ち間違えたときに、切り替えたつもりで新しいブランチが増える。
  */
  handleIpc(IPC_CHANNELS.GIT_SWITCH_BRANCH, async (request): Promise<GitOperationResponse> => {
    return await applyGitSwitchBranch(branchNameField(request))
  })

  handleIpc(IPC_CHANNELS.GIT_CREATE_BRANCH, async (request): Promise<GitOperationResponse> => {
    return await applyGitCreateBranch(branchNameField(request))
  })

  /*
    差分と破棄（Session 3-8-9）。

    差分は読み取りだが `git:get-repository` と別の1本にしてある（見られている
    時間が違う。shared/ipc/contracts/git.ts）。破棄は `git:unstage` の説明に
    書いてあった「作業ツリーごと戻すもの」で、**同じチャンネルに区別を
    引数として持たせず**、別の1本として切ってある。

    位置を確かめる関数は Stage / Unstage とまったく同じ（`pathspecField`）──
    3つの入口で違う規則が効くと、片方からだけ通る位置が生まれる。
  */
  handleIpc(IPC_CHANNELS.GIT_GET_FILE_DIFF, async (request): Promise<GetGitFileDiffResponse> => {
    return await readGitFileDiff({
      group: diffGroupField(request),
      relativePath: pathspecField(request)
    })
  })

  handleIpc(IPC_CHANNELS.GIT_DISCARD, async (request): Promise<GitOperationResponse> => {
    return await applyGitDiscard(discardTargetField(request))
  })
}
